"""
Radar Play · Acelerómetro (MPU-6050 por I2C, unos 5 €)
Da las fuerzas G reales (para la vista Dynamic y el cronómetro) y detecta
golpes para que la dashcam guarde el vídeo.
Conexión: VCC→3,3 V (pin 1), GND→pin 6, SDA→GPIO2 (pin 3), SCL→GPIO3 (pin 5).
Actívalo con ACELEROMETRO=1 en sistema/radar-play.conf.
Orientación: ACEL_ADELANTE dice qué eje del sensor apunta hacia el morro (x, -x, y, -y).
"""
import math, threading, time

estado = {"ok": False, "msg": "Desactivado (ACELEROMETRO=0)", "long": 0.0, "lat": 0.0, "vert": 0.0, "max_g": 0.0, "golpe": None, "ts": 0}
al_golpe = []        # funciones a llamar cuando hay un golpe


def hilo(conf):
    try:
        try:
            from smbus2 import SMBus
        except ImportError:
            from smbus import SMBus
    except ImportError:
        estado["msg"] = "Falta python3-smbus (lo instala instalar.sh)"
        return
    try:
        bus = SMBus(1)
        bus.write_byte_data(0x68, 0x6B, 0)       # despertar
        bus.write_byte_data(0x68, 0x1C, 0x10)    # ±8 g
        bus.write_byte_data(0x68, 0x1A, 0x03)    # filtro paso bajo ~44 Hz
    except Exception as e:
        estado["msg"] = "No encuentro el MPU-6050 en el I2C: %s" % e
        return

    def leer():
        b = bus.read_i2c_block_data(0x68, 0x3B, 6)
        v = []
        for i in (0, 2, 4):
            x = (b[i] << 8) | b[i + 1]
            v.append((x - 65536 if x > 32767 else x) / 4096.0)   # en g (±8 g)
        return v

    # Calibra la gravedad con el coche quieto al arrancar
    muestras = [leer() for _ in range(100) if time.sleep(0.01) is None]
    g0 = [sum(m[i] for m in muestras) / len(muestras) for i in range(3)]
    eje = str(conf.get("ACEL_ADELANTE", "x")).strip().lower()
    idx_l = 0 if "x" in eje else 1
    sig_l = -1 if eje.startswith("-") else 1
    idx_t = 1 - idx_l
    umbral = float(conf.get("GOLPE_G", 2.5))
    estado.update(ok=True, msg="Acelerómetro funcionando")
    suave = [0.0, 0.0, 0.0]
    ultimo_golpe = 0
    while True:
        try:
            a = leer()
            d = [a[i] - g0[i] for i in range(3)]
            for i in range(3):
                suave[i] += (d[i] - suave[i]) * 0.15
            total = math.sqrt(sum(x * x for x in d))
            estado.update(long=round(sig_l * suave[idx_l], 2), lat=round(suave[idx_t], 2), vert=round(suave[2], 2),
                          max_g=max(estado["max_g"], round(total, 2)), ts=time.time())
            if total >= umbral and time.time() - ultimo_golpe > 10:
                ultimo_golpe = time.time()
                estado["golpe"] = {"ts": ultimo_golpe, "g": round(total, 1), "hora": time.strftime("%H:%M:%S")}
                for f in al_golpe:
                    try: f(total)
                    except Exception: pass
        except Exception as e:
            estado.update(ok=False, msg="Error leyendo el acelerómetro: %s" % e)
            time.sleep(2)
        time.sleep(0.02)


def arrancar(sis, obd=None):
    if not int(sis.CONF.get("ACELEROMETRO", 0)):
        return
    if not sis.ES_PI:
        estado["msg"] = "Solo en la Raspberry"
        return
    threading.Thread(target=hilo, args=(sis.CONF,), daemon=True).start()


def g_acel(q):
    return {**estado, "fresco": time.time() - estado["ts"] < 1}


def p_acel(d):
    if d.get("accion") == "reset_max":
        estado["max_g"] = 0.0
    return {"ok": True}


GET = {"/api/acel": g_acel}
POST = {"/api/acel": p_acel}
