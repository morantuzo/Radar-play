"""
Radar Play · Relojes redondos (3 pantallas tipo smartwatch por USB)
- Placas: Waveshare ESP32-S3-LCD-1.28 (o la -B con caja metálica). Cada una
  va por su cable USB a la Raspberry: alimentación y datos por el mismo cable.
- Cada reloj enseña un dato del motor (turbo, aceite, refrigerante…) y se
  encienden cuando Radar Play está en Dynamic (o siempre, si lo eliges).
- La primera vez Radar Play las «prepara» él solo: les instala MicroPython y
  el programa del reloj (reloj_firmware/). Luego se actualizan solas.
"""
import glob, json, os, re, shutil, subprocess, sys, threading, time, urllib.request
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
FW = os.path.join(CARPETA, "reloj_firmware")
DATOS = os.path.join(CARPETA, "datos")
CONF = os.path.join(DATOS, "relojes.json")
MPY_BIN = os.path.join(DATOS, "micropython-esp32s3.bin")
MPY_RESPALDO = "https://micropython.org/resources/firmware/ESP32_GENERIC_S3-20241129-v1.24.1.bin"
VID_PID = {(0x1A86, 0x55D3), (0x1A86, 0x55D4), (0x303A, 0x1001)}   # CH343 (la de Waveshare) y el USB propio del ESP32-S3
VER_FW = 3

DATOS_MOTOR = {
    "turbo":   {"n": "Turbo",          "campo": "boost",    "t": "TURBO",   "u": "BAR", "min": 0,   "max": 2.0, "d": 2, "rojo": 1.8,  "frio": None, "pico": 1},
    "aceite":  {"n": "Aceite",         "campo": "oil",      "t": "ACEITE",  "u": "°C",  "min": 40,  "max": 150, "d": 0, "rojo": 130,  "frio": 70,   "pico": 0},
    "agua":    {"n": "Refrigerante",   "campo": "coolant",  "t": "AGUA",    "u": "°C",  "min": 40,  "max": 130, "d": 0, "rojo": 108,  "frio": 70,   "pico": 0},
    "rpm":     {"n": "Revoluciones",   "campo": "rpm",      "t": "RPM",     "u": "",    "min": 0,   "max": 5000, "d": 0, "rojo": 4500, "frio": None, "pico": 1},
    "volt":    {"n": "Batería",        "campo": "volt",     "t": "BATERIA", "u": "V",   "min": 10,  "max": 16,  "d": 1, "rojo": 15.2, "frio": 12.0, "pico": 0},
    "admision": {"n": "Aire admisión", "campo": "iat",      "t": "ADMISION", "u": "°C", "min": -10, "max": 80,  "d": 0, "rojo": 60,   "frio": None, "pico": 0},
    "fap":     {"n": "Temperatura FAP", "campo": "dpf_temp", "t": "FAP",    "u": "°C",  "min": 0,   "max": 700, "d": 0, "rojo": 650,  "frio": None, "pico": 1},
    "carga":   {"n": "Carga motor",    "campo": "load",     "t": "CARGA",   "u": "%",   "min": 0,   "max": 100, "d": 0, "rojo": 95,   "frio": None, "pico": 0},
}
ORDEN = ["turbo", "aceite", "agua"]

_int = {"obd": None, "dna": None, "dna_t": 0, "demo_hasta": 0, "relojes": {}, "probados": {}, "ocupados": set(),
        "prep": {"activo": False, "msg": "", "ok": None}}
_cerrojo = threading.Lock()


# ---------- ajustes ----------
def conf():
    try:
        c = json.load(open(CONF))
    except Exception:
        c = {}
    return {"modo": c.get("modo", "dynamic"), "brillo": int(c.get("brillo", 80)), "rb": int(c.get("rb", 0)),
            "roles": c.get("roles", {}), "placa": c.get("placa", "lcd128")}


def _guardar(**kv):
    c = conf()
    c.update(kv)
    os.makedirs(DATOS, exist_ok=True)
    json.dump(c, open(CONF, "w"))
    return c


def _rol(uid):
    c = conf()
    r = c["roles"].get(uid)
    if r in DATOS_MOTOR:
        return r
    usados = set(c["roles"].values())
    r = next((x for x in ORDEN if x not in usados), "turbo")     # los nuevos: turbo, aceite, agua
    roles = dict(c["roles"]); roles[uid] = r
    _guardar(roles=roles)
    return r


def _encendidos():
    c = conf()
    if time.time() < _int["demo_hasta"]:
        return True
    if c["modo"] == "siempre":
        return True
    if c["modo"] == "off":
        return False
    return _int["dna"] == "D" and time.time() - _int["dna_t"] < 120


