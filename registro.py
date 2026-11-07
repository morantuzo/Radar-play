"""
Radar Play · Registro (log) para depurar
Escribe en datos/logs/radar-play.log (se rota: 5 archivos de 2 MB como máximo):
  - el arranque (versión, sistema, configuración, qué piezas detecta),
  - las acciones (lo que pulsas en la pantalla, órdenes del mando, ajustes),
  - los cambios de estado (OBD, GPS, llave, marcha atrás, iPhone, ruedas, dashcam…),
  - y todos los errores, de la pantalla y del puente, con su traza.
No guarda contraseñas, claves, números de teléfono ni textos que escribas.
Nivel: LOG_NIVEL=info (normal) o debug (todo, también cada petición) en radar-play.conf.
"""
import glob, logging, logging.handlers, os, platform, shutil, sys, threading, time, traceback

CARPETA = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.join(CARPETA, "datos", "logs")
ARCHIVO = os.path.join(DIR, "radar-play.log")
log = logging.getLogger("radarplay")
cuenta = {"errores": 0, "avisos": 0, "desde": time.time()}


class _Contador(logging.Handler):
    def emit(self, r):
        if r.levelno >= logging.ERROR:
            cuenta["errores"] += 1
        elif r.levelno >= logging.WARNING:
            cuenta["avisos"] += 1


class _Salida:
    """Lo que el programa imprime (print) también va al log."""
    def __init__(self, orig, nivel):
        self.orig, self.nivel, self.buf = orig, nivel, ""

    def write(self, s):
        try:
            if self.orig:
                self.orig.write(s)
        except Exception:
            pass
        self.buf += s
        while "\n" in self.buf:
            linea, self.buf = self.buf.split("\n", 1)
            if linea.strip():
                log.log(self.nivel, linea.rstrip(), extra={"origen": "puente"})

    def flush(self):
        try:
            if self.orig:
                self.orig.flush()
        except Exception:
            pass


class _Formato(logging.Formatter):
    def format(self, r):
        r.origen = getattr(r, "origen", "puente")
        return super().format(r)


def iniciar(nivel="info"):
    os.makedirs(DIR, exist_ok=True)
    log.setLevel(logging.DEBUG if str(nivel).lower() == "debug" else logging.INFO)
    h = logging.handlers.RotatingFileHandler(ARCHIVO, maxBytes=2_000_000, backupCount=4, encoding="utf-8")
    h.setFormatter(_Formato("%(asctime)s %(levelname)-7s [%(origen)s] %(message)s", "%Y-%m-%d %H:%M:%S"))
    log.addHandler(h)
    log.addHandler(_Contador())
    sys.stdout = _Salida(sys.__stdout__, logging.INFO)
    sys.stderr = _Salida(sys.__stderr__, logging.WARNING)

    def _exc(t, v, tb):
        log.error("Error sin capturar: %s", "".join(traceback.format_exception(t, v, tb)).strip())
    sys.excepthook = _exc
    threading.excepthook = lambda a: log.error("Error en el hilo %s: %s", a.thread.name if a.thread else "?",
                                               "".join(traceback.format_exception(a.exc_type, a.exc_value, a.exc_traceback)).strip())
    return log


def arranque(sis, version="", puerto=None):
    c = sis.CONF
    log.info("=" * 60)
    log.info("Radar Play arranca%s · Python %s · %s", " " + version if version else "", platform.python_version(), sis.MODELO or platform.platform())
    secretos = ("CLAVE", "TOKEN", "PASS")
    log.info("Configuración: %s", ", ".join("%s=%s" % (k, v) for k, v in sorted(c.items()) if not any(s in k for s in secretos)))
    if puerto:
        log.info("Puerto %s", puerto)


def info(msg, *a, origen="puente"):
    log.info(msg, *a, extra={"origen": origen})


def aviso(msg, *a, origen="puente"):
    log.warning(msg, *a, extra={"origen": origen})


