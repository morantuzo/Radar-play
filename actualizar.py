"""
Radar Play · Actualizar sin pendrive
Formas de traer una versión nueva (el zip Radar-Play.zip):
  - Desde el iPhone o el PC por la WiFi: página /actualizar (enlace en el mando).
  - Desde la propia Raspberry: Sistema › Actualizar busca zips en Descargas y pendrives.
  - Desde un enlace a un zip.
Qué hace: comprueba el zip, guarda una copia de la versión actual (para volver
atrás), copia los archivos nuevos sin tocar tus datos ni tu radar-play.conf y
reinicia Radar Play. Si cambia el instalador, lo ejecuta solo (sin reiniciar la
Raspberry) para poner los programas nuevos que hagan falta.
"""
import glob, hashlib, os, shutil, subprocess, sys, tempfile, threading, time, urllib.request, zipfile
import registro as LOG

APP = os.path.dirname(os.path.abspath(__file__))
H = os.path.expanduser("~")
NUEVA = os.path.join(H, ".cache", "radar-play-nueva")
ANTERIOR = os.path.join(H, "radar-play-anterior")
SUBIDAS = os.path.join(APP, "datos", "actualizaciones")
MAX = 80 * 1024 * 1024
NECESARIOS = ("puente.py", "sistema_rp.py", "radar-play-google.html", "sistema/instalar.sh")
NO_TOCAR = ("datos/",)
estado = {"fase": "", "msg": "", "ok": None, "desde": 0, "completa": False}
_cerrojo = threading.Lock()


def version(carpeta=APP):
    try:
        with open(os.path.join(carpeta, "version.txt"), encoding="utf-8") as f:
            return f.read().strip() or "?"
    except Exception:
        return "sin número"


def _fase(fase, msg, ok=None):
    estado.update(fase=fase, msg=msg, ok=ok)
    (LOG.aviso if ok is False else LOG.info)("Actualizar: %s", msg, origen="actualizar")


def buscar_zips():
    """Zips de Radar Play en Descargas, el escritorio, pendrives y los que se han subido."""
    rutas = []
    for patron in ("Descargas", "Downloads", "Escritorio", "Desktop"):
        rutas += glob.glob(os.path.join(H, patron, "*.zip"))
    rutas += glob.glob("/media/*/*/*.zip") + glob.glob("/media/*/*.zip")
    out = []
    for r in set(rutas):
        n = os.path.basename(r).lower()
        if "radar" not in n:
            continue
        try:
            st = os.stat(r)
            out.append({"ruta": r, "nombre": os.path.basename(r), "fecha": time.strftime("%d/%m %H:%M", time.localtime(st.st_mtime)),
                        "t": st.st_mtime, "mb": round(st.st_size / 1048576, 1),
                        "donde": "pendrive" if r.startswith("/media") else os.path.basename(os.path.dirname(r))})
        except Exception:
            pass
    return sorted(out, key=lambda x: -x["t"])[:8]


def _raiz(z):
    """Carpeta dentro del zip donde está puente.py (radar-play/ o la raíz)."""
    cands = [n for n in z.namelist() if n.endswith("puente.py") and n.count("/") <= 2]
    if not cands:
        raise ValueError("Ese zip no es de Radar Play (no tiene puente.py)")
    return min(cands, key=len)[:-len("puente.py")]


def _leer(r):
    try:
        with open(r, "rb") as f:
            return f.read().replace(b"\r\n", b"\n")
    except Exception:
        return None


def _systemd():
    return bool(os.environ.get("INVOCATION_ID"))


def _reiniciar_puente(espera=2.0):
    def fin():
        time.sleep(espera)
        LOG.info("Reiniciando Radar Play con la versión nueva", origen="actualizar")
        os._exit(3)                      # systemd lo vuelve a arrancar en 2 s (Restart=always)
    threading.Thread(target=fin, daemon=True).start()


