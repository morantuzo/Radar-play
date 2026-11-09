#!/usr/bin/env python3
"""
Puente de Radar Play
--------------------
- Sirve Radar Play en http://localhost:8080 (necesario para YouTube).
- Lee el motor por OBD-II con un adaptador ELM327 (USB o Bluetooth emparejado)
  y entrega los datos en /api/obd.
- Abre CarPlay (react-carplay) desde el botón del dock con /api/carplay.
- Mando desde el iPhone: con el iPhone en la misma WiFi, abre la página
  /mando (sale un código QR en Ajustes) para mandar destinos, música,
  el modo DNA u órdenes a Siri. Acepta enlaces compartidos de Google Maps.

Requisitos: Python 3.8 o más. Para el OBD-II:  pip install pyserial
Uso:        python3 puente.py            (en Windows: python puente.py)
"""
import json, os, random, re, socket, subprocess, sys, threading, time, webbrowser
import urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# ===================== AJUSTES =====================
PUERTO_WEB = 8080
ABRIR_NAVEGADOR = True          # en la Raspberry lo abre el script de arranque, pon False
PUERTO_OBD = "auto"             # "auto", "/dev/ttyUSB0", "/dev/rfcomm0", "COM5"...
VELOCIDADES_OBD = [38400, 9600, 115200]
# Orden para mostrar CarPlay. Ejemplo en la Raspberry:
# COMANDO_CARPLAY = "/home/pi/Applications/react-carplay.AppImage"
COMANDO_CARPLAY = ""
# Deja que el iPhone (misma WiFi) controle Radar Play. Windows preguntará
# la primera vez si permites el acceso: marca "Redes privadas" y Permitir.
MANDO_IPHONE = True
# ===================================================

# En la Raspberry estos ajustes se leen de sistema/radar-play.conf
import sistema_rp as SIS
import registro as LOG
LOG.iniciar(SIS.cargar_conf().get("LOG_NIVEL", "info"))
import coche as COCHE
import gasolineras as GAS, garaje as GAR, ruedas as RUE, bt as BT, acel as ACEL, dashcam as DASH, leds as LED, apps as APPW, actualizar as ACT, google_cfg as GCFG, whatsapp_web as WAW, voz as VOZ, ytm as YTM, arranque as ARR, obd_can as CAN, relojes as REL
MODULOS = [GAS, GAR, RUE, BT, ACEL, DASH, LED, APPW, ACT, GCFG, WAW, VOZ, YTM, ARR, CAN, REL, LOG]
NO_ANOTAR = ("/api/telemetria", "/api/log", "/api/gasolineras", "/api/ajustes", "/api/whatsapp", "/api/voz", "/api/ytm", "/api/arranque", "/api/can", "/api/relojes")    # muy frecuentes o grandes
_c = SIS.cargar_conf()
if os.path.exists(SIS.CONF_FILE):
    PUERTO_WEB = int(_c["PUERTO"])
    PUERTO_OBD = _c["OBD_PUERTO"] or "auto"
    COMANDO_CARPLAY = _c["CARPLAY_CMD"] or COMANDO_CARPLAY
    MANDO_IPHONE = bool(int(_c["MANDO_IPHONE"]))

CARPETA = os.path.dirname(os.path.abspath(__file__))


def _extras(txt):
    """OBD_EXTRA=nombre|comando|cabecera|fórmula ; ...   (fórmula con A, B, C, D = bytes de la respuesta)"""
    out = []
    for parte in (txt or "").split(";"):
        c = [x.strip() for x in parte.split("|")]
        if len(c) >= 4 and re.fullmatch(r"[0-9A-Fa-f]{4,8}", c[1]) and re.fullmatch(r"[0-9A-Fa-f]{0,8}", c[2]) \
                and re.fullmatch(r"[0-9A-D+\-*/(). ]+", c[3]) and re.fullmatch(r"[a-z_]{2,20}", c[0]):
            out.append({"nombre": c[0], "cmd": c[1].upper(), "cab": c[2].upper(), "formula": c[3]})
    return out