def error(msg, *a, origen="puente", exc=False):
    log.error(msg, *a, extra={"origen": origen}, exc_info=exc)


def debug(msg, *a, origen="puente"):
    log.debug(msg, *a, extra={"origen": origen})


# ---------- Lo que manda la pantalla ----------
NIVELES = {"error": logging.ERROR, "aviso": logging.WARNING, "warn": logging.WARNING, "info": logging.INFO, "debug": logging.DEBUG}


def de_pantalla(d):
    n = 0
    for l in (d.get("lineas") or [])[:300]:
        nivel = NIVELES.get(str(l.get("nivel", "info")).lower(), logging.INFO)
        msg = str(l.get("msg", ""))[:2000].replace("\n", " ⏎ ")
        log.log(nivel, "%s", msg, extra={"origen": "pantalla"})
        n += 1
    return {"ok": True, "n": n}


# ---------- Vigía: anota los cambios de estado ----------
def vigia(fuentes):
    """fuentes: lista de (nombre, función que devuelve un valor corto). Anota cuando cambia."""
    ult = {}

    def hilo():
        while True:
            for nombre, f in fuentes:
                try:
                    v = f()
                except Exception as e:
                    v = "error: %s" % e
                if nombre in ult and ult[nombre] != v:
                    log.info("%s: %s → %s", nombre, ult[nombre], v, extra={"origen": "estado"})
                elif nombre not in ult:
                    log.info("%s: %s", nombre, v, extra={"origen": "estado"})
                ult[nombre] = v
            time.sleep(2)
    threading.Thread(target=hilo, daemon=True, name="vigia-log").start()


# ---------- Ver, copiar y borrar ----------
def ultimas(n=300, nivel=None):
    lineas = []
    for f in sorted(glob.glob(ARCHIVO + ".*"), reverse=True) + [ARCHIVO]:
        try:
            with open(f, encoding="utf-8", errors="ignore") as fh:
                lineas += fh.read().splitlines()
        except Exception:
            pass
    if nivel == "errores":
        lineas = [l for l in lineas if " ERROR " in l or " WARNING " in l]
    return lineas[-n:]


def usb_destinos():
    user = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
    return [d for d in glob.glob("/media/%s/*" % user) + glob.glob("/media/*/*") if os.path.isdir(d) and os.access(d, os.W_OK)]


def copiar_usb():
    dest = usb_destinos()
    if not dest:
        return {"ok": False, "error": "No encuentro ningún pendrive. Conéctalo y vuelve a probar."}
    d = os.path.join(dest[0], "radar-play-logs-" + time.strftime("%Y%m%d-%H%M"))
    os.makedirs(d, exist_ok=True)
    for f in glob.glob(os.path.join(DIR, "*")):
        shutil.copy2(f, d)
    log.info("Logs copiados a %s", d)
    try:
        os.sync()
    except Exception:
        pass
    return {"ok": True, "ruta": d}


def borrar():
    for f in glob.glob(ARCHIVO + ".*"):
        try: os.remove(f)
        except Exception: pass
    try:
        open(ARCHIVO, "w").close()
    except Exception:
        pass
    cuenta.update(errores=0, avisos=0, desde=time.time())
    log.info("Log borrado desde la pantalla")
    return {"ok": True}


def g_log(q):
    n = int((q.get("n") or ["300"])[0])
    nivel = (q.get("nivel") or [None])[0]
    return {"lineas": ultimas(min(n, 2000), nivel), "archivo": ARCHIVO, **cuenta, "usb": bool(usb_destinos()), "nivel": logging.getLevelName(log.level)}


def p_log(d):
    a = d.get("accion")
    if a == "usb":
        return copiar_usb()
    if a == "borrar":
        return borrar()
    return de_pantalla(d)


def arrancar(sis=None, obd=None):
    pass


GET = {"/api/log": g_log}
POST = {"/api/log": p_log}