def _valor(rol):
    if time.time() < _int["demo_hasta"]:
        import math
        t = time.time()
        m = DATOS_MOTOR[rol]
        return round(m["min"] + (m["max"] - m["min"]) * (0.5 + 0.48 * math.sin(t * (0.7 + ORDEN.index(rol) * 0.23 if rol in ORDEN else 0.5))), 2)
    d = _int["obd"]() if _int["obd"] else {}
    if not d.get("ok"):
        return None
    v = d.get(DATOS_MOTOR[rol]["campo"])
    return round(v, 3) if isinstance(v, (int, float)) else None


# ---------- puertos ----------
def _serial():
    try:
        import serial
        from serial.tools import list_ports
        return serial, list_ports
    except ImportError:
        return None, None


def es_reloj_usb(p):
    return (p.vid, p.pid) in VID_PID


def puertos_reloj():
    _, lp = _serial()
    if not lp:
        return []
    out = [p.device for p in lp.comports() if es_reloj_usb(p)]
    try:
        import sistema_rp as SIS
        out += [x.strip() for x in str(SIS.CONF.get("RELOJES_PUERTOS", "")).split(",") if x.strip()]
    except Exception:
        pass
    return list(dict.fromkeys(out))


class Reloj:
    def __init__(self, puerto, s, info):
        self.puerto, self.s, self.id, self.v, self.placa = puerto, s, info.get("id", puerto), info.get("v", 0), info.get("placa", "")
        self.rol = _rol(self.id)
        self.on = None
        self.vivo = True
        self.cfg_enviada = None
        self.brillo = None
        self.rb = None

    def tx(self, o):
        self.s.write((json.dumps(o) + "\n").encode())

    def enviar_cfg(self):
        m = DATOS_MOTOR[self.rol]
        self.tx({"cfg": {k: m[k] for k in ("t", "u", "min", "max", "d", "rojo", "frio", "pico")}})
        self.cfg_enviada = self.rol

    def bucle(self):
        try:
            while self.vivo:
                c = conf()
                if self.rb != c["rb"]:
                    self.tx({"rb": c["rb"]}); self.rb = c["rb"]; self.cfg_enviada = None
                rol = c["roles"].get(self.id, self.rol)
                if rol in DATOS_MOTOR and rol != self.rol:
                    self.rol = rol
                if self.cfg_enviada != self.rol:
                    self.enviar_cfg()
                if self.brillo != c["brillo"]:
                    self.tx({"brillo": c["brillo"]}); self.brillo = c["brillo"]
                on = _encendidos()
                msg = {"on": 1 if on else 0}
                if on:
                    msg["v"] = _valor(self.rol)
                self.tx(msg)
                self.on = on
                try:
                    self.s.read(self.s.in_waiting or 0)
                except Exception:
                    pass
                time.sleep(0.12 if on else 1.0)
        except Exception as e:
            LOG.aviso("Reloj %s desconectado: %s", self.puerto, str(e)[:80], origen="relojes")
        finally:
            self.vivo = False
            try: self.s.close()
            except Exception: pass
            with _cerrojo:
                if _int["relojes"].get(self.puerto) is self:
                    del _int["relojes"][self.puerto]


def _saludar(puerto):
    """Abre el puerto y pregunta «¿quién eres?». Devuelve (serial, info) si es un reloj de Radar Play."""
    serial, _ = _serial()
    try:
        s = serial.Serial(puerto, 115200, timeout=0.2, write_timeout=1)
    except Exception:
        return None, None
    time.sleep(0.3)
    try:
        s.reset_input_buffer()
        fin = time.time() + 3.5
        siguiente = 0
        resto = b""
        while time.time() < fin:
            if time.time() > siguiente:
                s.write(b'\r\n{"q":1}\r\n'); siguiente = time.time() + 1
            resto += s.read(256)
            for l in resto.split(b"\n"):
                l = l.strip()
                if l.startswith(b"{") and b"radarplay" in l:
                    try:
                        return s, json.loads(l.decode())
                    except Exception:
                        pass
            resto = resto[-600:]
    except Exception:
        pass
    try: s.close()
    except Exception: pass
    return None, None