EXTRA_OBD = _extras(_c.get("OBD_EXTRA", ""))
datos = {"ok": False, "estado": "Sin adaptador OBD-II", "ts": 0}
cerrojo = threading.Lock()
def _codigo():
    """Código del mando: se guarda para que el iPhone siga funcionando tras reiniciar o actualizar."""
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos", "mando-codigo")
    try:
        c = open(f).read().strip()
        if re.fullmatch(r"\d{4}", c):
            return c
    except Exception:
        pass
    c = "%04d" % random.randint(0, 9999)
    try:
        os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, "w").write(c)
    except Exception:
        pass
    return c
CODIGO = _codigo()                               # se pide en cada orden del iPhone
ordenes = []                                    # cola de órdenes para Radar Play
ultimo_id = 0
estado_mando = {"url": None}


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


def info_mando():
    """Lo que ve el mando del iPhone: dónde está el coche, garaje y gasolinera más barata."""
    c = COCHE.info()
    p = c.get("aparcado") or {}
    pos = p if p.get("lat") is not None else None
    if not pos and COCHE.tele.get("lat") is not None:
        pos = {"lat": COCHE.tele["lat"], "lng": COCHE.tele["lng"]}
    gas = GAS.mas_barata(pos["lat"], pos["lng"]) if pos else None
    return {"ok": True, "aparcado": c.get("aparcado"), "posicion": pos, "km_total": c.get("km_total"),
            "garaje": {"activo": GAR.estado["activo"], "simulado": GAR.estado["simulado"], "ultima": GAR.estado["ultima"]},
            "gasolinera": gas, "pendientes": c.get("pendientes", [])[:3]}


def resolver_maps(texto):
    """Convierte un enlace compartido de Google Maps en nombre + coordenadas."""
    url = texto.strip()
    final = url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"})
        with urllib.request.urlopen(req, timeout=8) as r:
            final = r.geturl()
    except Exception:
        pass
    if "consent.google" in final:
        cont = urllib.parse.parse_qs(urllib.parse.urlparse(final).query).get("continue")
        if cont:
            final = cont[0]
    final = urllib.parse.unquote(final)
    nombre = None
    m = re.search(r"/maps/place/([^/@?]+)", final)
    if m:
        nombre = urllib.parse.unquote_plus(m.group(1))
    lat = lng = None
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", final) or re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", final)
    if m:
        lat, lng = float(m.group(1)), float(m.group(2))
    q = urllib.parse.parse_qs(urllib.parse.urlparse(final).query)
    for clave in ("q", "query", "destination", "daddr"):
        if clave in q and q[clave][0]:
            v = q[clave][0]
            mm = re.match(r"^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$", v)
            if mm:
                lat, lng = float(mm.group(1)), float(mm.group(2))
            elif not nombre:
                nombre = v
            break
    return {"name": nombre or "Destino compartido", "lat": lat, "lng": lng, "text": nombre}


def nueva_orden(o):
    global ultimo_id
    with cerrojo:
        ultimo_id += 1
        o["id"] = ultimo_id
        ordenes.append(o)
        del ordenes[:-50]
    return o["id"]


def publicar(**kv):
    with cerrojo:
        datos.update(kv)
        datos["ts"] = time.time()


