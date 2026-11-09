"""
Radar Play · Tu logo y tu sonido al encender
- Logo: la imagen que subas sale en la pantalla de arranque de Radar Play y
  también al encender la Raspberry (antes de que cargue nada).
- Sonido: el audio que subas suena una vez en cada arranque.
Se suben desde el mando del iPhone (página «Clave, actualizar y registro»).
"""
import glob, json, os, shutil, subprocess, threading, time
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(CARPETA, "datos")
CONF = os.path.join(DATOS, "arranque.json")
TIPOS_IMG = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/heic": "heic"}
TIPOS_AUD = {"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
             "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/flac": "flac"}
_int = {"sonado_boot": None, "proc": None}


def conf():
    try:
        c = json.load(open(CONF))
    except Exception:
        c = {}
    return {"sonido_on": c.get("sonido_on", True), "volumen": int(c.get("volumen", 80)), "logo_on": c.get("logo_on", True)}


def _guardar_conf(**kv):
    c = conf()
    c.update(kv)
    os.makedirs(DATOS, exist_ok=True)
    json.dump(c, open(CONF, "w"))
    return c


def logo():
    l = sorted(glob.glob(os.path.join(DATOS, "arranque-logo.*")))
    return l[0] if l else None


def sonido():
    l = sorted(glob.glob(os.path.join(DATOS, "arranque-sonido.*")))
    return l[0] if l else None


def _id_arranque():
    try:
        return open("/proc/sys/kernel/random/boot_id").read().strip()
    except Exception:
        return "pc"


# ---------- Subir ----------
def subir(tipo, datos, ctype):
    ctype = (ctype or "").split(";")[0].strip().lower()
    if tipo == "logo":
        ext = TIPOS_IMG.get(ctype) or ("png" if datos[:8] == b"\x89PNG\r\n\x1a\n" else "jpg" if datos[:3] == b"\xff\xd8\xff" else None)
        if not ext:
            return {"ok": False, "error": "Tiene que ser una imagen (PNG o JPG)"}
        for f in glob.glob(os.path.join(DATOS, "arranque-logo.*")):
            os.remove(f)
        ruta = os.path.join(DATOS, "arranque-logo." + ext)
        open(ruta, "wb").write(datos)
        try:
            ruta = _a_png(ruta)                        # todo a PNG (también lo que manda el iPhone en HEIC si se puede)
        except Exception as e:
            LOG.aviso("Logo de arranque: no se pudo convertir: %s", e, origen="arranque")
        _guardar_conf(logo_on=True)
        threading.Thread(target=_logo_al_encender, daemon=True).start()
        LOG.info("Logo de arranque nuevo", origen="arranque")
        return {"ok": True, "msg": "Logo guardado. Sale en el arranque de Radar Play y, desde el próximo reinicio, al encender la Raspberry"}
    if tipo == "sonido":
        ext = TIPOS_AUD.get(ctype) or ("mp3" if datos[:3] == b"ID3" or datos[:2] == b"\xff\xfb" else None)
        if not ext:
            return {"ok": False, "error": "Tiene que ser un audio (MP3, M4A, WAV…)"}
        for f in glob.glob(os.path.join(DATOS, "arranque-sonido.*")):
            os.remove(f)
        open(os.path.join(DATOS, "arranque-sonido." + ext), "wb").write(datos)
        _guardar_conf(sonido_on=True)
        LOG.info("Sonido de arranque nuevo (%s)", ext, origen="arranque")
        return {"ok": True, "msg": "Sonido guardado. Sonará al encender"}
    return {"ok": False, "error": "Tipo desconocido"}


def _a_png(ruta):
    from PIL import Image
    im = Image.open(ruta)
    im = im.convert("RGBA")
    im.thumbnail((900, 900))
    dest = os.path.join(DATOS, "arranque-logo.png")
    im.save(dest)
    if ruta != dest:
        os.remove(ruta)
    return dest


