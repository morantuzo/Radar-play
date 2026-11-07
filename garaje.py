"""
Radar Play · Puerta del garaje
Dos formas (pueden ir juntas):
  1) Por RADIO, como un mando: un emisor de 433 MHz (FS1000A) emite la señal
     de tu mando. Radar Play la aprende con un receptor (RXB6) pulsando tu
     mando delante. Vale para mandos de CÓDIGO FIJO. Si tu mando es de código
     variable (rolling code), lo detecta y te dice que uses la forma 2.
     Emisor: DATA → GPIO17 (pin 11), VCC → 5 V, GND. Antena: cable de 17 cm.
     Receptor: DATA → GPIO27 (pin 13), VCC → 3,3 V (¡no 5 V!), GND.
  2) Un relé en paralelo con el botón de un mando de verdad (vale para todos).
Sin nada configurado o en el PC, se simula.
"""
import json, os, statistics, threading, time
import registro as LOG

ARCH_RF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "datos", "garaje-rf.json")
RF = {"codigo": None, "aprendiendo": False, "msg": "", "h": None, "lg": None}

estado = {"activo": False, "simulado": True, "msg": "", "ultima": None, "veces": 0}
_dev = None
_cerrojo = threading.Lock()
CONF = {}


# ===================== Radio 433 MHz =====================
def _gpio():
    if RF["h"] is not None:
        return RF["lg"], RF["h"]
    import lgpio
    for chip in (4, 0):                              # Pi 5 usa gpiochip4 (o 0 con kernels nuevos); Pi 4/400 el 0
        try:
            h = lgpio.gpiochip_open(chip)
        except Exception:
            continue
        try:
            nombre = str(lgpio.gpio_get_chip_info(h)[2:])
        except Exception:
            nombre = ""
        if "rp1" in nombre or "bcm2" in nombre or "brcmstb" in nombre or chip == 0:
            RF.update(h=h, lg=lgpio)
            return lgpio, h
        lgpio.gpiochip_close(h)
    raise RuntimeError("No encuentro los GPIO")


def _tramas(pulsos):
    """pulsos: [(nivel, µs)]. Corta por los silencios largos y devuelve las tramas que parecen un mando."""
    tramas, cur, sync = [], [], 0
    for nivel, us in pulsos:
        if nivel == 0 and us > 4000:
            if 16 <= len(cur) <= 260 and cur[0][0] == 1:
                tramas.append((sync, cur))
            cur, sync = [], us
            continue
        if us < 80 or us > 3500:
            cur = []
            continue
        cur.append((nivel, us))
    return tramas


