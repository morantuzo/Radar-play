# Radar Play · reloj redondo (se guarda en la placa como main.py)
# Recibe por el USB, en líneas JSON, qué mostrar y lo dibuja como un reloj de aguja.
#   {"q":1}                          → contesta quién es
#   {"cfg":{"t":"TURBO","u":"BAR","min":0,"max":2,"d":2,"rojo":1.8,"frio":null,"pico":1}}
#   {"v":1.23}  /  {"v":null}        → valor (null = sin datos)
#   {"on":1}  {"brillo":80}  {"rb":0}  {"ident":"1"}
import sys, time, json, math, gc
import framebuf, select
from array import array
from gc9a01 import LCD

VER = 3
try:
    PLACA = open("placa.txt").read().strip() or "lcd128"
except Exception:
    PLACA = "lcd128"
try:
    import machine, ubinascii
    UID = ubinascii.hexlify(machine.unique_id()).decode()
except Exception:
    UID = "sim"

W = 240
BAND = 40
buf = bytearray(W * BAND * 2)
fb = framebuf.FrameBuffer(buf, W, BAND, framebuf.RGB565)
lcd = LCD(PLACA)

RB = [0]                                   # 1 = el panel tiene rojo y azul cambiados


def rgb(r, g, b):
    if RB[0]:
        r, b = b, r
    c = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
    return ((c & 0xFF) << 8) | (c >> 8)    # el panel quiere el byte alto primero


def colores():
    global NEGRO, BLANCO, GRIS, GRIS2, PISTA, ROJO, ROJO_OSC, AZUL, AMBAR
    NEGRO = rgb(0, 0, 0); BLANCO = rgb(255, 255, 255); GRIS = rgb(150, 150, 155); GRIS2 = rgb(80, 80, 86)
    PISTA = rgb(34, 34, 38); ROJO = rgb(255, 40, 50); ROJO_OSC = rgb(80, 12, 16); AZUL = rgb(60, 150, 255); AMBAR = rgb(255, 170, 30)


colores()

# ---------- letras 5x7 ----------
F = {
    "0": b"\x3E\x51\x49\x45\x3E", "1": b"\x00\x42\x7F\x40\x00", "2": b"\x42\x61\x51\x49\x46", "3": b"\x21\x41\x45\x4B\x31",
    "4": b"\x18\x14\x12\x7F\x10", "5": b"\x27\x45\x45\x45\x39", "6": b"\x3C\x4A\x49\x49\x30", "7": b"\x01\x71\x09\x05\x03",
    "8": b"\x36\x49\x49\x49\x36", "9": b"\x06\x49\x49\x29\x1E", "A": b"\x7E\x11\x11\x11\x7E", "B": b"\x7F\x49\x49\x49\x36",
    "C": b"\x3E\x41\x41\x41\x22", "D": b"\x7F\x41\x41\x22\x1C", "E": b"\x7F\x49\x49\x49\x41", "F": b"\x7F\x09\x09\x09\x01",
    "G": b"\x3E\x41\x49\x49\x7A", "H": b"\x7F\x08\x08\x08\x7F", "I": b"\x00\x41\x7F\x41\x00", "J": b"\x20\x40\x41\x3F\x01",
    "K": b"\x7F\x08\x14\x22\x41", "L": b"\x7F\x40\x40\x40\x40", "M": b"\x7F\x02\x0C\x02\x7F", "N": b"\x7F\x04\x08\x10\x7F",
    "O": b"\x3E\x41\x41\x41\x3E", "P": b"\x7F\x09\x09\x09\x06", "Q": b"\x3E\x41\x51\x21\x5E", "R": b"\x7F\x09\x19\x29\x46",
    "S": b"\x46\x49\x49\x49\x31", "T": b"\x01\x01\x7F\x01\x01", "U": b"\x3F\x40\x40\x40\x3F", "V": b"\x1F\x20\x40\x20\x1F",
    "W": b"\x3F\x40\x38\x40\x3F", "X": b"\x63\x14\x08\x14\x63", "Y": b"\x07\x08\x70\x08\x07", "Z": b"\x61\x51\x49\x45\x43",
    ".": b"\x00\x60\x60\x00\x00", "-": b"\x08\x08\x08\x08\x08", " ": b"\x00\x00\x00\x00\x00", "°": b"\x00\x06\x09\x09\x06",
    ":": b"\x00\x36\x36\x00\x00", "/": b"\x20\x10\x08\x04\x02", "%": b"\x23\x13\x08\x64\x62", "+": b"\x08\x08\x3E\x08\x08",
}


def ancho(t, s):
    return len(t) * 6 * s - s