# ===================== OBD-II (ELM327) =====================
class ELM:
    def __init__(self, serial_mod, puerto, baud):
        self.s = serial_mod.Serial(puerto, baud, timeout=1.5)
        self.puerto = puerto

    def cmd(self, c, espera=1.5):
        self.s.reset_input_buffer()
        self.s.write((c + "\r").encode())
        fin = time.time() + espera
        buf = b""
        while time.time() < fin:
            trozo = self.s.read(self.s.in_waiting or 1)
            if trozo:
                buf += trozo
                if b">" in buf:
                    break
        return buf.decode(errors="ignore").replace(">", "").strip()

    def crudo(self, c, resp, espera=1.0):
        """Bytes de la respuesta positiva a un comando (p. ej. 22xxxx → 62xxxx...)."""
        r = self.cmd(c, espera).replace(" ", "").replace("\r", "").replace("\n", "").upper()
        i = r.find(resp)
        if i < 0:
            return None
        h = re.sub(r"[^0-9A-F]", "", r[i + len(resp):])
        try:
            return [int(h[k:k + 2], 16) for k in range(0, len(h) - 1, 2)]
        except ValueError:
            return None

    def pid(self, p):
        r = self.cmd("01" + p, 1.0).replace(" ", "").replace("\r", "").replace("\n", "").upper()
        i = r.find("41" + p)
        if i < 0:
            return None
        h = r[i + 4:]
        try:
            return [int(h[k:k + 2], 16) for k in range(0, min(len(h), 8), 2)]
        except ValueError:
            return None


def buscar_puertos(serial_mod):
    if PUERTO_OBD != "auto":
        return [PUERTO_OBD]
    from serial.tools import list_ports
    lista = [p.device for p in list_ports.comports() if p.device != SIS.CONF["GPS_PUERTO"] and not REL.es_reloj_usb(p)]
    relojes = set(REL.puertos_reloj())
    for extra in ("/dev/rfcomm0", "/dev/ttyUSB0", "/dev/ttyACM0"):
        if os.path.exists(extra) and extra not in lista and extra not in relojes:
            lista.append(extra)
    # primero los que parecen un ELM327 / adaptador USB-serie
    lista.sort(key=lambda d: 0 if re.search(r"USB|ACM|rfcomm|COM", d, re.I) else 1)
    return lista


def conectar(serial_mod):
    try:                                     # 1º el HAT CAN (Waveshare RS485 CAN HAT): directo al bus, sin ELM327
        e = CAN.conectar_obd()
        if e:
            return e
        if CAN.estado.get("hay"):
            publicar(ok=False, estado=CAN.estado.get("msg") or "HAT CAN listo, esperando al coche")
    except Exception as ex:
        LOG.aviso("CAN: %s", ex, origen="can")
    if serial_mod is None:
        return None
    for puerto in buscar_puertos(serial_mod):
        for baud in VELOCIDADES_OBD:
            try:
                e = ELM(serial_mod, puerto, baud)
                r = e.cmd("ATZ", 3)
                if "ELM" not in r.upper():
                    e.s.close()
                    continue
                for c in ("ATE0", "ATL0", "ATS0", "ATH0", "ATSP0"):
                    e.cmd(c)
                if e.pid("0C") is None:          # el coche aún no responde (¿contacto quitado?)
                    publicar(ok=False, estado="Adaptador en %s, esperando al coche (pon el contacto)" % puerto)
                    e.s.close()
                    time.sleep(3)
                    continue
                return e
            except Exception:
                continue
    return None


