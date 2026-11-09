"""
Radar Play · Luz ambiente (tira LED WS2812 / NeoPixel)
Funciona en Raspberry Pi 4 y 5 por el SPI: DATOS de la tira → GPIO10 (pin 19).
Alimenta la tira con 5 V aparte (no desde la Raspberry si son más de ~10 LEDs)
y une las masas (GND). Mejor con un conversor de nivel 74AHCT125.
Configuración: LEDS=número de LEDs (0 = sin tira), LEDS_BRILLO=0-100.

Tiras USB con mando y app del móvil (ELK-BLEDOM, duoCo Strip, Lotus Lamp,
Happy Lighting, Triones…): el USB solo les da corriente, se controlan por
Bluetooth. Radar Play las busca y se conecta (Ajustes › Luz ambiente › Buscar).
"""
import asyncio, json, os, threading, time
import registro as LOG

COLORES = {"D": (255, 20, 20), "N": (255, 170, 90), "A": (40, 120, 255)}
estado = {"activo": False, "msg": "Sin tira LED (LEDS=0)", "modo": "dna", "dna": "N", "color": None, "brillo": 60, "efecto": None, "n": 0, "simulado": True}
_spi = {"d": None}
ARCH_BT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos", "leds-bt.json")
_bt = {"mac": None, "nombre": None, "proto": None, "conectado": False, "msg": "", "encontradas": [], "otros": [], "buscando": False,
       "ultimo": None, "pendiente": None, "loop": None, "cli": None, "orden": "rgb", "prueba": None}
UUID_ELK = "0000fff3-0000-1000-8000-00805f9b34fb"      # ELK-BLEDOM, duoCo, Lotus Lamp, MELK
UUID_TRI = "0000ffd9-0000-1000-8000-00805f9b34fb"      # Triones, Happy Lighting, QHM, LEDBlue
NOMBRES = ("ELK", "MELK", "LEDBLE", "LEDNET", "TRIONES", "QHM", "LEDBLUE", "DREAM", "DUOCO", "LOTUS", "BJ_LED", "SP1", "LED", "STRIP")


def _bt_guardar():
    try:
        os.makedirs(os.path.dirname(ARCH_BT), exist_ok=True)
        json.dump({"mac": _bt["mac"], "nombre": _bt["nombre"], "orden": _bt["orden"]}, open(ARCH_BT, "w"))
    except Exception:
        pass


def _ordenar(rgb):
    """Muchos controladores llevan los canales cambiados (la etiqueta pone G R B): se corrige con el orden guardado."""
    o = _bt.get("orden") or "rgb"
    c = {"r": rgb[0], "g": rgb[1], "b": rgb[2]}
    return tuple(c[x] for x in o)


def _bt_trama(rgb, encendida=True, crudo=False):
    r, g, b = rgb if crudo else _ordenar(rgb)
    if _bt["proto"] == "tri":
        return [bytes([0x56, r, g, b, 0x00, 0xF0, 0xAA])] if encendida else [bytes([0xCC, 0x24, 0x33])]
    if not encendida:
        return [bytes([0x7E, 0x00, 0x04, 0x00, 0x00, 0x00, 0xFF, 0x00, 0xEF])]
    return [bytes([0x7E, 0x00, 0x05, 0x03, r, g, b, 0x00, 0xEF])]


async def _bt_bucle():
    """Mantiene la conexión con la tira y le manda el color cuando cambia."""
    from bleak import BleakClient
    while True:
        if not _bt["mac"]:
            await asyncio.sleep(2)
            continue
        try:
            async with BleakClient(_bt["mac"], timeout=15) as cli:
                uuids = [c.uuid for srv in cli.services for c in srv.characteristics]
                if UUID_ELK in uuids:
                    _bt["proto"], car = "elk", UUID_ELK
                elif UUID_TRI in uuids:
                    _bt["proto"], car = "tri", UUID_TRI
                else:
                    _bt.update(msg="Esta tira usa un sistema que aún no conozco (%s). Mándame una foto de su app" % ", ".join(u[4:8] for u in uuids[:8]))
                    LOG.aviso("Tira LED Bluetooth desconocida: %s", uuids, origen="leds")
                    await asyncio.sleep(60)
                    continue
                _bt.update(conectado=True, msg="Conectada por Bluetooth: %s" % (_bt["nombre"] or _bt["mac"]), ultimo=None)
                LOG.info("Tira LED Bluetooth conectada (%s, %s)", _bt["mac"], _bt["proto"], origen="leds")
                if _bt["proto"] == "tri":
                    await cli.write_gatt_char(car, bytes([0xCC, 0x23, 0x33]), response=False)
                else:
                    await cli.write_gatt_char(car, bytes([0x7E, 0x00, 0x04, 0xF0, 0x00, 0x01, 0xFF, 0x00, 0xEF]), response=False)
                while cli.is_connected and _bt["mac"]:
                    p = ("prueba", _bt["prueba"], True) if _bt["prueba"] else _bt["pendiente"]
                    if p and p[0] == "prueba":
                        if p != _bt["ultimo"]:
                            for t in _bt_trama(p[1], True, crudo=True):
                                await cli.write_gatt_char(car, t, response=False)
                            _bt["ultimo"] = p
                        await asyncio.sleep(0.12)
                        continue
                    if p is not None and p != _bt["ultimo"]:
                        for t in _bt_trama(p[0], p[1]):
                            await cli.write_gatt_char(car, t, response=False)
                        if p[1] and _bt["ultimo"] and not _bt["ultimo"][1] and _bt["proto"] == "elk":
                            await cli.write_gatt_char(car, bytes([0x7E, 0x00, 0x04, 0xF0, 0x00, 0x01, 0xFF, 0x00, 0xEF]), response=False)
                        _bt["ultimo"] = p
                    await asyncio.sleep(0.12)
        except Exception as e:
            if _bt["conectado"]:
                LOG.aviso("Tira LED Bluetooth desconectada: %s", e, origen="leds")
            _bt.update(conectado=False, msg="Buscando la tira %s… (enciéndela)" % (_bt["nombre"] or ""))
        await asyncio.sleep(5)


