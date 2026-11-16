"""
Radar Play · OBD-II por CAN directo (Waveshare RS485 CAN HAT, MCP2515 → can0)
- Habla con la centralita por el bus CAN del OBD (pines 6 y 14) sin ELM327.
  Por fuera se porta igual que el lector ELM (pid, crudo, cmd), así que el
  resto de Radar Play no cambia.
- «Escuchar el coche»: graba todo lo que pasa por el bus (formato candump) y
  enseña qué mensajes cambian, para descubrir el DNA, los botones, etc.
  Solo escucha: no manda nada salvo las preguntas normales de diagnóstico.
Se usa el soporte CAN de Linux (SocketCAN): no hace falta instalar nada en Python.
"""
import glob, os, re, socket, struct, subprocess, threading, time
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
DIR_GRAB = os.path.join(CARPETA, "datos", "can")
FMT = "=IB3x8s"                      # struct can_frame
EFF, RTR, ERR = 0x80000000, 0x40000000, 0x20000000
estado = {"interfaz": None, "hay": False, "arriba": False, "bus": "", "velocidad": 0, "errores": "", "tramas": 0,
          "escuchando": False, "grabando": None, "msg": "", "ult_trama": 0, "verif": None, "verificando": False}
_esc = {"ids": {}, "sock": None, "f": None, "t0": 0, "marcas": []}
_cerrojo = threading.Lock()


def _sudo(*cmd):
    return subprocess.run(["sudo", "-n", *cmd], capture_output=True, text=True, timeout=15)


def interfaz():
    for n in ("can0", "can1"):
        if os.path.exists("/sys/class/net/" + n):
            return n
    return None


def info_interfaz():
    """Estado de can0: si existe, si está levantada, velocidad y estado del bus (ERROR-ACTIVE, BUS-OFF…)."""
    n = interfaz()
    estado.update(interfaz=n, hay=bool(n))
    if not n:
        return estado
    try:
        r = subprocess.run(["ip", "-details", "-statistics", "link", "show", n], capture_output=True, text=True, timeout=5).stdout
        estado["arriba"] = ",UP" in r or "state UP" in r or "<NOARP,UP" in r
        m = re.search(r"can state (\S+)", r)
        estado["bus"] = m.group(1) if m else ""
        m = re.search(r"bitrate (\d+)", r)
        estado["velocidad"] = int(m.group(1)) if m else 0
        m = re.search(r"re-started bus-errors arbit-lost error-warn error-pass bus-off\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", r)
        estado["errores"] = "reinicios %s · errores %s · bus-off %s" % (m.group(1), m.group(2), m.group(6)) if m else ""
    except Exception:
        pass
    return estado


def levantar(velocidad=500000):
    """Pone can0 en marcha (lo hace también el servicio radar-play-can al encender)."""
    n = interfaz()
    if not n:
        return {"ok": False, "error": "No hay interfaz CAN. ¿Está puesto el HAT y la Raspberry reiniciada tras instalar?"}
    _sudo("ip", "link", "set", n, "down")
    r = _sudo("ip", "link", "set", n, "type", "can", "bitrate", str(int(velocidad)), "restart-ms", "100")
    r2 = _sudo("ip", "link", "set", n, "up")
    info_interfaz()
    if r.returncode or r2.returncode:
        return {"ok": False, "error": ((r.stderr or "") + (r2.stderr or "")).strip()[:150] or "No se pudo levantar " + n}
    return {"ok": True}


def _sock(n, timeout=0.2):
    s = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
    s.bind((n,))
    s.settimeout(timeout)
    return s


def _trama(s):
    d = s.recv(16)
    cid, dlc, datos = struct.unpack(FMT, d)
    return cid, datos[:dlc]