def hilo_obd():
    try:
        import serial  # pyserial
    except ImportError:
        serial = None                       # sin pyserial aún se puede leer por el HAT CAN
    while True:
        e = conectar(serial)
        if not e:
            if not CAN.estado.get("hay"):
                publicar(ok=False, estado="No encuentro el adaptador OBD-II" if serial else "Falta pyserial y no hay HAT CAN")
            time.sleep(5)
            continue
        publicar(ok=True, estado="OBD-II conectado en " + e.puerto)
        soportados = set()
        for base in ("00", "20", "40", "60"):          # qué PIDs entiende la centralita
            b = e.pid(base)
            if not b or len(b) < 4:
                break
            n = int("".join("%02X" % x for x in b[:4]), 16)
            for i in range(32):
                if n & (1 << (31 - i)):
                    soportados.add("%02X" % (int(base, 16) + i + 1))
            if not n & 1:
                break
        publicar(pids=sorted(soportados))
        baro = e.pid("33")
        baro = baro[0] if baro else 101
        vuelta = 0
        try:
            while True:
                rpm = e.pid("0C"); vel = e.pid("0D"); mapa = e.pid("0B")
                if rpm is None and vel is None:
                    raise IOError("sin respuesta")
                v = {}
                if rpm and len(rpm) >= 2: v["rpm"] = (rpm[0] * 256 + rpm[1]) / 4
                if vel: v["speed"] = vel[0]
                if mapa: v["boost"] = max(0.0, (mapa[0] - baro) / 100.0)
                if vuelta % 8 == 0:
                    for pid, nombre, f in (("05", "coolant", lambda b: b[0] - 40),
                                           ("0F", "iat", lambda b: b[0] - 40),
                                           ("11", "throttle", lambda b: b[0] * 100 / 255),
                                           ("5C", "oil", lambda b: b[0] - 40),
                                           ("04", "load", lambda b: b[0] * 100 / 255)):
                        b = e.pid(pid)
                        if b: v[nombre] = f(b)
                    volt = re.search(r"(\d+\.\d)", e.cmd("ATRV", 1.0))
                    if volt: v["volt"] = float(volt.group(1))
                    if "7C" in soportados:                 # temperatura del filtro de partículas (estándar)
                        b = e.crudo("017C", "417C")
                        if b and len(b) >= 3: v["dpf_temp"] = round((b[1] * 256 + b[2]) / 10 - 40)
                    if "7A" in soportados:                 # presión diferencial del FAP
                        b = e.crudo("017A", "417A")
                        if b and len(b) >= 3: v["dpf_dp"] = round((b[1] * 256 + b[2]) / 100, 2)
                if vuelta % 40 == 5 and EXTRA_OBD:             # PIDs propios del fabricante (FAP...)
                    for x in EXTRA_OBD:
                        try:
                            if x["cab"]: e.cmd("ATSH" + x["cab"], 0.5)
                            b = e.crudo(x["cmd"], "%02X" % (int(x["cmd"][:2], 16) + 0x40) + x["cmd"][2:])
                            if x["cab"]: e.cmd("ATSH7DF", 0.5)
                            if b:
                                env = {k: (b[i] if i < len(b) else 0) for i, k in enumerate("ABCD")}
                                v[x["nombre"]] = round(eval(x["formula"], {"__builtins__": {}}, env), 2)
                        except Exception:
                            pass
                publicar(ok=True, **v)
                vuelta += 1
                time.sleep(0.05)
        except Exception:
            publicar(ok=False, estado="Conexión OBD-II perdida, reintentando…")
            try: e.s.close()
            except Exception: pass
            time.sleep(2)


