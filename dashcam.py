"""
Radar Play · Dashcam
Graba la cámara delantera en trozos de 1 minuto (datos/dashcam). Cuando se
llena el espacio (DASHCAM_GB) borra los más viejos. Los vídeos «guardados»
(un golpe del acelerómetro o el botón Guardar) no se borran nunca solos.
Configuración en sistema/radar-play.conf:
  DASHCAM_CAMARA=/dev/video0   (vacío = sin dashcam)
  DASHCAM_GB=8
Necesita ffmpeg (lo instala instalar.sh). Esa cámara queda reservada para la dashcam.
"""
import glob, os, shutil, subprocess, threading, time

CARPETA = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(CARPETA, "datos", "dashcam")
GUARD = os.path.join(DIR, "guardados")
estado = {"activo": False, "grabando": False, "msg": "Sin dashcam (DASHCAM_CAMARA vacío)", "codificador": None, "error": None, "camara": None}
_proc = {"p": None, "pausa": False}
_marcas = []          # instantes a proteger (golpes / botón)
CONF = {}


def _cmd(dev, cod):
    base = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "v4l2"]
    salida = ["-an", "-f", "segment", "-segment_time", "60", "-segment_format", "mp4", "-reset_timestamps", "1",
              "-strftime", "1", os.path.join(DIR, "%Y%m%d-%H%M%S.mp4")]
    res = CONF.get("DASHCAM_RES", "1280x720")
    if cod == "copia":       # la cámara ya da H.264: sin gastar CPU
        return base + ["-input_format", "h264", "-video_size", res, "-i", dev, "-c:v", "copy"] + salida
    entrada = ["-input_format", "mjpeg", "-video_size", res, "-framerate", "25", "-i", dev]
    if cod == "hw":          # codificador por hardware (Raspberry Pi 4)
        return base + entrada + ["-c:v", "h264_v4l2m2m", "-b:v", "4M", "-pix_fmt", "yuv420p"] + salida
    return base + entrada + ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-r", "15", "-pix_fmt", "yuv420p"] + salida


def _formatos(dev):
    try:
        r = subprocess.run(["v4l2-ctl", "-d", dev, "--list-formats"], capture_output=True, text=True, timeout=5).stdout
        return r.upper()
    except Exception:
        return ""


def _limpiar():
    lim = float(CONF.get("DASHCAM_GB", 8)) * 1e9
    clips = sorted(glob.glob(os.path.join(DIR, "*.mp4")))
    tot = sum(os.path.getsize(c) for c in clips) + sum(os.path.getsize(c) for c in glob.glob(os.path.join(GUARD, "*.mp4")))
    while clips and tot > lim:
        c = clips.pop(0)
        tot -= os.path.getsize(c)
        try: os.remove(c)
        except Exception: pass


def _proteger():
    """Mueve a «guardados» el trozo del golpe y el anterior, cuando ya están cerrados."""
    if not _marcas:
        return
    clips = sorted(glob.glob(os.path.join(DIR, "*.mp4")))
    def inicio(c):
        try: return time.mktime(time.strptime(os.path.basename(c)[:15], "%Y%m%d-%H%M%S"))
        except Exception: return 0
    for t in list(_marcas):
        hechos = True
        for i, c in enumerate(clips):
            ini = inicio(c)
            fin = inicio(clips[i + 1]) if i + 1 < len(clips) else None
            if ini <= t + 30 and (fin is None or fin >= t - 60):      # trozo del golpe ±
                if fin is None:
                    hechos = False                                   # aún grabándose
                    continue
                try: shutil.move(c, os.path.join(GUARD, os.path.basename(c)))
                except Exception: pass
        if hechos and time.time() - t > 90:
            _marcas.remove(t)