def _buscador():
    while True:
        try:
            for p in puertos_reloj():
                with _cerrojo:
                    if p in _int["relojes"] or p in _int["ocupados"]:
                        continue
                if _int["prep"]["activo"]:
                    break
                ult = _int["probados"].get(p)
                if ult and time.time() - ult["t"] < 20:
                    continue
                s, info = _saludar(p)
                if not s:
                    _int["probados"][p] = {"t": time.time(), "estado": "sin_programa"}
                    continue
                _int["probados"].pop(p, None)
                if info.get("v", 0) < VER_FW:
                    s.close()
                    threading.Thread(target=_actualizar_programa, args=(p,), daemon=True).start()
                    continue
                r = Reloj(p, s, info)
                with _cerrojo:
                    _int["relojes"][p] = r
                LOG.info("Reloj conectado en %s (%s)", p, r.rol, origen="relojes")
                threading.Thread(target=r.bucle, daemon=True, name="reloj-" + p).start()
            vivos = set(puertos_reloj())
            for p in list(_int["probados"]):
                if p not in vivos:
                    _int["probados"].pop(p, None)
        except Exception as e:
            LOG.aviso("Relojes: %s", e, origen="relojes")
        time.sleep(4)


# ---------- preparar placas (MicroPython + programa) ----------
def _py():
    return sys.executable or "python3"


def _pip(*paq):
    r = subprocess.run([_py(), "-m", "pip", "install", "--user", "--break-system-packages", "-q", *paq],
                       capture_output=True, text=True, timeout=900)
    return r.returncode == 0


def _tiene(mod):
    return subprocess.run([_py(), "-c", "import " + mod], capture_output=True).returncode == 0


def _bajar_micropython():
    if os.path.exists(MPY_BIN) and os.path.getsize(MPY_BIN) > 500000:
        return True
    url = MPY_RESPALDO
    try:
        h = urllib.request.urlopen("https://micropython.org/download/ESP32_GENERIC_S3/", timeout=20).read().decode("utf-8", "ignore")
        m = re.search(r'href="(/resources/firmware/ESP32_GENERIC_S3-\d{8}-v[\d.]+\.bin)"', h)
        if m:
            url = "https://micropython.org" + m.group(1)
    except Exception:
        pass
    try:
        os.makedirs(DATOS, exist_ok=True)
        tmp = MPY_BIN + ".tmp"
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f)
        os.replace(tmp, MPY_BIN)
        LOG.info("MicroPython descargado: %s", url.rsplit("/", 1)[-1], origen="relojes")
        return True
    except Exception as e:
        LOG.aviso("No se pudo descargar MicroPython: %s", e, origen="relojes")
        return False


def _copiar_programa(puerto, placa):
    tmp = os.path.join(DATOS, "placa.txt")
    open(tmp, "w").write(placa)
    cmd = [_py(), "-m", "mpremote", "connect", puerto,
           "fs", "cp", os.path.join(FW, "gc9a01.py"), ":gc9a01.py", "+",
           "fs", "cp", os.path.join(FW, "reloj.py"), ":main.py", "+",
           "fs", "cp", tmp, ":placa.txt", "+", "reset"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or "mpremote falló").strip()[-200:])


def _actualizar_programa(puerto):
    """Un reloj con programa antiguo: le copio el nuevo (no borra nada más)."""
    with _cerrojo:
        if puerto in _int["ocupados"]:
            return
        _int["ocupados"].add(puerto)
    try:
        if not _tiene("mpremote"):
            _pip("mpremote")
        _copiar_programa(puerto, conf()["placa"])
        LOG.info("Reloj de %s actualizado al programa %d", puerto, VER_FW, origen="relojes")
    except Exception as e:
        LOG.aviso("No se pudo actualizar el reloj de %s: %s", puerto, e, origen="relojes")
        _int["probados"][puerto] = {"t": time.time() + 600, "estado": "error"}
    finally:
        time.sleep(3)
        with _cerrojo:
            _int["ocupados"].discard(puerto)