# ===================== Diagnóstico OBD por CAN (ISO 15765) =====================
class CANOBD:
    """Mismo «idioma» que la clase ELM de puente.py: pid(), crudo(), cmd()."""

    def __init__(self, n):
        self.puerto = n + " (CAN directo)"
        self.n = n
        self.s = _sock(n, 0.05)
        self.tx = 0x7DF                      # a todas las centralitas; ATSH7E0 → solo motor
        self.s.setsockopt(socket.SOL_CAN_RAW, socket.CAN_RAW_FILTER,
                          struct.pack("=II", 0x7E8, 0x7F0 | EFF | RTR))   # solo respuestas de diagnóstico 7E8–7EF (11 bits)

    def close(self):
        try: self.s.close()
        except Exception: pass

    def _enviar(self, cid, datos):
        datos = bytes(datos) + b"\x00" * (8 - len(datos))
        self.s.send(struct.pack(FMT, cid, 8, datos[:8]))

    def _vaciar(self):
        try:
            while True:
                self.s.recv(16)
        except (socket.timeout, BlockingIOError, OSError):
            pass

    def pregunta(self, carga, espera=0.6):
        """Manda una petición y devuelve la respuesta completa (ISO-TP) de la primera centralita que conteste."""
        if len(carga) > 7:
            return None
        self._vaciar()
        self._enviar(self.tx, [len(carga)] + list(carga))
        fin = time.time() + espera
        total, buf, rx, sig = None, b"", None, 1
        while time.time() < fin:
            try:
                cid, d = _trama(self.s)
            except socket.timeout:
                continue
            cid &= 0x1FFFFFFF
            if self.tx != 0x7DF and cid != self.tx + 8:
                continue
            if rx is not None and cid != rx:
                continue
            tipo = d[0] >> 4
            if tipo == 0:                              # trama única
                r = d[1:1 + (d[0] & 0x0F)]
                if len(r) >= 3 and r[0] == 0x7F and r[2] == 0x78:   # «espera, lo estoy calculando»
                    fin = time.time() + 2
                    continue
                if len(r) and r[0] == 0x7F:
                    return None
                return r
            if tipo == 1:                              # primera de varias: pide el resto
                total = ((d[0] & 0x0F) << 8) | d[1]
                buf, rx = d[2:8], cid
                self._enviar(cid - 8, [0x30, 0x00, 0x00])
                fin = time.time() + espera + 1
            elif tipo == 2 and rx is not None and (d[0] & 0x0F) == (sig & 0x0F):
                buf += d[1:8]
                sig += 1
                if total is not None and len(buf) >= total:
                    return buf[:total]
        return None

    def pid(self, p):
        r = self.pregunta(bytes([0x01, int(p, 16)]), 0.5)
        if not r or len(r) < 2 or r[0] != 0x41 or r[1] != int(p, 16):
            return None
        return list(r[2:6])

    def crudo(self, c, resp, espera=1.0):
        try:
            carga = bytes.fromhex(c)
            esperado = bytes.fromhex(resp)
        except ValueError:
            return None
        r = self.pregunta(carga, espera)
        if not r or not r.startswith(esperado):
            return None
        return list(r[len(esperado):])

    def cmd(self, c, espera=1.0):
        c = c.upper().replace(" ", "")
        if c.startswith("ATSH"):
            try:
                self.tx = int(c[4:], 16) & 0x7FF
            except ValueError:
                pass
            return "OK"
        if c == "ATRV":                                # tensión: PID 42 de la centralita
            b = self.pid("42")
            return "%.1fV" % ((b[0] * 256 + b[1]) / 1000) if b and len(b) >= 2 else ""
        if c == "ATZ":
            return "ELM327 v2.3 (CAN directo)"
        return "OK"


def conectar_obd():
    """Si hay HAT CAN y el coche contesta, devuelve el lector. Si no, None (y se prueba el ELM327)."""
    info_interfaz()
    n = estado["interfaz"]
    if not n or not _conf("CAN_HAT", 1):
        return None
    if not estado["arriba"]:
        levantar(_vel())
    try:
        e = CANOBD(n)
    except Exception as ex:
        estado["msg"] = "No puedo abrir %s: %s" % (n, ex)
        return None
    if e.pid("00") is None and e.pid("0C") is None:
        e.close()
        estado["msg"] = "El HAT CAN está, pero el coche no contesta (pon el contacto). %s" % _pista()
        return None
    estado["msg"] = "Conectado por CAN directo"
    return e


def _conf(k, por_defecto):
    try:
        import sistema_rp as SIS
        return int(SIS.CONF.get(k, por_defecto))
    except Exception:
        return por_defecto


def _vel():
    return _conf("CAN_VELOCIDAD", 500000)