async def _bt_buscar():
    from bleak import BleakScanner
    _bt.update(buscando=True, encontradas=[])
    try:
        vistos = await BleakScanner.discover(timeout=8, return_adv=True)
        out, otros = [], []
        for d, adv in vistos.values():
            nombre = (adv.local_name or d.name or "").strip()
            srv = [u.lower() for u in (adv.service_uuids or [])]
            pista = any(n in nombre.upper() for n in NOMBRES) or any(u[4:8] in ("fff0", "ffd5", "ffe5") for u in srv)
            item = {"mac": d.address, "nombre": nombre or "Sin nombre", "rssi": adv.rssi}
            if pista:
                out.append(item)
            elif nombre:
                otros.append(item)
        _bt["encontradas"] = sorted(out, key=lambda x: -(x["rssi"] or -100))
        _bt["otros"] = sorted(otros, key=lambda x: -(x["rssi"] or -100))[:15]
    except Exception as e:
        _bt["msg"] = "No se pudo buscar: %s" % e
    _bt["buscando"] = False


def _bt_arrancar():
    try:
        import bleak  # noqa
    except Exception:
        _bt["msg"] = "Falta bleak (lo pone instalar.sh)"
        return
    try:
        d = json.load(open(ARCH_BT))
        _bt.update(mac=d.get("mac"), nombre=d.get("nombre"), orden=d.get("orden") or "rgb")
    except Exception:
        pass
    def hilo_bt():
        loop = asyncio.new_event_loop()
        _bt["loop"] = loop
        asyncio.set_event_loop(loop)
        loop.create_task(_bt_bucle())
        loop.run_forever()
    threading.Thread(target=hilo_bt, daemon=True, name="leds-bt").start()


def _bytes(rgb_list):
    """Cada bit WS2812 = 3 bits SPI a 2,4 MHz (1→110, 0→100). Orden GRB."""
    out = bytearray()
    for r, g, b in rgb_list:
        for c in (g, r, b):
            bits = 0
            for i in range(7, -1, -1):
                bits = (bits << 3) | (0b110 if (c >> i) & 1 else 0b100)
            out += bits.to_bytes(3, "big")
    return bytes(out) + bytes(60)          # reset > 50 µs


def _pintar(rgb):
    n = estado["n"]
    if _bt["mac"]:                                           # tira por Bluetooth: un color para toda la tira
        c = rgb if isinstance(rgb, tuple) else (rgb[0] if rgb else (0, 0, 0))
        _bt["pendiente"] = (tuple(int(x) for x in c), any(c))
    if not _spi["d"] or not n:
        return
    if isinstance(rgb, tuple):
        rgb = [rgb] * n
    try:
        _spi["d"].writebytes2(_bytes(rgb))
    except Exception as e:
        estado["msg"] = "Error en la tira: %s" % e


def _escala(c, k):
    return tuple(int(x * k) for x in c)


def hilo():
    t0 = time.time()
    while True:
        b = estado["brillo"] / 100
        base = estado["color"] or COLORES.get(estado["dna"], COLORES["N"])
        ef = estado["efecto"]
        if ef and time.time() > ef.get("hasta", 0):
            estado["efecto"] = ef = None
        if ef:
            t = time.time() - t0
            if ef["tipo"] == "llamada":          # verde que respira
                k = 0.35 + 0.65 * abs(((t * 0.8) % 2) - 1)
                _pintar(_escala((40, 255, 90), b * k))
            elif ef["tipo"] == "aviso":          # ámbar parpadeando
                _pintar(_escala((255, 140, 0), b if int(t * 4) % 2 else 0.05))
            elif ef["tipo"] == "alarma":         # rojo rápido
                _pintar(_escala((255, 0, 0), b if int(t * 6) % 2 else 0))
            time.sleep(0.04)
            continue
        if estado["modo"] == "apagado":
            _pintar((0, 0, 0))
        elif estado["modo"] == "arcoiris":                # va cambiando de color poco a poco
            import colorsys
            h = ((time.time() - t0) / 40) % 1
            _pintar(_escala(tuple(int(x * 255) for x in colorsys.hsv_to_rgb(h, 1, 1)), b))
        elif estado["modo"] == "respirar":                # el color sube y baja suave
            k = 0.15 + 0.85 * abs((((time.time() - t0) / 3) % 2) - 1)
            _pintar(_escala(base, b * k))
        else:
            _pintar(_escala(base, b))
        time.sleep(0.25)