def texto(t, cx, y, s, c, oy):
    """Texto centrado en cx. oy = fila donde empieza la franja que se está pintando."""
    if y - oy > BAND or y + 7 * s - oy < 0:
        return
    x = cx - ancho(t, s) // 2
    yy = y - oy
    for ch in t:
        col = F.get(ch.upper(), F[" "])
        for i in range(5):
            b = col[i]
            if b:
                for j in range(7):
                    if b & (1 << j):
                        fb.fill_rect(x + i * s, yy + j * s, s, s, c)
        x += 6 * s


# ---------- números grandes (7 segmentos) ----------
DW, DH, T = 38, 66, 9
SEG = {"0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
       "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g"}


def _seg(x, y, horiz, largo):
    h = T // 2
    if horiz:
        return array("h", [x, y + h, x + h, y, x + largo - h, y, x + largo, y + h, x + largo - h, y + T, x + h, y + T])
    return array("h", [x + h, y, x + T, y + h, x + T, y + largo - h, x + h, y + largo, x, y + largo - h, x, y + h])


def _segs(d, x, y):
    m = DH // 2
    out = []
    for s in SEG.get(d, ""):
        if s == "a": out.append(_seg(x + 2, y, True, DW - 4))
        elif s == "g": out.append(_seg(x + 2, y + m - T // 2, True, DW - 4))
        elif s == "d": out.append(_seg(x + 2, y + DH - T, True, DW - 4))
        elif s == "f": out.append(_seg(x, y + 2, False, m - 2))
        elif s == "b": out.append(_seg(x + DW - T, y + 2, False, m - 2))
        elif s == "e": out.append(_seg(x, y + m, False, m - 2))
        elif s == "c": out.append(_seg(x + DW - T, y + m, False, m - 2))
    return out


def ancho_num(t):
    return sum(14 if ch == "." else DW + 8 for ch in t) - 8


def numero(t, cx, y, c, oy):
    if y - oy > BAND or y + DH - oy < 0:
        return
    x = cx - ancho_num(t) // 2
    for ch in t:
        if ch == ".":
            fb.fill_rect(x, y + DH - T - oy, T, T, c)
            x += 14
            continue
        for p in _segs(ch, x, y):
            fb.poly(0, -oy, p, c, True)
        x += DW + 8


# ---------- arco ----------
CX = CY = 120
R1, R2 = 100, 117
N = 45
A0, A1 = 135.0, 405.0                       # de abajo-izquierda a abajo-derecha, por arriba


def _quad(a, b, r1, r2):
    ra, rb_ = math.radians(a), math.radians(b)
    p = [CX + r1 * math.cos(ra), CY + r1 * math.sin(ra), CX + r2 * math.cos(ra), CY + r2 * math.sin(ra),
         CX + r2 * math.cos(rb_), CY + r2 * math.sin(rb_), CX + r1 * math.cos(rb_), CY + r1 * math.sin(rb_)]
    return array("h", [int(round(v)) for v in p])


paso = (A1 - A0) / N
SEGS = []
for i in range(N):
    q = _quad(A0 + i * paso + 0.8, A0 + (i + 1) * paso - 0.8, R1, R2)
    SEGS.append((q, min(q[1::2]), max(q[1::2])))

# ---------- estado ----------
cfg = {"t": "", "u": "", "min": 0.0, "max": 1.0, "d": 0, "rojo": None, "frio": None, "pico": 0}
st = {"v": None, "mostrado": None, "on": 0, "brillo": 80, "ident": None, "ident_t": 0, "ult": time.ticks_ms(),
      "pico": None, "pico_t": 0, "barrido": 0, "encendido": False}


def frac(v):
    if v is None:
        return 0
    r = (v - cfg["min"]) / ((cfg["max"] - cfg["min"]) or 1)
    return 0 if r < 0 else 1 if r > 1 else r


def fmt(v):
    if v is None:
        return "--"
    d = int(cfg.get("d") or 0)
    s = ("%." + str(d) + "f") % v
    return s[1:] if s.startswith("-") and float(s) == 0 else s


def color_valor(v):
    if v is None:
        return GRIS2
    if cfg.get("rojo") is not None and v >= cfg["rojo"]:
        return ROJO
    if cfg.get("frio") is not None and v < cfg["frio"]:
        return AZUL
    return BLANCO


def pintar(v, titulo=None, gran=None, extra=None):
    """Dibuja el reloj completo franja a franja."""
    f = frac(v)
    llenos = int(f * N + 0.5)
    rojo_desde = int(frac(cfg["rojo"]) * N) if cfg.get("rojo") is not None else N + 1
    cv = color_valor(v)
    pico_i = int(frac(st["pico"]) * N + 0.5) - 1 if (cfg.get("pico") and st["pico"] is not None) else -1
    txt = gran if gran is not None else fmt(v)
    for oy in range(0, 240, BAND):
        fb.fill(NEGRO)
        for i in range(N):
            q, y0, y1 = SEGS[i]
            if y1 < oy or y0 >= oy + BAND:
                continue
            if i < llenos:
                if i >= rojo_desde:
                    c = ROJO
                elif cv == AZUL:
                    c = AZUL
                elif i >= rojo_desde - 4:
                    c = AMBAR
                else:
                    c = BLANCO
            else:
                c = ROJO_OSC if i >= rojo_desde else PISTA
            if i == pico_i and i >= llenos:
                c = GRIS
            fb.poly(0, -oy, q, c, True)
        texto(titulo if titulo is not None else cfg["t"], 120, 52, 2, GRIS, oy)
        numero(txt, 120, 86, cv if gran is None else BLANCO, oy)
        texto(cfg["u"] if gran is None else "", 120, 162, 2, GRIS, oy)
        if extra:
            texto(extra, 120, 192, 2, GRIS2, oy)
        elif cfg.get("pico") and st["pico"] is not None and gran is None:
            texto("MAX " + fmt(st["pico"]), 120, 192, 2, GRIS2, oy)
        lcd.banda(oy, BAND, buf, fb)


def negro():
    fb.fill(NEGRO)
    for oy in range(0, 240, BAND):
        lcd.banda(oy, BAND, buf, fb)


def barrido():
    """Al encender: la aguja sube al máximo y vuelve, como un cuadro de verdad."""
    lo, hi = cfg["min"], cfg["max"]
    pasos = 14
    for k in list(range(pasos + 1)) + list(range(pasos, -1, -1)):
        pintar(lo + (hi - lo) * k / pasos, gran="")
        if k == 1 and not st["encendido"]:
            lcd.brillo(st["brillo"])
            st["encendido"] = True
    st["mostrado"] = None


# ---------- entrada por USB ----------
poll = select.poll()
poll.register(sys.stdin, select.POLLIN)
linea = []


def leer():
    while poll.poll(0):
        ch = sys.stdin.read(1)
        if not ch:
            return
        if ch in "\r\n":
            if linea:
                procesar("".join(linea))
                linea.clear()
        elif len(linea) < 600:
            linea.append(ch)


def procesar(l):
    try:
        m = json.loads(l)
    except Exception:
        return
    st["ult"] = time.ticks_ms()
    if "q" in m:
        print(json.dumps({"reloj": "radarplay", "v": VER, "id": UID, "placa": PLACA}))
    if "rb" in m:
        RB[0] = 1 if m["rb"] else 0
        colores()
        st["mostrado"] = None
    if "cfg" in m:
        cfg.update(m["cfg"])
        st["pico"] = None
        st["mostrado"] = None
    if "brillo" in m:
        st["brillo"] = m["brillo"]
        if st["on"]:
            lcd.brillo(st["brillo"])
    if "ident" in m:
        st["ident"] = str(m["ident"])
        st["ident_t"] = time.ticks_ms()
        st["mostrado"] = None
    if "v" in m:
        st["v"] = m["v"]
    if "on" in m:
        on = 1 if m["on"] else 0
        if on and not st["on"]:
            st["on"] = 1
            lcd.dormir(False)
            barrido()
        elif not on and st["on"]:
            st["on"] = 0
            lcd.brillo(0)
            negro()
            lcd.dormir(True)
            st["encendido"] = False


def bucle():
    vis = None
    while True:
        leer()
        ahora = time.ticks_ms()
        if st["on"] and time.ticks_diff(ahora, st["ult"]) > 15000:     # Radar Play apagado: fuera pantalla
            procesar('{"on":0}')
        if st["ident"] is not None:
            if time.ticks_diff(ahora, st["ident_t"]) > 6000:
                st["ident"] = None
                st["mostrado"] = None
                if not st["on"]:
                    lcd.brillo(0); negro(); lcd.dormir(True)
            elif st["mostrado"] != "ident":
                if not st["on"]:
                    lcd.dormir(False); lcd.brillo(st["brillo"] or 60)
                pintar(cfg["max"], titulo="PANTALLA", gran=st["ident"], extra=cfg["t"])
                st["mostrado"] = "ident"
            time.sleep_ms(30)
            continue
        if not st["on"]:
            time.sleep_ms(40)
            continue
        v = st["v"]
        if v is None:
            vis = None
        else:
            vis = v if vis is None else vis + (v - vis) * 0.45       # la aguja se mueve suave
            if abs(vis - v) < (10 ** -(int(cfg.get("d") or 0))) / 2:
                vis = v
        if cfg.get("pico") and v is not None:
            if st["pico"] is None or v > st["pico"]:
                st["pico"], st["pico_t"] = v, ahora
            elif time.ticks_diff(ahora, st["pico_t"]) > 10000:
                st["pico"], st["pico_t"] = v, ahora
        clave = (fmt(vis), int(frac(vis) * N + 0.5), fmt(st["pico"]) if cfg.get("pico") else "")
        if clave != st["mostrado"]:
            pintar(vis)
            st["mostrado"] = clave
            gc.collect()
        else:
            time.sleep_ms(15)


negro()
bucle()