def _pista():
    """Qué puede estar mal según el estado del bus."""
    b = estado.get("bus", "")
    if b in ("ERROR-PASSIVE", "BUS-OFF"):
        return ("Si estás conectado al coche con el contacto puesto y sale esto, revisa CAN-H (pin 6) y CAN-L (pin 14), que no estén cruzados, que el puente de 120 Ω del HAT "
                "esté quitado y que el cristal configurado coincida con el del HAT (12 u 8 MHz).")
    if estado.get("ult_trama") and time.time() - estado["ult_trama"] < 5:
        return "Se ve tráfico en el bus, pero el motor no contesta a las preguntas de diagnóstico."
    return ""


# ===================== Escuchar el coche =====================
def _hilo_escucha():
    n = interfaz()
    try:
        s = _sock(n, 0.5)
    except Exception as e:
        estado.update(escuchando=False, msg="No puedo escuchar: %s" % e)
        return
    _esc["sock"] = s
    while estado["escuchando"]:
        try:
            cid, d = _trama(s)
        except socket.timeout:
            continue
        except OSError:
            break
        if cid & ERR:
            continue
        ahora = time.time()
        cid &= 0x1FFFFFFF
        estado["tramas"] += 1
        estado["ult_trama"] = ahora
        with _cerrojo:
            x = _esc["ids"].get(cid)
            if not x:
                x = _esc["ids"][cid] = {"n": 0, "datos": d, "t": ahora, "periodo": 0, "cambios": [0] * 8, "ult_cambio": [0] * 8, "primero": ahora}
            else:
                for i in range(min(len(d), len(x["datos"]))):
                    if d[i] != x["datos"][i]:
                        x["cambios"][i] += 1
                        x["ult_cambio"][i] = ahora
                x["periodo"] = x["periodo"] * 0.9 + (ahora - x["t"]) * 0.1 if x["periodo"] else ahora - x["t"]
                x["datos"], x["t"] = d, ahora
            x["n"] += 1
        f = _esc["f"]
        if f:
            try:
                f.write("(%.6f) %s %03X#%s\n" % (ahora, n, cid, d.hex().upper()))
            except Exception:
                pass
    try: s.close()
    except Exception: pass


def escuchar(on):
    if on and not estado["escuchando"]:
        if not interfaz():
            return {"ok": False, "error": "No hay interfaz CAN"}
        if not estado["arriba"]:
            levantar(_vel())
        with _cerrojo:
            _esc["ids"] = {}
        estado.update(escuchando=True, tramas=0)
        threading.Thread(target=_hilo_escucha, daemon=True, name="can-escucha").start()
        LOG.info("CAN: escuchando el bus", origen="can")
    elif not on:
        grabar(False)
        estado["escuchando"] = False
    return {"ok": True}