# ===================== SERVIDOR WEB =====================
class Manejador(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=CARPETA, **k)

    def log_message(self, fmt, *a):
        LOG.debug(fmt % a, origen="http")

    def end_headers(self):
        # Que el navegador pida siempre la versión nueva de la página y los scripts
        # (si no, tras actualizar puede seguir usando archivos viejos guardados)
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def responder(self, obj, codigo=200):
        b = json.dumps(obj).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def es_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def leer_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(min(n, 40000000)) or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        ruta = urllib.parse.urlparse(self.path)
        if ruta.path in ("/mando", "/mando.html"):
            self.path = "/mando.html"
            return super().do_GET()
        if ruta.path in ("/actualizar", "/actualizar.html"):      # subir una versión nueva desde el iPhone o el PC
            self.path = "/actualizar.html"
            return super().do_GET()
        if ruta.path == "/api/whatsapp/pantalla" and self.es_local():   # WhatsApp Web en directo (imágenes MJPEG)
            q = urllib.parse.parse_qs(ruta.query)
            return WAW.emitir(self, int((q.get("w") or ["1100"])[0]), int((q.get("h") or ["650"])[0]))
        if ruta.path == "/arranque/logo.png":                      # tu logo de arranque
            l = ARR.logo()
            if not l:
                self.send_error(404); return
            b = open(l, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "image/png" if l.endswith(".png") else "image/jpeg")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if ruta.path == "/api/actualizar/registro":               # descargar el registro de fallos desde el iPhone (con código)
            q = urllib.parse.parse_qs(ruta.query)
            if not self.es_local() and (q.get("k") or [""])[0] != CODIGO:
                return self.responder({"ok": False, "error": "Código incorrecto. Abre esta página desde el mando."}, 403)
            todo = (q.get("tipo") or [""])[0] == "todo"
            lineas = LOG.ultimas(8000 if todo else 3000, None if todo else "errores")
            cab = ["Radar Play · registro %s" % ("completo" if todo else "de errores y avisos"),
                   "Versión: %s · %s · %s" % (SIS.VERSION, SIS.MODELO or "", time.strftime("%Y-%m-%d %H:%M:%S")),
                   "Errores: %d · Avisos: %d (desde %s)" % (LOG.cuenta["errores"], LOG.cuenta["avisos"], time.strftime("%Y-%m-%d %H:%M", time.localtime(LOG.cuenta["desde"]))),
                   "=" * 70, ""]
            cuerpo = ("\n".join(cab + (lineas or ["(sin líneas)"])) + "\n").encode("utf-8")
            nombre = "radar-play-%s-%s.txt" % ("registro" if todo else "errores", time.strftime("%Y%m%d-%H%M"))
            LOG.info("Registro descargado desde %s (%s)", self.client_address[0], "completo" if todo else "errores")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % nombre)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        if ruta.path == "/api/can/grabacion":                     # última grabación del bus CAN (para mandármela)
            q = urllib.parse.parse_qs(ruta.query)
            if not self.es_local() and (q.get("k") or [""])[0] != CODIGO:
                return self.responder({"ok": False, "error": "Código incorrecto. Abre esta página desde el mando."}, 403)
            g = CAN.ultima_grabacion()
            if not g:
                return self.responder({"ok": False, "error": "Aún no hay ninguna grabación del bus"}, 404)
            b = open(g, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % os.path.basename(g))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        if ruta.path == "/api/actualizar/estado":                 # solo versión y progreso (sin código: sigue tras reiniciar)
            i = ACT.info()
            return self.responder({k: i[k] for k in ("version", "anterior", "fase", "msg", "ok", "log", "completa", "online")})
        if ruta.path == "/api/mando":                 # info para el mando del iPhone (con código)
            k = (urllib.parse.parse_qs(ruta.query).get("k") or [""])[0]
            if not self.es_local() and k != CODIGO:
                return self.responder({"ok": False, "error": "Código incorrecto. Vuelve a escanear el QR."}, 403)
            return self.responder(info_mando())
        if not self.es_local():                       # desde la WiFi solo se sirve el mando
            return self.send_error(403)
        for m in MODULOS:
            if ruta.path in m.GET:
                try:
                    return self.responder(m.GET[ruta.path](urllib.parse.parse_qs(ruta.query)))
                except Exception as ex:
                    LOG.error("Fallo en %s: %s", ruta.path, ex, exc=True)
                    return self.responder({"ok": False, "error": str(ex)}, 500)
        if ruta.path == "/api/obd":
            with cerrojo:
                return self.responder(dict(datos))
        if ruta.path == "/api/sistema":
            return self.responder(SIS.info())
        if ruta.path == "/api/coche":
            return self.responder(COCHE.info())
        if ruta.path == "/api/camara":
            return self.responder(dict(SIS.camara))
        if ruta.path == "/api/contacto":
            return self.responder(dict(SIS.contacto))
        if ruta.path == "/api/gps":
            return self.responder(dict(SIS.gps))
        if ruta.path == "/api/ajustes":
            return self.responder(SIS.leer_ajustes())
        if ruta.path == "/api/estado":
            return self.responder({"puente": True, "carplay": bool(COMANDO_CARPLAY),
                                   "mando": estado_mando if estado_mando["url"] else None, "ultimo": ultimo_id})
        if ruta.path == "/api/cmd":
            desde = int((urllib.parse.parse_qs(ruta.query).get("desde") or ["0"])[0] or 0)
            with cerrojo:
                return self.responder({"cmds": [o for o in ordenes if o["id"] > desde]})
        if self.path in ("/", ""):
            self.path = "/radar-play-google.html"
        return super().do_GET()

    def do_POST(self):
        ruta = urllib.parse.urlparse(self.path)
        if ruta.path == "/api/cmd":
            k = (urllib.parse.parse_qs(ruta.query).get("k") or [""])[0]
            if not self.es_local() and k != CODIGO:
                LOG.aviso("Mando rechazado desde %s (código incorrecto)", self.client_address[0])
                return self.responder({"ok": False, "error": "Código incorrecto. Vuelve a escanear el QR."}, 403)
            o = self.leer_json()
            if o.get("type") not in ("dest", "music", "dna", "siri", "msg", "call", "sim"):
                return self.responder({"ok": False, "error": "Orden no válida"}, 400)
            LOG.info("Mando del iPhone (%s): %s", self.client_address[0], o.get("type"), origen="acción")
            if o.get("type") == "dest" and re.match(r"^https?://", str(o.get("text", "")).strip()):
                o.update(resolver_maps(o["text"]))
            nueva_orden(o)
            return self.responder({"ok": True, "dest": o.get("name")})
        if ruta.path in ("/api/actualizar/subir", "/api/actualizar/remoto", "/api/actualizar/contactos", "/api/actualizar/arranque"):
            k = (urllib.parse.parse_qs(ruta.query).get("k") or [""])[0]
            if not self.es_local() and k != CODIGO:
                LOG.aviso("Actualización rechazada desde %s (código incorrecto)", self.client_address[0])
                return self.responder({"ok": False, "error": "Código incorrecto. Abre esta página desde el mando (escanea el QR)."}, 403)
            LOG.info("Actualización desde %s", self.client_address[0], origen="actualizar")
            if ruta.path.endswith("arranque"):                  # logo o sonido de arranque desde el iPhone
                n = int(self.headers.get("Content-Length") or 0)
                if n <= 0 or n > 25_000_000:
                    return self.responder({"ok": False, "error": "Archivo vacío o demasiado grande (máximo 25 MB)"})
                tipo = (urllib.parse.parse_qs(ruta.query).get("tipo") or [""])[0]
                return self.responder(ARR.subir(tipo, self.rfile.read(n), self.headers.get("Content-Type")))
            if ruta.path.endswith("contactos"):
                n = int(self.headers.get("Content-Length") or 0)
                if n <= 0 or n > 20_000_000:
                    return self.responder({"ok": False, "error": "Archivo vacío o demasiado grande"})
                return self.responder(BT.importar_vcf(self.rfile.read(n)))
            if ruta.path.endswith("subir"):
                return self.responder(ACT.recibir(self.rfile, int(self.headers.get("Content-Length") or 0)))
            d = self.leer_json()
            if d.get("accion") in ("google", "comprobar"):
                return self.responder(GCFG.p_google({**d, "accion": None if d.get("accion") == "google" else "comprobar"}))
            if d.get("accion") == "buscar":
                return self.responder(ACT.buscar_online())
            if d.get("accion") in ("arranque_probar", "arranque_quitar", "arranque_ajustes"):
                sub = d["accion"].split("_", 1)[1]
                return self.responder(ARR.p_arr({**d, "accion": sub}))
            if d.get("accion") == "ytm_login":                   # YouTube Music: abre la ventana para entrar en la pantalla
                return self.responder(YTM.iniciar_sesion())
            if d.get("accion") == "ytm_cabeceras":               # YouTube Music: plan B con las cabeceras del ordenador
                return self.responder(YTM.desde_cabeceras(d.get("texto")))
            if d.get("accion") == "ytm_estado":
                return self.responder({k: YTM.estado[k] for k in ("cuenta", "nombre", "msg", "error", "login", "preparando")})
            if d.get("accion") not in ("enlace", "deshacer", "online"):
                return self.responder({"ok": False, "error": "Acción no válida"}, 400)
            return self.responder(ACT.p_act(d))
        if ruta.path == "/api/mando":
            k = (urllib.parse.parse_qs(ruta.query).get("k") or [""])[0]
            if not self.es_local() and k != CODIGO:
                return self.responder({"ok": False, "error": "Código incorrecto. Vuelve a escanear el QR."}, 403)
            d = self.leer_json()
            LOG.info("Mando del iPhone (%s): %s", self.client_address[0], d.get("accion"), origen="acción")
            if d.get("accion") == "garaje":
                return self.responder(GAR.pulsar("iPhone"))
            return self.responder({"ok": False, "error": "Acción desconocida"}, 400)
        if not self.es_local():
            return self.send_error(403)
        for m in MODULOS:
            if ruta.path in m.POST:
                d = self.leer_json()
                try:
                    r = m.POST[ruta.path](d)
                    if ruta.path not in NO_ANOTAR:
                        acc = d.get("accion") or d.get("orden") or ",".join(k for k in d if k not in ("lista", "bruto"))[:60]
                        (LOG.info if not isinstance(r, dict) or r.get("ok", True) else LOG.aviso)(
                            "%s %s → %s", ruta.path, acc, "ok" if not isinstance(r, dict) or r.get("ok", True) else r.get("error"), origen="acción")
                    return self.responder(r)
                except Exception as ex:
                    LOG.error("Fallo en %s: %s", ruta.path, ex, exc=True)
                    return self.responder({"ok": False, "error": str(ex)}, 500)
        if ruta.path == "/api/sistema":
            d = self.leer_json()
            try:
                return self.responder(SIS.accion(str(d.get("accion", "")), d))
            except Exception as ex:
                return self.responder({"ok": False, "error": str(ex)}, 500)
        if ruta.path == "/api/ajustes":
            return self.responder(SIS.guardar_ajustes(self.leer_json()))
        if ruta.path == "/api/telemetria":
            COCHE.telemetria(self.leer_json())
            return self.responder({"ok": True})
        if ruta.path == "/api/coche":
            try:
                return self.responder(COCHE.accion(self.leer_json()))
            except Exception as ex:
                return self.responder({"ok": False, "error": str(ex)}, 500)
        if ruta.path == "/api/carplay":
            if not COMANDO_CARPLAY:
                return self.responder({"ok": False, "error": "Configura COMANDO_CARPLAY en puente.py"}, 400)
            try:
                subprocess.Popen(COMANDO_CARPLAY, shell=True)
                return self.responder({"ok": True})
            except Exception as ex:
                return self.responder({"ok": False, "error": str(ex)}, 500)
        self.send_error(404)


