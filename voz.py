"""
Radar Play · Voz en español por los altavoces de la Raspberry
El navegador de la Raspberry casi nunca trae voz en español, así que la voz
la pone el puente con el mejor programa que haya instalado:
  1) Piper (voz natural, la descarga instalar.sh en ~/.local/share/radar-play/piper)
  2) pico2wave (libttspico-utils)
  3) espeak-ng
Lee los WhatsApp, las indicaciones del navegador y lo que diga «Siri».
"""
import glob, os, queue, shutil, subprocess, tempfile, threading, time
import registro as LOG

PIPER_DIR = os.path.expanduser("~/.local/share/radar-play/piper")
_cola = queue.Queue()
_estado = {"motor": None, "hablando": False, "proc": None, "hasta": 0}


def motor():
    if _estado["motor"] is not None:
        return _estado["motor"]
    exe = os.path.join(PIPER_DIR, "piper", "piper")
    voces = sorted(glob.glob(os.path.join(PIPER_DIR, "*.onnx")))
    if os.access(exe, os.X_OK) and voces:
        _estado["motor"] = ("piper", exe, voces[0])
    elif shutil.which("pico2wave"):
        _estado["motor"] = ("pico", shutil.which("pico2wave"), None)
    elif shutil.which("espeak-ng"):
        _estado["motor"] = ("espeak", shutil.which("espeak-ng"), None)
    else:
        _estado["motor"] = ("", None, None)
    LOG.info("Voz: %s", _estado["motor"][0] or "ninguna (instala espeak-ng)", origen="voz")
    return _estado["motor"]


def _reproducir(ruta):
    for c in (["pw-play", ruta], ["paplay", ruta], ["aplay", "-q", ruta]):
        if shutil.which(c[0]):
            _estado["proc"] = subprocess.Popen(c, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            _estado["proc"].wait()
            return True
    return False


def _sintetizar(texto, ruta):
    tipo, exe, voz = motor()
    if tipo == "piper":
        p = subprocess.run([exe, "--model", voz, "--output_file", ruta, "--length_scale", "0.95"], input=texto.encode("utf-8"),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        return p.returncode == 0
    if tipo == "pico":
        return subprocess.run([exe, "-l", "es-ES", "-w", ruta, texto], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30).returncode == 0
    if tipo == "espeak":
        return subprocess.run([exe, "-v", "es", "-s", "160", "-w", ruta, texto], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30).returncode == 0
    return False


def _hilo():
    while True:
        texto = _cola.get()
        if texto is None:
            continue
        ruta = os.path.join(tempfile.gettempdir(), "radar-play-voz.wav")
        try:
            _estado["hablando"] = True
            if _sintetizar(texto, ruta):
                _reproducir(ruta)
        except Exception as e:
            LOG.aviso("Voz: %s", e, origen="voz")
        finally:
            _estado["hablando"] = not _cola.empty()
            _estado["proc"] = None


def callar():
    while not _cola.empty():
        try: _cola.get_nowait()
        except Exception: break
    p = _estado["proc"]
    if p and p.poll() is None:
        try: p.terminate()
        except Exception: pass


def decir(texto, cortar=False):
    texto = " ".join(str(texto or "").split())[:600]
    if not texto:
        return {"ok": False}
    if not motor()[0]:
        return {"ok": False, "error": "sin voz"}
    if cortar:
        callar()
    _cola.put(texto)
    _estado["hablando"] = True
    return {"ok": True}


def arrancar(sis=None, obd=None):
    threading.Thread(target=_hilo, daemon=True, name="voz").start()


def g_voz(q):
    return {"motor": motor()[0], "hablando": _estado["hablando"]}


def p_voz(d):
    if d.get("accion") == "callar":
        callar()
        return {"ok": True}
    return decir(d.get("texto"), bool(d.get("cortar")))


GET = {"/api/voz": g_voz}
POST = {"/api/voz": p_voz}