def aplicar(zip_ruta):
    if not _cerrojo.acquire(blocking=False):
        return {"ok": False, "error": "Ya hay una actualización en marcha"}
    try:
        estado.update(desde=time.time(), completa=False)
        _fase("comprobar", "Comprobando el zip…")
        if os.path.getsize(zip_ruta) > MAX:
            raise ValueError("El zip es demasiado grande")
        with zipfile.ZipFile(zip_ruta) as z:
            malo = z.testzip()
            if malo:
                raise ValueError("El zip está dañado (%s). Descárgalo otra vez" % malo)
            raiz = _raiz(z)
            shutil.rmtree(NUEVA, ignore_errors=True)
            os.makedirs(NUEVA)
            n = 0
            for info in z.infolist():
                nombre = info.filename
                if not nombre.startswith(raiz) or info.is_dir():
                    continue
                rel = nombre[len(raiz):]
                if not rel or rel.startswith(NO_TOCAR) or "__pycache__" in rel or "/../" in "/" + rel or rel.startswith("/") or ".." in rel.split("/"):
                    continue
                dest = os.path.join(NUEVA, rel)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(info) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                n += 1
        for r in NECESARIOS:
            if not os.path.exists(os.path.join(NUEVA, r)):
                raise ValueError("Al zip le falta %s" % r)
        for r in glob.glob(os.path.join(NUEVA, "**", "*.py"), recursive=True):
            src = open(r, "rb").read()
            if b"\x00" in src:
                raise ValueError("%s está dañado" % os.path.basename(r))
            compile(src, r, "exec")                 # si tiene un error, no se instala
        nv = version(NUEVA)
        _fase("copia", "Guardando una copia de la versión actual (%s)…" % version())
        shutil.rmtree(ANTERIOR, ignore_errors=True)
        shutil.copytree(APP, ANTERIOR, ignore=shutil.ignore_patterns("datos", "__pycache__"))
        completa = _leer(os.path.join(NUEVA, "sistema/instalar.sh")) != _leer(os.path.join(APP, "sistema/instalar.sh"))
        _fase("instalar", "Copiando la versión %s (%d archivos)…" % (nv, n))
        for raiz_d, _, archivos in os.walk(NUEVA):
            for a in archivos:
                origen = os.path.join(raiz_d, a)
                rel = os.path.relpath(origen, NUEVA)
                dest = os.path.join(APP, rel)
                if rel == os.path.join("sistema", "radar-play.conf") and os.path.exists(dest):
                    shutil.copy2(origen, dest + ".nuevo")        # tu configuración no se toca
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                datos = open(origen, "rb").read()
                if a.endswith((".sh", ".conf", ".desktop")):
                    datos = datos.replace(b"\r\n", b"\n")
                tmp = dest + ".rp-tmp"
                with open(tmp, "wb") as f:
                    f.write(datos)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, dest)
                if a.endswith((".sh", ".py")):
                    os.chmod(dest, 0o755)
        try: os.sync()
        except Exception: pass
        shutil.rmtree(NUEVA, ignore_errors=True)
        for viejo in glob.glob(os.path.join(SUBIDAS, "*.zip")):      # los zips subidos ya no hacen falta
            try: os.remove(viejo)
            except Exception: pass
        estado["completa"] = completa
        if completa and _instalador():
            _fase("programas", "Versión %s copiada. Instalando programas nuevos (puede tardar unos minutos)…" % nv)
            return {"ok": True, "version": nv, "completa": True}
        if not _systemd():
            _fase("hecho", "Versión %s instalada. Cierra y vuelve a abrir Radar Play" % nv, True)
            return {"ok": True, "version": nv, "reabrir": True}
        _fase("reinicio", "Versión %s instalada. Reiniciando Radar Play…" % nv, True)
        _reiniciar_puente()
        return {"ok": True, "version": nv}
    except Exception as e:
        _fase("error", str(e)[:200], False)
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _cerrojo.release()