def preparar(placa=None):
    """Instala MicroPython + el programa del reloj en las placas que aún no lo tienen."""
    if _int["prep"]["activo"]:
        return {"ok": True}
    if placa in ("lcd128", "touch128"):
        _guardar(placa=placa)
    placa = conf()["placa"]

    def hilo():
        pr = _int["prep"]
        pr.update(activo=True, ok=None, msg="Buscando placas…")
        hechas = 0
        try:
            nuevas = [p for p in puertos_reloj() if p not in _int["relojes"]]
            if not nuevas:
                pr.update(ok=False, msg="No veo ninguna placa nueva. Conéctala por USB (cable de datos, no solo de carga).")
                return
            pr["msg"] = "Instalando herramientas (la primera vez, 1-2 minutos)…"
            if not (_tiene("esptool") and _tiene("mpremote")) and not _pip("esptool", "mpremote"):
                pr.update(ok=False, msg="No pude instalar esptool/mpremote. ¿Hay internet?")
                return
            pr["msg"] = "Descargando MicroPython…"
            if not _bajar_micropython():
                pr.update(ok=False, msg="No pude descargar MicroPython. ¿Hay internet?")
                return
            for n, p in enumerate(nuevas, 1):
                with _cerrojo:
                    _int["ocupados"].add(p)
                try:
                    pr["msg"] = "Placa %d de %d: borrando…" % (n, len(nuevas))
                    r = subprocess.run([_py(), "-m", "esptool", "--chip", "esp32s3", "-p", p, "erase_flash"], capture_output=True, text=True, timeout=180)
                    if r.returncode != 0:
                        raise RuntimeError("no responde al borrar. Mantén BOOT pulsado, pulsa RESET, suelta BOOT y vuelve a probar")
                    pr["msg"] = "Placa %d de %d: instalando MicroPython (1 minuto)…" % (n, len(nuevas))
                    r = subprocess.run([_py(), "-m", "esptool", "--chip", "esp32s3", "-p", p, "-b", "460800", "write_flash", "-z", "0", MPY_BIN],
                                       capture_output=True, text=True, timeout=300)
                    if r.returncode != 0:
                        raise RuntimeError((r.stderr or r.stdout).strip()[-160:])
                    time.sleep(4)
                    pr["msg"] = "Placa %d de %d: copiando el reloj…" % (n, len(nuevas))
                    for intento in range(3):
                        try:
                            _copiar_programa(p, placa)
                            break
                        except Exception:
                            if intento == 2:
                                raise
                            time.sleep(3)
                    hechas += 1
                    LOG.info("Reloj preparado en %s", p, origen="relojes")
                except Exception as e:
                    LOG.aviso("Preparar reloj %s: %s", p, e, origen="relojes")
                    pr["msg"] = "Placa %d: %s" % (n, str(e)[:160])
                    time.sleep(4)
                finally:
                    with _cerrojo:
                        _int["ocupados"].discard(p)
                    _int["probados"].pop(p, None)
            pr.update(ok=hechas > 0, msg="Listo: %d de %d placas preparadas. En unos segundos se encienden." % (hechas, len(nuevas)) if hechas else pr["msg"])
        finally:
            pr["activo"] = False
    threading.Thread(target=hilo, daemon=True, name="relojes-preparar").start()
    return {"ok": True}


def identificar():
    for n, r in enumerate(sorted(_int["relojes"].values(), key=lambda r: r.puerto), 1):
        try:
            r.tx({"ident": str(n)})
        except Exception:
            pass
    return {"ok": True}


# ---------- API ----------
def g_rel(q):
    c = conf()
    lista = []
    for n, r in enumerate(sorted(_int["relojes"].values(), key=lambda r: r.puerto), 1):
        lista.append({"n": n, "id": r.id, "puerto": r.puerto, "rol": r.rol, "on": bool(r.on), "valor": _valor(r.rol) if r.on else None})
    sin = [p for p, x in _int["probados"].items() if x.get("estado") == "sin_programa" and p not in _int["relojes"]]
    return {"ok": True, **{k: c[k] for k in ("modo", "brillo", "rb", "placa")}, "relojes": lista, "sin_programa": sin,
            "encendidos": _encendidos(), "dna": _int["dna"], "demo": time.time() < _int["demo_hasta"],
            "prep": dict(_int["prep"]), "datos": [{"k": k, "n": v["n"]} for k, v in DATOS_MOTOR.items()]}


def p_rel(d):
    a = d.get("accion")
    if a == "dna":
        _int["dna"], _int["dna_t"] = str(d.get("dna") or "")[:1].upper(), time.time()
        return {"ok": True}
    if a == "ajustes":
        kv = {}
        if d.get("modo") in ("dynamic", "siempre", "off"): kv["modo"] = d["modo"]
        if "brillo" in d: kv["brillo"] = max(5, min(100, int(d["brillo"])))
        if "rb" in d: kv["rb"] = 1 if d["rb"] else 0
        return {"ok": True, **_guardar(**kv)}
    if a == "rol":
        if d.get("rol") not in DATOS_MOTOR:
            return {"ok": False, "error": "Dato desconocido"}
        roles = dict(conf()["roles"]); roles[str(d.get("id"))] = d["rol"]
        _guardar(roles=roles)
        return {"ok": True}
    if a == "identificar":
        return identificar()
    if a == "demo":
        _int["demo_hasta"] = time.time() + 25 if d.get("on", True) else 0
        return {"ok": True}
    if a == "preparar":
        return preparar(d.get("placa"))
    return {"ok": False, "error": "Acción desconocida"}


def arrancar(sis=None, obd=None):
    _int["obd"] = obd
    threading.Thread(target=_buscador, daemon=True, name="relojes").start()


GET = {"/api/relojes": g_rel}
POST = {"/api/relojes": p_rel}
