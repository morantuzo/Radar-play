"""
Radar Play · Presión de neumáticos (TPMS Bluetooth)
Lee los tapones con sensor Bluetooth de AliExpress/Amazon (los de la app
«TPMS», 4 tapones numerados 1-4). Cada tapón anuncia por Bluetooth su
presión, temperatura y batería; no hace falta emparejarlos.
Formato: datos de fabricante 0x0100 → MAC(6) presión Pa(4) temp 0,01 °C(4) batería %(1) alarma(1).
Necesita la librería «bleak» (en la Raspberry la instala instalar.sh; en el PC: pip install bleak).
"""
import asyncio, json, os, struct, threading, time

CARPETA = os.path.dirname(os.path.abspath(__file__))
CONF_F = os.path.join(CARPETA, "datos", "ruedas.json")
RUEDAS = ("DI", "DD", "TI", "TD")
sensores = {}     # mac -> {mac, bar, temp, bat, alarma, rssi, ts, pos_tapon}
estado = {"ble": False, "msg": "Arrancando…", "escaneando": False}
conf = {"asignacion": {}, "objetivo_del": 2.3, "objetivo_tras": 2.2, "aviso_bajo": 0.25, "alarma_bar": 1.8, "temp_alta": 80}
_cerrojo = threading.Lock()


def _cargar():
    try:
        with open(CONF_F, encoding="utf-8") as f:
            conf.update(json.load(f))
    except Exception:
        pass


def _guardar():
    os.makedirs(os.path.dirname(CONF_F), exist_ok=True)
    with open(CONF_F + ".tmp", "w", encoding="utf-8") as f:
        json.dump(conf, f, ensure_ascii=False)
    os.replace(CONF_F + ".tmp", CONF_F)


def decodificar(datos_fab):
    """datos_fab: {company_id: bytes} de bleak. Devuelve dict o None."""
    b = datos_fab.get(0x0100)
    if not b or len(b) < 16:
        return None
    mac = ":".join("%02X" % x for x in b[0:6])
    pa, cent = struct.unpack("<Ii", bytes(b[6:14]))
    return {"mac": mac, "pos_tapon": (b[0] - 0x80) if 0x80 <= b[0] <= 0x83 else None,
            "bar": round(pa / 100000, 2), "temp": round(cent / 100, 1), "bat": b[14], "alarma": bool(b[15])}


def _visto(dev, adv):
    d = decodificar(adv.manufacturer_data or {})
    if not d:
        return
    d.update(rssi=adv.rssi, ts=time.time())
    with _cerrojo:
        sensores[d["mac"]] = d
        if d["mac"] not in conf["asignacion"] and d["pos_tapon"] is not None:
            # los tapones vienen numerados 1-4: 1 delantera izq., 2 delantera dcha., 3 trasera izq., 4 trasera dcha.
            libre = RUEDAS[d["pos_tapon"]]
            if libre not in conf["asignacion"].values():
                conf["asignacion"][d["mac"]] = libre
                _guardar()


async def _escanear():
    from bleak import BleakScanner
    while True:
        try:
            estado.update(ble=True, escaneando=True, msg="Buscando sensores de las ruedas")
            async with BleakScanner(detection_callback=_visto):
                while True:
                    await asyncio.sleep(5)
        except Exception as e:
            estado.update(escaneando=False, msg="Bluetooth no disponible: %s" % str(e)[:100])
            await asyncio.sleep(15)


def hilo():
    try:
        import bleak  # noqa: F401
    except ImportError:
        estado.update(ble=False, msg="Falta la librería bleak (pip install bleak)")
        return
    asyncio.run(_escanear())


def arrancar(sis=None, obd=None):
    _cargar()
    if sis and not int(sis.CONF.get("RUEDAS", 1)):
        estado.update(msg="Desactivado (RUEDAS=0)")
        return
    threading.Thread(target=hilo, daemon=True).start()


def resumen():
    """Estado de cada rueda con avisos."""
    ahora = time.time()
    with _cerrojo:
        por_rueda = {}
        for mac, pos in conf["asignacion"].items():
            s = sensores.get(mac)
            por_rueda[pos] = {**(s or {"mac": mac}), "fresco": bool(s and ahora - s["ts"] < 600)}
        libres = [dict(s) for m, s in sensores.items() if m not in conf["asignacion"]]
    vals = [r["bar"] for r in por_rueda.values() if r.get("fresco")]
    for pos, r in por_rueda.items():
        obj = conf["objetivo_del"] if pos.startswith("D") else conf["objetivo_tras"]
        avisos = []
        if r.get("fresco"):
            otras = [v for p2, x in por_rueda.items() if p2 != pos and x.get("fresco") for v in [x["bar"]]]
            if r["bar"] <= conf["alarma_bar"] or r.get("alarma"):
                avisos.append(("alarma", "Presión muy baja: para y revisa la rueda"))
            elif r["bar"] < obj - conf["aviso_bajo"]:
                avisos.append(("aviso", "Baja: %.1f bar (recomendado %.1f)" % (r["bar"], obj)))
            if otras and r["bar"] < sum(otras) / len(otras) - 0.3:
                avisos.append(("aviso", "Más baja que las demás: posible pinchazo lento"))
            if r["temp"] >= conf["temp_alta"]:
                avisos.append(("aviso", "Muy caliente (%.0f °C)" % r["temp"]))
            if r.get("bat") is not None and r["bat"] < 15:
                avisos.append(("info", "Pila del sensor baja"))
        r["objetivo"], r["avisos"] = obj, avisos
    return {"estado": dict(estado), "ruedas": por_rueda, "sin_asignar": libres, "conf": conf, "n_vistos": len(sensores)}


def g_ruedas(q):
    return resumen()


def p_ruedas(d):
    a = d.get("accion")
    with _cerrojo:
        if a == "asignar":
            mac, pos = d.get("mac"), d.get("pos")
            if pos not in RUEDAS:
                return {"ok": False, "error": "Rueda no válida"}
            conf["asignacion"] = {m: p for m, p in conf["asignacion"].items() if p != pos and m != mac}
            conf["asignacion"][mac] = pos
        elif a == "quitar":
            conf["asignacion"].pop(d.get("mac"), None)
        elif a == "ajustes":
            for k in ("objetivo_del", "objetivo_tras", "aviso_bajo", "alarma_bar", "temp_alta"):
                if d.get(k) not in (None, ""):
                    v = float(str(d[k]).replace(",", "."))
                    if not 0 <= v <= 150:
                        return {"ok": False, "error": "Valor fuera de rango"}
                    conf[k] = v
        else:
            return {"ok": False, "error": "Acción desconocida"}
        _guardar()
    return {"ok": True}


GET = {"/api/ruedas": g_ruedas}
POST = {"/api/ruedas": p_ruedas}