def grabar(on):
    if on:
        if not estado["escuchando"]:
            r = escuchar(True)
            if not r["ok"]:
                return r
        os.makedirs(DIR_GRAB, exist_ok=True)
        nombre = "can-%s.log" % time.strftime("%Y%m%d-%H%M%S")
        _esc["f"] = open(os.path.join(DIR_GRAB, nombre), "w", buffering=1)
        _esc["f"].write("# Radar Play · grabación del bus CAN · %s · %d bit/s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), estado.get("velocidad") or 0))
        estado["grabando"] = nombre
        _esc["marcas"] = []
        LOG.info("CAN: grabando en %s", nombre, origen="can")
        for viejo in sorted(glob.glob(os.path.join(DIR_GRAB, "can-*.log")))[:-10]:      # guarda las 10 últimas
            try: os.remove(viejo)
            except Exception: pass
    else:
        f = _esc["f"]
        _esc["f"] = None
        if f:
            try: f.close()
            except Exception: pass
        estado["grabando"] = None
    return {"ok": True}


def marcar(texto):
    """Apunta en la grabación lo que acabas de hacer («pulso volumen +», «DNA en Dynamic»…)."""
    t = (texto or "marca").replace("\n", " ")[:80]
    _esc["marcas"].append({"t": time.time(), "texto": t})
    f = _esc["f"]
    if f:
        f.write("# MARCA %.6f %s\n" % (time.time(), t))
    return {"ok": True}


def tabla(n=80):
    ahora = time.time()
    with _cerrojo:
        filas = []
        for cid, x in _esc["ids"].items():
            filas.append({"id": "%03X" % cid if cid <= 0x7FF else "%08X" % cid, "n": x["n"], "datos": x["datos"].hex(" ").upper(),
                          "hz": round(1 / x["periodo"], 1) if x["periodo"] > 0 else 0,
                          "vivo": [1 if ahora - t < 1.5 else 0 for t in x["ult_cambio"][:len(x["datos"])]],
                          "cambios": x["cambios"][:len(x["datos"])], "viejo": ahora - x["t"] > 3})
    filas.sort(key=lambda f: f["id"])
    return filas[:n]


def ultima_grabacion():
    g = sorted(glob.glob(os.path.join(DIR_GRAB, "can-*.log")))
    return g[-1] if g else None


def cambiar_cristal(hz):
    """El HAT de Waveshare lleva un cristal de 12 MHz (algunos de 8 MHz). Se cambia en config.txt y hay que reiniciar."""
    hz = int(hz)
    if hz not in (8000000, 12000000, 16000000):
        return {"ok": False, "error": "Cristal no válido"}
    for cfg in ("/boot/firmware/config.txt", "/boot/config.txt"):
        if os.path.exists(cfg):
            r = _sudo("sed", "-i", "-E", r"s/(dtoverlay=mcp2515-can0,oscillator=)[0-9]+/\g<1>%d/" % hz, cfg)
            if r.returncode == 0:
                LOG.info("CAN: cristal cambiado a %d Hz (reinicia)", hz, origen="can")
                return {"ok": True, "msg": "Cambiado a %d MHz. Reinicia la Raspberry para que se aplique." % (hz // 1000000)}
            return {"ok": False, "error": (r.stderr or "sin permiso").strip()[:120]}
    return {"ok": False, "error": "No encuentro config.txt"}


def cristal_actual():
    for cfg in ("/boot/firmware/config.txt", "/boot/config.txt"):
        try:
            m = re.search(r"dtoverlay=mcp2515-can0,oscillator=(\d+)", open(cfg).read())
            if m:
                return int(m.group(1))
        except Exception:
            pass
    return None


# ===================== Comprobar el HAT =====================
CONFIGS = ("/boot/firmware/config.txt", "/boot/config.txt")
_verif_lock = threading.Lock()


def _config():
    for c in CONFIGS:
        if os.path.exists(c):
            try:
                return c, open(c).read()
            except Exception:
                return c, ""
    return None, ""


def _kernel_mcp():
    """Lo que dijo el kernel sobre el chip MCP2515 en este arranque."""
    for cmd in (["dmesg"], ["sudo", "-n", "dmesg"], ["journalctl", "-k", "-b", "--no-pager", "-q"]):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if r.returncode == 0 and r.stdout:
                return [l.strip() for l in r.stdout.splitlines() if re.search(r"mcp251|can0|spi0\.0", l, re.I)][-8:]
        except Exception:
            pass
    return []


def _arrancado_desde():
    try:
        return time.time() - float(open("/proc/uptime").read().split()[0])
    except Exception:
        return 0


def _bucle_cerrado(n, vel):
    """Pone el chip en modo «circuito cerrado» (no sale nada al coche), manda un mensaje y espera recibirlo.
    Si vuelve, funcionan los 7 cables: corriente, SPI (MOSI, MISO, SCK, CS) y el aviso INT."""
    marca = bytes(b"RADARPLY")
    try:
        _sudo("ip", "link", "set", n, "down")
        r = _sudo("ip", "link", "set", n, "type", "can", "bitrate", str(vel), "loopback", "on")
        if r.returncode:
            return None, "No pude poner el modo de prueba: " + (r.stderr or "").strip()[:100]
        _sudo("ip", "link", "set", n, "up")
        time.sleep(0.2)
        s = _sock(n, 0.2)
        try:
            for intento in range(3):
                s.send(struct.pack(FMT, 0x5A5, 8, marca))
                fin = time.time() + 1.0
                while time.time() < fin:
                    try:
                        cid, d = _trama(s)
                    except socket.timeout:
                        continue
                    if (cid & 0x7FF) == 0x5A5 and d == marca:
                        return True, ""
        finally:
            s.close()
        return False, ""
    except OSError as e:
        return False, str(e)[:100]
    finally:
        _sudo("ip", "link", "set", n, "down")
        _sudo("ip", "link", "set", n, "type", "can", "bitrate", str(vel), "loopback", "off", "restart-ms", "100")
        _sudo("ip", "link", "set", n, "up")


def verificar(auto=False):
    """Comprueba el HAT paso a paso y deja el resultado en estado["verif"]."""
    if not _verif_lock.acquire(blocking=False):
        return estado.get("verif") or {"ok": None}
    pasos, accion = [], None

    def paso(nombre, ok, msg):
        pasos.append({"paso": nombre, "ok": ok, "msg": msg})
        return ok

    try:
        estado["verificando"] = True
        cfg, txt = _config()
        spi = bool(re.search(r"^\s*dtparam=spi=on", txt, re.M))
        ov = re.search(r"^\s*dtoverlay=mcp2515-can0[^\n]*", txt, re.M)
        n = interfaz()
        # 1. Configuración
        if not (spi and ov):
            paso("Configuración", False, "Falta activar el HAT en la Raspberry (SPI y controlador MCP2515).")
            accion = "activar"
            return _fin(pasos, accion, auto)
        osc = re.search(r"oscillator=(\d+)", ov.group(0))
        irq = re.search(r"interrupt=(\d+)", ov.group(0))
        paso("Configuración", True, "SPI activado · MCP2515 con cristal de %s MHz · aviso en GPIO%s (pin 22)" %
             (int(osc.group(1)) // 1000000 if osc else "?", irq.group(1) if irq else "?"))
        # 2. El chip
        if not n:
            try:
                cambiado = bool(cfg) and os.path.getmtime(cfg) > _arrancado_desde() + 5
            except OSError:
                cambiado = False
            if cambiado:
                paso("Chip MCP2515", False, "La configuración se ha cambiado después de encender: falta reiniciar.")
                accion = "reiniciar"
                return _fin(pasos, accion, auto)
            k = " ".join(_kernel_mcp())
            if re.search(r"wrong wiring|didn't enter in conf mode|probe.*fail|failed to", k, re.I):
                paso("Chip MCP2515", False, "La Raspberry no consigue hablar con el chip del HAT. Revisa los cables MOSI (pin 19), "
                     "MISO (pin 21), SCK (pin 23) y CS (pin 24), y la corriente: 3V3 (pin 1) y GND (pin 6).")
            else:
                paso("Chip MCP2515", False, "No aparece el HAT (can0). ¿Está conectado y bien encajado? Si acabas de instalar, reinicia.")
            accion = "reiniciar_o_cables"
            return _fin(pasos, accion, auto)
        paso("Chip MCP2515", True, "La Raspberry ve el chip del HAT (can0)")
        # 3. Circuito cerrado
        vel = _vel()
        ok, err = _bucle_cerrado(n, vel)
        if ok:
            paso("Prueba de los 7 cables", True, "Mensaje de prueba enviado y recibido: corriente, SPI e INT funcionan")
        else:
            paso("Prueba de los 7 cables", False, err or "El mensaje de prueba no vuelve. Lo más probable: el cable INT (pin 22) "
                 "suelto o en otro pin. Revisa también MISO (pin 21).")
            return _fin(pasos, "cables", auto)
        # 4. El bus del coche (informativo)
        info_interfaz()
        vistas = 0
        try:
            s = _sock(n, 0.2)
            fin = time.time() + 1.5
            while time.time() < fin:
                try:
                    cid, _d = _trama(s)
                    if not cid & ERR:
                        vistas += 1
                except socket.timeout:
                    pass
            s.close()
        except Exception:
            pass
        info_interfaz()
        b = estado.get("bus", "")
        if vistas:
            estado["ult_trama"] = time.time()
            paso("Coche", True, "Conectado al coche: se ven %d mensajes por segundo" % int(vistas / 1.5))
        elif b in ("ERROR-PASSIVE", "BUS-OFF", "ERROR-WARNING"):
            paso("Coche", None, "Nadie contesta en el bus. Normal si no está conectado al coche. Si lo está, con el contacto puesto: "
                 "revisa H (pin 6 del OBD) y L (pin 14), que no estén cruzados, la masa (pin 5), el 120R en OFF y el cristal.")
        else:
            paso("Coche", None, "Sin mensajes del coche (normal si no está conectado al OBD o el contacto está quitado)")
        return _fin(pasos, None, auto)
    finally:
        estado["verificando"] = False
        _verif_lock.release()


def _fin(pasos, accion, auto):
    ok = all(p["ok"] is not False for p in pasos)
    v = {"ok": ok, "t": time.time(), "pasos": pasos, "accion": accion, "auto": auto,
         "resumen": "El HAT CAN funciona" if ok else next(p["msg"] for p in pasos if p["ok"] is False)}
    estado["verif"] = v
    (LOG.info if ok else LOG.aviso)("CAN: comprobación %s · %s", "OK" if ok else "FALLA",
                                     " | ".join("%s: %s" % (p["paso"], "ok" if p["ok"] else "—" if p["ok"] is None else "FALLA") for p in pasos), origen="can")
    if not ok:
        LOG.aviso("CAN: %s", v["resumen"], origen="can")
        k = _kernel_mcp()
        if k:
            LOG.aviso("CAN: el kernel dice: %s", " / ".join(k[-4:])[:400], origen="can")
    return v


def activar():
    """Escribe en config.txt lo que necesita el HAT (por si la instalación no lo hizo)."""
    cfg, txt = _config()
    if not cfg:
        return {"ok": False, "error": "No encuentro config.txt"}
    osc = _conf("CAN_CRISTAL", 12000000)
    lineas = []
    if not re.search(r"^\s*dtparam=spi=on", txt, re.M):
        lineas.append("dtparam=spi=on")
    if not re.search(r"^\s*dtoverlay=mcp2515-can0", txt, re.M):
        lineas.append("dtoverlay=mcp2515-can0,oscillator=%d,interrupt=25,spimaxfrequency=2000000" % osc)
    if lineas:
        p = subprocess.run(["sudo", "-n", "tee", "-a", cfg], input="\n# Radar Play · HAT CAN\n" + "\n".join(lineas) + "\n",
                           capture_output=True, text=True, timeout=15)
        if p.returncode:
            return {"ok": False, "error": "No pude escribir la configuración (¿modo protegido activado?): " + (p.stderr or "").strip()[:100]}
        LOG.info("CAN: HAT activado en %s", cfg, origen="can")
    estado["verif"] = {"ok": False, "t": time.time(), "accion": "reiniciar", "resumen": "Activado. Reinicia para terminar.",
                       "pasos": [{"paso": "Configuración", "ok": True, "msg": "Activado. Reinicia la Raspberry para que se aplique."}]}
    return {"ok": True, "msg": "Activado. Reinicia la Raspberry."}


# ===================== API =====================
def g_can(q):
    info_interfaz()
    r = {**estado, "cristal": cristal_actual(), "pista": _pista(), "marcas": _esc["marcas"][-10:]}
    if estado["escuchando"]:
        r["tabla"] = tabla()
    return r


def p_can(d):
    a = d.get("accion")
    if a == "escuchar":
        return escuchar(bool(d.get("on")))
    if a == "grabar":
        return grabar(bool(d.get("on")))
    if a == "marcar":
        return marcar(d.get("texto"))
    if a == "levantar":
        return levantar(int(d.get("velocidad") or _vel()))
    if a == "cristal":
        return cambiar_cristal(d.get("hz"))
    if a == "verificar":
        threading.Thread(target=verificar, daemon=True, name="can-verificar").start()
        return {"ok": True}
    if a == "activar":
        return activar()
    return {"ok": False, "error": "Acción desconocida"}


def arrancar(sis=None, obd=None):
    info_interfaz()

    def auto():                                    # al encender, una vez: ¿funciona el HAT?
        time.sleep(10)
        try:
            _auto()
        except Exception as e:
            LOG.aviso("CAN: la comprobación automática falló: %s", e, origen="can")

    def _auto():
        if not _conf("CAN_HAT", 1):
            return
        _c, txt = _config()
        if interfaz() or "mcp2515" in txt:
            verificar(auto=True)
    threading.Thread(target=auto, daemon=True, name="can-auto").start()


GET = {"/api/can": g_can}
POST = {"/api/can": p_can}