def _instalador():
    """Ejecuta instalar.sh fuera de Radar Play (así sigue aunque Radar Play se reinicie)."""
    if subprocess.call(["sudo", "-n", "true"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) != 0:
        LOG.aviso("No puedo usar sudo sin contraseña: el instalador nuevo hay que ejecutarlo a mano", origen="actualizar")
        return False
    u = os.environ.get("USER") or os.environ.get("LOGNAME") or os.path.basename(H)
    uid = os.getuid()
    orden = ('bash "%s/sistema/instalar.sh"; sudo -u %s XDG_RUNTIME_DIR=/run/user/%d DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%d/bus '
             'sh -c "systemctl --user daemon-reload; systemctl --user restart radar-play"' % (APP, u, uid, uid))
    r = subprocess.call(["sudo", "-n", "systemd-run", "--unit=radar-play-actualizar-%d" % int(time.time()), "--collect",
                         "--setenv=SUDO_USER=" + u, "--setenv=RP_SIN_REINICIO=1", "bash", "-c", orden],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return r == 0


def deshacer():
    if not os.path.exists(os.path.join(ANTERIOR, "puente.py")):
        return {"ok": False, "error": "No hay una versión anterior guardada"}
    v = version(ANTERIOR)
    tmp = os.path.join(SUBIDAS, "anterior.zip")
    os.makedirs(SUBIDAS, exist_ok=True)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for raiz_d, _, archivos in os.walk(ANTERIOR):
            for a in archivos:
                p = os.path.join(raiz_d, a)
                z.write(p, os.path.join("radar-play", os.path.relpath(p, ANTERIOR)))
    LOG.info("Volviendo a la versión anterior (%s)", v, origen="actualizar")
    threading.Thread(target=aplicar, args=(tmp,), daemon=True).start()
    return {"ok": True, "version": v}


def recibir(rfile, longitud):
    """Guarda el zip que llega por la WiFi (desde el iPhone o el PC) y lo instala."""
    if longitud <= 0 or longitud > MAX:
        return {"ok": False, "error": "Archivo vacío o demasiado grande"}
    os.makedirs(SUBIDAS, exist_ok=True)
    ruta = os.path.join(SUBIDAS, "Radar-Play-%s.zip" % time.strftime("%Y%m%d-%H%M%S"))
    _fase("subir", "Recibiendo el zip (%.1f MB)…" % (longitud / 1048576))
    h, falta = hashlib.sha256(), longitud
    with open(ruta, "wb") as f:
        while falta > 0:
            b = rfile.read(min(65536, falta))
            if not b:
                break
            f.write(b); h.update(b); falta -= len(b)
    if falta:
        os.remove(ruta)
        _fase("error", "La subida se cortó. Vuelve a probar", False)
        return {"ok": False, "error": "La subida se cortó. Vuelve a probar"}
    if not zipfile.is_zipfile(ruta):
        os.remove(ruta)
        _fase("error", "Eso no es un zip", False)
        return {"ok": False, "error": "Eso no es un archivo .zip"}
    threading.Thread(target=aplicar, args=(ruta,), daemon=True).start()
    return {"ok": True, "msg": "Recibido. Instalando…"}


def descargar(url):
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "El enlace tiene que empezar por http"}
    def hilo():
        try:
            _fase("subir", "Descargando…")
            os.makedirs(SUBIDAS, exist_ok=True)
            ruta = os.path.join(SUBIDAS, "Radar-Play-enlace.zip")
            req = urllib.request.Request(url, headers={"User-Agent": "RadarPlay"})
            with urllib.request.urlopen(req, timeout=60) as r, open(ruta, "wb") as f:
                total = 0
                while True:
                    b = r.read(65536)
                    if not b:
                        break
                    total += len(b)
                    if total > MAX:
                        raise ValueError("El archivo es demasiado grande")
                    f.write(b)
            if not zipfile.is_zipfile(ruta):
                raise ValueError("Ese enlace no da un zip (si es de Google Drive o Dropbox, usa el enlace de descarga directa)")
            aplicar(ruta)
        except Exception as e:
            _fase("error", "No se pudo descargar: %s" % str(e)[:150], False)
    threading.Thread(target=hilo, daemon=True).start()
    return {"ok": True}


# ===================== Actualizar por internet (GitHub) =====================
online = {"repo": "morantuzo/radar-play", "nueva": None, "hay": False, "msg": "", "ts": 0}


def _mas_nueva(a, b):
    """¿La versión a es más nueva que b? (formato 2026.11.07-1501)"""
    try:
        return a.strip() > b.strip() and a[:4].isdigit()
    except Exception:
        return False


def buscar_online():
    repo = online["repo"]
    try:
        req = urllib.request.Request("https://raw.githubusercontent.com/%s/main/version.txt?t=%d" % (repo, time.time()),
                                     headers={"User-Agent": "RadarPlay", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=15) as r:
            v = r.read(64).decode("utf-8", "ignore").strip()
        hay = _mas_nueva(v, version())
        online.update(nueva=v, hay=hay, ts=time.time(), msg="Hay una versión nueva: %s" % v if hay else "Tienes la última versión (%s)" % version())
    except urllib.error.HTTPError as e:
        online.update(hay=False, ts=time.time(), msg="El canal de actualizaciones aún no está listo" if e.code == 404 else "GitHub respondió %s" % e.code)
    except Exception as e:
        online.update(hay=False, ts=time.time(), msg="Sin internet: no puedo buscar actualizaciones")
    return {"ok": True, **{k: online[k] for k in ("nueva", "hay", "msg")}, "version": version()}


def instalar_online():
    def hilo():
        try:
            _fase("subir", "Descargando la versión nueva de internet…")
            os.makedirs(SUBIDAS, exist_ok=True)
            ruta = os.path.join(SUBIDAS, "Radar-Play-internet.zip")
            req = urllib.request.Request("https://codeload.github.com/%s/zip/refs/heads/main" % online["repo"], headers={"User-Agent": "RadarPlay"})
            with urllib.request.urlopen(req, timeout=90) as r, open(ruta, "wb") as f:
                shutil.copyfileobj(r, f)
            aplicar(ruta)
        except Exception as e:
            _fase("error", "No se pudo descargar: %s" % str(e)[:150], False)
    threading.Thread(target=hilo, daemon=True).start()
    return {"ok": True}


def _vigilar_online():
    time.sleep(90)
    while True:
        buscar_online()
        if online["hay"]:
            LOG.info("Hay una versión nueva en internet: %s", online["nueva"], origen="actualizar")
        time.sleep(6 * 3600)


def info():
    log = ""
    if estado["fase"] == "programas":
        try:
            with open(os.path.join(H, "radar-play-instalacion.log"), encoding="utf-8", errors="ignore") as f:
                log = [l for l in f.read().splitlines() if l.strip()][-1][:160]
        except Exception:
            pass
    return {"version": version(), "anterior": version(ANTERIOR) if os.path.exists(os.path.join(ANTERIOR, "puente.py")) else None,
            "zips": buscar_zips(), **estado, "log": log, "systemd": _systemd(),
            "online": {k: online[k] for k in ("nueva", "hay", "msg")}}


def arrancar(sis=None, obd=None):
    estado.update(fase="", msg="")
    if sis:
        online["repo"] = str(sis.CONF.get("ACTUALIZAR_GITHUB") or online["repo"]).strip()
    threading.Thread(target=_vigilar_online, daemon=True, name="actualizar-online").start()
    LOG.info("Versión de Radar Play: %s", version(), origen="actualizar")


def g_act(q):
    return info()


def p_act(d):
    a = d.get("accion")
    if a == "instalar":
        r = d.get("ruta") or ""
        if r not in [z["ruta"] for z in buscar_zips()]:
            return {"ok": False, "error": "No encuentro ese archivo"}
        threading.Thread(target=aplicar, args=(r,), daemon=True).start()
        return {"ok": True}
    if a == "deshacer":
        return deshacer()
    if a == "buscar":
        return buscar_online()
    if a == "online":
        return instalar_online()
    if a == "enlace":
        return descargar(str(d.get("url") or "").strip())
    return {"ok": False, "error": "Acción desconocida"}


GET = {"/api/actualizar": g_act}
POST = {"/api/actualizar": p_act}