def hilo():
    dev = CONF.get("DASHCAM_CAMARA")
    os.makedirs(GUARD, exist_ok=True)
    if not shutil.which("ffmpeg"):
        estado["msg"] = "Falta ffmpeg (sudo apt install ffmpeg)"
        return
    while True:
        if _proc["pausa"]:
            time.sleep(2); continue
        if not os.path.exists(dev):
            estado.update(grabando=False, msg="No encuentro la cámara %s" % dev)
            time.sleep(10); continue
        f = _formatos(dev)
        cod = CONF.get("DASHCAM_CODIFICADOR", "auto")
        if cod == "auto":
            modelo = open("/proc/device-tree/model").read() if os.path.exists("/proc/device-tree/model") else ""
            cod = "copia" if "H264" in f else ("hw" if "Pi 4" in modelo else "cpu")
        estado.update(codificador=cod, camara=dev)
        try:
            p = subprocess.Popen(_cmd(dev, cod), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            _proc["p"] = p
            estado.update(grabando=True, msg="Grabando (%s)" % {"copia": "H.264 de la cámara", "hw": "por hardware", "cpu": "por CPU, 15 fps"}[cod], error=None)
            while p.poll() is None and not _proc["pausa"]:
                _limpiar(); _proteger()
                time.sleep(5)
            if p.poll() is None:
                p.terminate()
            err = (p.stderr.read() or b"").decode(errors="ignore")[-300:]
            if err and not _proc["pausa"]:
                estado["error"] = err
                if cod == "hw":
                    CONF["DASHCAM_CODIFICADOR"] = "cpu"     # si falla el de hardware, por CPU
        except Exception as e:
            estado["error"] = str(e)
        estado["grabando"] = False
        time.sleep(3)


def golpe(g=None):
    _marcas.append(time.time())
    estado["ultimo_guardado"] = time.strftime("%H:%M:%S") + (" · golpe de %.1f g" % g if g else " · a mano")


def arrancar(sis, obd=None):
    CONF.update(sis.CONF)
    if not CONF.get("DASHCAM_CAMARA"):
        return
    if not sis.ES_PI:
        estado["msg"] = "La dashcam graba en la Raspberry"
        return
    estado.update(activo=True, msg="Arrancando la dashcam…")
    try:
        import acel
        acel.al_golpe.append(golpe)
    except Exception:
        pass
    threading.Thread(target=hilo, daemon=True).start()


def lista():
    out = []
    for carpeta, prot in ((GUARD, True), (DIR, False)):
        for c in sorted(glob.glob(os.path.join(carpeta, "*.mp4")), reverse=True)[:200]:
            n = os.path.basename(c)
            out.append({"nombre": n, "url": "/" + os.path.relpath(c, CARPETA).replace(os.sep, "/"), "protegido": prot,
                        "mb": round(os.path.getsize(c) / 1e6, 1), "fecha": "%s/%s %s:%s" % (n[6:8], n[4:6], n[9:11], n[11:13])})
    return out


def g_dash(q):
    return {**estado, "clips": lista() if os.path.isdir(DIR) else [], "pendientes": len(_marcas)}


def p_dash(d):
    a = d.get("accion")
    if a == "guardar":
        golpe()
        return {"ok": True}
    if a == "borrar":
        n = os.path.basename(str(d.get("nombre", "")))
        for carpeta in (DIR, GUARD):
            p = os.path.join(carpeta, n)
            if n.endswith(".mp4") and os.path.exists(p):
                os.remove(p)
                return {"ok": True}
        return {"ok": False, "error": "No existe"}
    if a in ("pausar", "seguir"):
        _proc["pausa"] = a == "pausar"
        if _proc["pausa"] and _proc["p"] and _proc["p"].poll() is None:
            _proc["p"].terminate()
        estado["msg"] = "En pausa" if _proc["pausa"] else "Reanudando…"
        return {"ok": True}
    return {"ok": False, "error": "Acción desconocida"}


GET = {"/api/dashcam": g_dash}
POST = {"/api/dashcam": p_dash}