_hilo = {"en_marcha": False}


def _lanzar_hilo():
    if not _hilo["en_marcha"]:
        _hilo["en_marcha"] = True
        threading.Thread(target=hilo, daemon=True, name="leds").start()


def arrancar(sis, obd=None):
    n = int(sis.CONF.get("LEDS", 0))
    estado.update(n=n, brillo=int(sis.CONF.get("LEDS_BRILLO", 60)))
    _cargar_estado()
    if sis.ES_PI:
        _bt_arrancar()
        if _bt["mac"]:
            _lanzar_hilo()
    if n <= 0:
        return
    if not sis.ES_PI:
        estado["msg"] = "La tira LED funciona en la Raspberry (aquí se simula)"
        return
    try:
        import spidev
        d = spidev.SpiDev()
        d.open(0, 0)
        d.max_speed_hz = 2400000
        d.mode = 0
        _spi["d"] = d
        estado.update(activo=True, simulado=False, msg="%d LEDs en el SPI (GPIO10)" % n)
    except Exception as e:
        estado["msg"] = "No puedo abrir el SPI (¿activado?): %s" % e
        return
    _lanzar_hilo()


def g_leds(q):
    e = dict(estado)
    e["bt"] = {k: _bt[k] for k in ("mac", "nombre", "proto", "conectado", "msg", "encontradas", "otros", "buscando", "orden")}
    if _bt["mac"]:
        e["activo"] = True
        if not estado["n"]:
            e["msg"] = _bt["msg"] or "Tira por Bluetooth"
    return e


def p_leds(d):
    a = d.get("accion")
    if a == "bt_buscar":
        if not _bt["loop"]:
            return {"ok": False, "error": _bt["msg"] or "El Bluetooth de las luces solo funciona en la Raspberry"}
        asyncio.run_coroutine_threadsafe(_bt_buscar(), _bt["loop"])
        return {"ok": True}
    if a == "bt_usar":
        _bt.update(mac=d.get("mac"), nombre=d.get("nombre"), conectado=False, ultimo=None, msg="Conectando…")
        _bt_guardar(); _lanzar_hilo()
        LOG.info("Tira LED Bluetooth elegida: %s %s", d.get("nombre"), d.get("mac"), origen="leds")
        return {"ok": True}
    if a == "bt_prueba":                       # asistente de colores: manda un canal puro sin corregir
        c = d.get("canal")
        _bt["prueba"] = {"1": (255, 0, 0), "2": (0, 255, 0), "3": (0, 0, 255)}.get(str(c)) if c else None
        _lanzar_hilo()
        return {"ok": True}
    if a == "bt_orden":
        o = str(d.get("orden", "rgb")).lower()
        if sorted(o) == ["b", "g", "r"]:
            _bt.update(orden=o, prueba=None, ultimo=None)
            _bt_guardar()
            LOG.info("Tira LED: orden de colores %s", o, origen="leds")
            return {"ok": True}
        return {"ok": False, "error": "Orden no válido"}
    if a == "bt_olvidar":
        _bt.update(mac=None, nombre=None, conectado=False, msg="")
        _bt_guardar()
        return {"ok": True}
    if "dna" in d and d["dna"] in COLORES:
        estado["dna"] = d["dna"]
    if "modo" in d and d["modo"] in ("dna", "color", "apagado", "arcoiris", "respirar"):
        estado["modo"] = d["modo"]
        if d["modo"] == "dna":
            estado["color"] = None
    if d.get("color"):
        h = str(d["color"]).lstrip("#")
        if len(h) == 6:
            estado.update(color=tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)), modo="color")
    if d.get("brillo") is not None:
        estado["brillo"] = max(0, min(100, int(d["brillo"])))
    if d.get("efecto") in ("llamada", "aviso", "alarma"):
        estado["efecto"] = {"tipo": d["efecto"], "hasta": time.time() + float(d.get("segundos", 6))}
    if d.get("efecto") == "fin":
        estado["efecto"] = None
    _guardar_estado()
    return {"ok": True}


ARCH_EST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos", "leds-estado.json")


def _guardar_estado():
    try:
        json.dump({"modo": estado["modo"], "color": estado["color"], "brillo": estado["brillo"]}, open(ARCH_EST, "w"))
    except Exception:
        pass


def _cargar_estado():
    try:
        d = json.load(open(ARCH_EST))
        estado.update(modo=d.get("modo", "dna"), brillo=int(d.get("brillo", estado["brillo"])),
                      color=tuple(d["color"]) if d.get("color") else None)
    except Exception:
        pass


GET = {"/api/leds": g_leds}
POST = {"/api/leds": p_leds}