def _firma(trama):
    _, t = trama
    base = statistics.median(sorted(us for _, us in t)[:max(3, len(t) // 3)])
    u = tuple(max(1, round(us / base)) for _, us in t)
    return sum(us for _, us in t) / sum(u), u                  # pulso base medido con toda la trama


def _cargar_rf():
    try:
        RF["codigo"] = json.load(open(ARCH_RF))
    except Exception:
        RF["codigo"] = None


def aprender(seg=7):
    """Escucha unos segundos mientras pulsas tu mando 2 veces y guarda la señal."""
    if RF["aprendiendo"]:
        return {"ok": False, "error": "Ya estoy escuchando"}
    rx = int(CONF.get("RF_PIN_RX", 27))
    RF["aprendiendo"] = True
    try:
        lg, h = _gpio()
        bordes = []
        lg.gpio_claim_alert(h, rx, lg.BOTH_EDGES)
        cb = lg.callback(h, rx, lg.BOTH_EDGES, lambda c, g, nivel, tick: bordes.append((tick, nivel)))
        time.sleep(seg)
        cb.cancel()
        lg.gpio_free(h, rx)
    except Exception as e:
        RF["aprendiendo"] = False
        return {"ok": False, "error": "No puedo leer el receptor (GPIO%d): %s" % (rx, e)}
    RF["aprendiendo"] = False
    pulsos = []
    for (t0, n0), (t1, _) in zip(bordes, bordes[1:]):
        pulsos.append((n0, (t1 - t0) // 1000))           # nivel que hubo entre los dos bordes, en µs
    tramas = _tramas(pulsos)
    LOG.info("Garaje RF: %d bordes, %d tramas", len(bordes), len(tramas), origen="garaje")
    if len(bordes) < 50:
        return {"ok": False, "error": "No llega nada al receptor. Revisa los cables (DATA al GPIO%d, VCC a 3,3 V)" % rx}
    if len(tramas) < 3:
        return {"ok": False, "error": "No reconozco ninguna señal. Pon el mando a 10-20 cm de la antena y mantén el botón 1 segundo, 2 veces. Si tu mando es de 868 MHz, este receptor (433) no lo oye"}
    # Agrupa las tramas parecidas (iguales salvo 2 pulsos, por el ruido)
    grupos = []                                   # [firma, [bases], [syncs]]
    for t, (b, f) in zip(tramas, [_firma(t) for t in tramas]):
        for g in grupos:
            if len(g[0]) == len(f) and sum(x != y for x, y in zip(g[0], f)) <= 2:
                g[1].append(b); g[2].append(t[0]); break
        else:
            grupos.append([f, [b], [t[0]]])
    grupos.sort(key=lambda g: -len(g[1]))
    mejor, bases, syncs = grupos[0]
    fuertes = [g for g in grupos if len(g[1]) >= 3 and abs(len(g[0]) - len(mejor)) <= 4]
    if len(fuertes) >= 2:
        return {"ok": False, "variable": True, "error": "Cada pulsación manda un código distinto: tu mando es de código variable (rolling code) y no se puede copiar. Usa un relé sobre un mando de verdad (lo explica Sistema › Hardware)"}
    if len(bases) < 3:
        return {"ok": False, "error": "La señal no se repite bien. Acerca el mando a la antena y mantén el botón pulsado 1 segundo, dos veces"}
    base = int(statistics.median(bases))
    sync = int(statistics.median(syncs))
    cod = {"base": base, "unidades": list(mejor), "sync": min(max(sync, 4000), 20000), "fecha": time.strftime("%Y-%m-%d %H:%M"),
           "bits": len(mejor) // 2, "repeticiones": len(bases)}
    os.makedirs(os.path.dirname(ARCH_RF), exist_ok=True)
    json.dump(cod, open(ARCH_RF, "w"))
    RF["codigo"] = cod
    LOG.info("Garaje RF aprendido: %d bits, pulso %d µs", cod["bits"], base, origen="garaje")
    return {"ok": True, "msg": "Mando aprendido: código fijo de %d bits (pulso %d µs). Pulsa Probar delante de la puerta" % (cod["bits"], base)}


def emitir(veces=10):
    c = RF["codigo"]
    if not c:
        return False
    tx = int(CONF.get("RF_PIN_TX", 17))
    lg, h = _gpio()
    lg.gpio_claim_output(h, tx, 0)
    pulsos, nivel = [], 1
    for u in c["unidades"]:
        pulsos.append(lg.pulse(1 if nivel else 0, 1, int(u * c["base"])))
        nivel ^= 1
    pulsos.append(lg.pulse(0, 1, int(c["sync"])))
    try:
        for _ in range(veces):
            lg.tx_wave(h, tx, pulsos)
            while lg.tx_busy(h, tx, lg.TX_WAVE):
                time.sleep(0.002)
    finally:
        lg.gpio_write(h, tx, 0)
        lg.gpio_free(h, tx)
    return True


def arrancar(sis, obd=None):
    global _dev
    CONF.update(sis.CONF)
    _cargar_rf()
    if RF["codigo"]:
        estado.update(activo=True, simulado=not sis.ES_PI, msg="Mando por radio aprendido (%d bits)" % RF["codigo"]["bits"])
    pin = int(CONF.get("PIN_GARAJE", -1))
    if pin < 0:
        if not RF["codigo"]:
            estado["msg"] = "Sin mando por radio ni relé: se simula"
        return
    if not sis.ES_PI:
        estado["msg"] = "El relé solo funciona en la Raspberry: aquí se simula"
        return
    try:
        from gpiozero import OutputDevice
        _dev = OutputDevice(pin, active_high=not int(CONF.get("GARAJE_ACTIVO_BAJO", 0)), initial_value=False)
        estado.update(activo=True, simulado=False, msg=("Mando por radio y r" if RF["codigo"] else "R") + "elé del garaje en el GPIO %d" % pin)
    except Exception as e:
        estado["msg"] = "No puedo usar el GPIO %d: %s" % (pin, e)


def pulsar(origen="pantalla"):
    with _cerrojo:
        if estado["ultima"] and time.time() - estado["ultima"]["ts"] < 3:
            return {"ok": False, "error": "Espera un momento, acabo de pulsarlo"}
        radio = False
        if RF["codigo"] and not estado["simulado"]:
            try:
                radio = emitir()
            except Exception as e:
                LOG.error("Garaje: no se pudo emitir por radio: %s", e, origen="garaje")
                if not _dev:
                    return {"ok": False, "error": "No se pudo emitir por radio: %s" % e}
        if _dev:
            _dev.on()
            time.sleep(max(0.2, int(CONF.get("GARAJE_PULSO_MS", 600)) / 1000))
            _dev.off()
        estado["ultima"] = {"ts": time.time(), "hora": time.strftime("%H:%M"), "origen": origen}
        estado["veces"] += 1
    return {"ok": True, "simulado": _dev is None and not radio, "radio": radio}


def g_estado(q):
    e = dict(estado)
    c = RF["codigo"]
    e["rf"] = {"aprendido": bool(c), "bits": c and c["bits"], "fecha": c and c["fecha"], "aprendiendo": RF["aprendiendo"],
               "tx": int(CONF.get("RF_PIN_TX", 17)), "rx": int(CONF.get("RF_PIN_RX", 27))}
    return e


def p_accion(d):
    if d.get("accion") == "abrir":
        return pulsar(d.get("origen") or "pantalla")
    if d.get("accion") == "aprender":
        r = aprender()
        if r.get("ok"):
            estado.update(activo=True, msg="Mando por radio aprendido (%d bits)" % RF["codigo"]["bits"])
        return r
    if d.get("accion") == "olvidar_rf":
        try: os.remove(ARCH_RF)
        except Exception: pass
        RF["codigo"] = None
        return {"ok": True}
    return {"ok": False, "error": "Acción desconocida"}


GET = {"/api/garaje": g_estado}
POST = {"/api/garaje": p_accion}
