"""
Radar Play · Gasolineras
Precios oficiales del Ministerio para la Transición Ecológica (gratis, se
actualizan cada media hora). El puente los descarga y guarda una copia en
datos/gasolineras.json para que funcione también sin cobertura.
Si el puente no puede descargarlos, la pantalla los descarga y se los pasa.
"""
import json, os, threading, time, unicodedata, urllib.request

URL = "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/"
CARPETA = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(CARPETA, "datos", "gasolineras.json")
CADA = 30 * 60
estado = {"fecha": None, "descargado": 0, "n": 0, "error": None, "origen": None}
lista = []
_cerrojo = threading.Lock()
TIPOS = {"A": "gasoleo a", "P": "gasoleo premium", "95": "gasolina 95 e5", "98": "gasolina 98 e5", "GLP": "gases licuados del petroleo"}


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return " ".join(s.replace("(wgs84)", "").split())


def _num(v):
    try:
        v = str(v).strip().replace(",", ".")
        return float(v) if v else None
    except ValueError:
        return None


def compactar(bruto):
    """Del JSON del Ministerio a una lista pequeña: id, rótulo, dirección, municipio, lat, lng, horario, precios."""
    filas = bruto.get("ListaEESSPrecio") or []
    out = []
    for f in filas:
        n = {_norm(k): v for k, v in f.items()}
        lat, lng = _num(n.get("latitud")), _num(n.get("longitud"))
        if lat is None or lng is None:
            continue
        p = {}
        for k, campo in TIPOS.items():
            v = _num(n.get("precio " + campo))
            if v:
                p[k] = v
        if not p:
            continue
        out.append({"id": str(n.get("ideess", "")), "r": (n.get("rotulo") or "").strip().title(), "d": (n.get("direccion") or "").strip().title(),
                    "m": (n.get("municipio") or n.get("localidad") or "").strip().title(), "lat": lat, "lng": lng,
                    "h": (n.get("horario") or "").strip(), "p": p})
    return out


def guardar(fecha, filas, origen):
    with _cerrojo:
        lista[:] = filas
        estado.update(fecha=fecha, descargado=time.time(), n=len(filas), error=None, origen=origen)
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"fecha": fecha, "descargado": estado["descargado"], "lista": filas}, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(CACHE + ".tmp", CACHE)
    except Exception:
        pass


def descargar():
    req = urllib.request.Request(URL, headers={"Accept": "application/json", "User-Agent": "RadarPlay/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        bruto = json.loads(r.read().decode("utf-8-sig"))
    filas = compactar(bruto)
    if not filas:
        raise ValueError("El Ministerio no ha devuelto gasolineras")
    guardar(bruto.get("Fecha"), filas, "puente")


def hilo():
    try:
        with open(CACHE, encoding="utf-8") as f:
            c = json.load(f)
        with _cerrojo:
            lista[:] = c["lista"]
            estado.update(fecha=c.get("fecha"), descargado=c.get("descargado", 0), n=len(lista), origen="copia")
    except Exception:
        pass
    while True:
        if time.time() - estado["descargado"] > CADA:
            try:
                descargar()
            except Exception as e:
                estado["error"] = str(e)[:160]
        time.sleep(60 if estado["error"] else 300)


def arrancar(sis=None, obd=None):
    threading.Thread(target=hilo, daemon=True).start()


def g_datos(q):
    with _cerrojo:
        return {**estado, "viejo": time.time() - estado["descargado"] > CADA, "lista": lista}


def g_estado(q):
    return {**estado, "viejo": time.time() - estado["descargado"] > CADA}


def p_datos(d):
    """La pantalla descargó los precios ella misma (si el puente no pudo): los guardamos."""
    filas = compactar(d.get("bruto") or {}) if d.get("bruto") else d.get("lista") or []
    if not filas:
        return {"ok": False, "error": "Sin datos"}
    guardar(d.get("fecha") or (d.get("bruto") or {}).get("Fecha"), filas, "pantalla")
    return {"ok": True, "n": len(filas)}


def mas_barata(lat, lng, tipo="A", radio_km=10):
    """Para el mando del iPhone y Siri."""
    import math
    mejor = None
    with _cerrojo:
        for g in lista:
            pr = g["p"].get(tipo)
            if not pr:
                continue
            dy = (g["lat"] - lat) * 111.2
            dx = (g["lng"] - lng) * 111.2 * math.cos(math.radians(lat))
            km = math.hypot(dx, dy)
            if km <= radio_km and (not mejor or pr < mejor["precio"]):
                mejor = {"nombre": g["r"], "direccion": g["d"], "municipio": g["m"], "precio": pr, "km": round(km, 1), "lat": g["lat"], "lng": g["lng"]}
    return mejor


GET = {"/api/gasolineras": g_datos, "/api/gasolineras/estado": g_estado}
POST = {"/api/gasolineras": p_datos}