def _logo_al_encender():
    """Pone el logo en la pantalla de encendido de la Raspberry (Plymouth). Necesita sudo sin contraseña (lo normal en Raspberry Pi OS)."""
    l = logo()
    tema = "/usr/share/plymouth/themes/pix"
    if not l or not os.path.isdir(tema):
        return
    try:
        from PIL import Image
        im = Image.open(l).convert("RGBA")
        im.thumbnail((560, 560))
        fondo = Image.new("RGBA", im.size, (0, 0, 0, 0))
        fondo.alpha_composite(im)
        tmp = os.path.join(DATOS, "splash-arranque.png")
        fondo.save(tmp)
    except Exception:
        tmp = l
    r = subprocess.run(["sudo", "-n", "cp", tmp, tema + "/splash.png"], capture_output=True, text=True)
    if r.returncode != 0:
        LOG.aviso("Logo al encender: sin permiso (%s). Se pondrá al reinstalar", (r.stderr or "").strip()[:100], origen="arranque")
        return
    subprocess.run(["sudo", "-n", "update-initramfs", "-u"], capture_output=True, timeout=600)
    LOG.info("Logo puesto en el encendido de la Raspberry", origen="arranque")


def quitar(tipo):
    patron = "arranque-logo.*" if tipo == "logo" else "arranque-sonido.*"
    for f in glob.glob(os.path.join(DATOS, patron)):
        os.remove(f)
    if tipo == "logo":
        orig = os.path.join(CARPETA, "sistema", "splash.png")
        tema = "/usr/share/plymouth/themes/pix"
        if os.path.isdir(tema) and os.path.exists(orig):
            def volver():
                if subprocess.run(["sudo", "-n", "cp", orig, tema + "/splash.png"]).returncode == 0:
                    subprocess.run(["sudo", "-n", "update-initramfs", "-u"], capture_output=True, timeout=600)
            threading.Thread(target=volver, daemon=True).start()
    return {"ok": True}


# ---------- Sonar ----------
def sonar(forzar=False):
    s = sonido()
    c = conf()
    if not s:
        return {"ok": False, "error": "No hay sonido"}
    if not forzar:
        if not c["sonido_on"] or _int["sonado_boot"] == _id_arranque():
            return {"ok": True, "ya": True}
        _int["sonado_boot"] = _id_arranque()
        try:
            open(os.path.join(DATOS, "arranque-sonado"), "w").write(_id_arranque())
        except Exception:
            pass
    vol = max(0, min(100, c["volumen"]))

    def hilo():
        p = _int["proc"]
        if p and p.poll() is None:
            p.terminate()
        for intento in range(4):                          # al encender, el sonido puede tardar en estar listo
            if shutil.which("ffplay"):
                cmd = ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet", "-t", "40", "-volume", str(vol), s]
            elif shutil.which("mpv"):
                cmd = ["mpv", "--no-video", "--really-quiet", "--length=40", "--volume=%d" % vol, s]
            else:
                cmd = ["pw-play", "--volume=%.2f" % (vol / 100), s]
            t0 = time.time()
            _int["proc"] = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            rc = _int["proc"].wait()
            if rc == 0 or time.time() - t0 > 2:
                return
            time.sleep(3)
        LOG.aviso("Sonido de arranque: no se pudo reproducir", origen="arranque")
    threading.Thread(target=hilo, daemon=True).start()
    return {"ok": True}


def arrancar(sis=None, obd=None):
    try:
        _int["sonado_boot"] = open(os.path.join(DATOS, "arranque-sonado")).read().strip()
    except Exception:
        pass


def g_arr(q):
    l = logo()
    return {**conf(), "logo": bool(l), "logo_t": int(os.path.getmtime(l)) if l else 0, "sonido": bool(sonido()),
            "sonido_nombre": os.path.basename(sonido() or "")}


def p_arr(d):
    a = d.get("accion")
    if a == "sonar":                       # la pantalla lo pide al arrancar (una vez por encendido)
        return sonar(False)
    if a == "probar":
        return sonar(True)
    if a == "parar":
        p = _int["proc"]
        if p and p.poll() is None:
            p.terminate()
        return {"ok": True}
    if a == "ajustes":
        kv = {k: d[k] for k in ("sonido_on", "volumen", "logo_on") if k in d}
        return {"ok": True, **_guardar_conf(**kv)}
    if a == "quitar":
        return quitar(d.get("tipo"))
    return {"ok": False, "error": "Acción desconocida"}


GET = {"/api/arranque": g_arr}
POST = {"/api/arranque": p_arr}