if __name__ == "__main__":
    threading.Thread(target=hilo_obd, daemon=True).start()
    SIS.arrancar_hilos()

    def _obd():
        with cerrojo:
            d = dict(datos)
        d["ok"] = d.get("ok") and time.time() - d.get("ts", 0) < 5
        return d
    COCHE.arrancar(SIS, _obd)
    for m in MODULOS:
        try:
            m.arrancar(SIS, _obd)
        except Exception as ex:
            print("No arranca", m.__name__, ex)
    SIS.al_apagar.append(COCHE.apagando)
    SIS.al_apagar.append(lambda: LOG.info("Apagando (llave quitada o apagado desde la pantalla)"))
    LOG.arranque(SIS, SIS.VERSION)

    def _corto(x, n=60):
        return str(x)[:n] if x is not None else "—"
    LOG.vigia([
        ("OBD-II", lambda: _corto(datos.get("estado"))),
        ("GPS", lambda: _corto(SIS.gps.get("estado"))),
        ("Llave", lambda: ("contacto" if SIS.contacto["on"] else "quitada") if SIS.contacto["activo"] else "sin cable"),
        ("Marcha atrás", lambda: ("puesta" if SIS.camara.get("atras") else "no") if SIS.camara.get("activo") else "sin cable"),
        ("iPhone", lambda: BT.estado["telefono"]["nombre"] if BT.estado.get("telefono") else _corto(BT.estado.get("msg"))),
        ("Llamada", lambda: ",".join(c["estado"] for c in BT.estado.get("llamadas", [])) or "ninguna"),
        ("Música iPhone", lambda: (BT.estado["musica"] or {}).get("estado") or "—" if BT.estado.get("musica") else "—"),
        ("Ruedas", lambda: "; ".join("%s %s" % (p, a[1]) for p, r in RUE.resumen()["ruedas"].items() for a in r.get("avisos", []) if a[0] != "info") or "%d sensores" % RUE.resumen()["n_vistos"]),
        ("Garaje", lambda: "%s desde %s" % (GAR.estado["ultima"]["hora"], GAR.estado["ultima"]["origen"]) if GAR.estado.get("ultima") else _corto(GAR.estado.get("msg"))),
        ("Dashcam", lambda: _corto(DASH.estado.get("msg"))),
        ("Golpe", lambda: "%s · %.1f g" % (ACEL.estado["golpe"]["hora"], ACEL.estado["golpe"]["g"]) if ACEL.estado.get("golpe") else "ninguno"),
        ("Gasolineras", lambda: "%d precios" % GAS.estado["n"] if GAS.estado["n"] else _corto(GAS.estado.get("error") or "sin datos")),
        ("Viaje", lambda: "en curso" if COCHE.viajes.v else "parado"),
    ])
    import signal
    def _fin(*_):
        LOG.info("Radar Play se cierra (señal del sistema)")
        SIS.antes_de_apagar()
        os._exit(0)
    signal.signal(signal.SIGTERM, _fin)
    srv = None
    # Si el puerto está ocupado o bloqueado por Windows, prueba con otros
    for puerto in [PUERTO_WEB, 8090, 8765, 18080, 28080, 38080]:
        for host in (["0.0.0.0"] if MANDO_IPHONE else []) + ["127.0.0.1"]:
            try:
                srv = ThreadingHTTPServer((host, puerto), Manejador)
                break
            except OSError:
                pass
        if srv:
            break
        print("El puerto %d no está disponible, pruebo otro…" % puerto)
    if not srv:
        print("No he encontrado ningún puerto libre. Cierra otras ventanas de Radar Play y vuelve a probar.")
        sys.exit(1)
    if srv.server_address[0] == "0.0.0.0":
        # Al arrancar el coche la WiFi suele tardar: se mira cada 10 s y se actualiza si cambia la IP
        def vigila_ip():
            antes = None
            while True:
                ip = ip_local()
                if ip and ip != antes and not ip.startswith("127."):
                    estado_mando["url"] = "http://%s:%d/mando?k=%s" % (ip, puerto, CODIGO)
                    LOG.info("Mando del iPhone (misma WiFi): %s", estado_mando["url"])
                elif not ip and antes:
                    estado_mando["url"] = None
                    LOG.aviso("Sin WiFi: el mando del iPhone no está disponible")
                antes = ip
                time.sleep(10)
        threading.Thread(target=vigila_ip, daemon=True, name="ip-mando").start()
    else:
        LOG.aviso("El puente solo escucha en este equipo (MANDO_IPHONE=0 o el puerto está ocupado)")
    try:
        with open(os.path.join(SIS.DATOS, "puerto"), "w") as f:
            f.write(str(puerto))
    except Exception:
        pass
    url = "http://localhost:%d/radar-play-google.html" % puerto
    print("Radar Play funcionando en", url)
    print("Deja esta ventana abierta mientras lo uses. Ctrl+C para apagarlo.")
    if ABRIR_NAVEGADOR and "--sin-navegador" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
