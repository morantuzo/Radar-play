"""
Radar Play · Clave de Google desde el móvil o el PC, y comprobar las APIs
- Pegas la clave de Google Maps y el ID de mapa en la página del móvil
  (/actualizar, desde el mando) y la pantalla del coche los coge sola.
- Comprueba con Google cada API que usa Radar Play y dice cuál falta activar.
"""
import json, os, re, threading, time, urllib.error, urllib.request
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
AJUSTES = os.path.join(CARPETA, "datos", "ajustes.json")
pendiente = {"datos": None, "ts": 0}
ultima = {"res": None, "ts": 0, "maps_js": None}
REFERER = "http://localhost:8080/"

APIS = [
    ("maps", "Maps JavaScript API", "El mapa, Street View y la vista 3D"),
    ("routes", "Routes API", "Las rutas y la navegación"),
    ("places", "Places API (New)", "Buscar sitios, fichas, Explorar y gasolineras en ruta"),
    ("geocoding", "Geocoding API", "Saber la dirección de un punto del mapa"),
    ("youtube", "YouTube Data API v3", "Buscar en la app de YouTube (opcional)"),
]


def _pedir(url, datos=None, cab=None):
    req = urllib.request.Request(url, data=json.dumps(datos).encode() if datos is not None else None,
                                 headers={"Referer": REFERER, "Content-Type": "application/json", **(cab or {})})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def _explica(texto):
    t = texto or ""
    if re.search(r"has not been used|is disabled|not activated|SERVICE_DISABLED|not enabled", t, re.I):
        return "No está activada. Actívala en APIs y servicios › Biblioteca"
    if re.search(r"API_KEY_SERVICE_BLOCKED|blocked|not authorized to use this API", t, re.I):
        return "Tu clave tiene «Restricciones de API» y esta no está en la lista. Añádela en Credenciales › tu clave"
    if re.search(r"referer|referrer", t, re.I):
        return "Tu clave solo vale para ciertas webs. En Credenciales › tu clave, añade http://localhost:8080/* o quita la restricción"
    if re.search(r"billing|facturaci", t, re.I):
        return "Falta activar la facturación del proyecto"
    if re.search(r"API key not valid|invalid|INVALID_ARGUMENT.*key", t, re.I):
        return "La clave no es válida. Cópiala y pégala otra vez"
    return t[:160] or "Error desconocido"


def comprobar(clave):
    """Prueba cada API con una petición pequeña (casi gratis)."""
    res = {}
    if not re.fullmatch(r"AIza[0-9A-Za-z_\-]{35}", clave or ""):
        msg = "La clave tiene que empezar por AIza (con I mayúscula) y tener 39 caracteres" + (" (tiene %d)" % len(clave) if clave else "")
        return [{"id": i, "api": n, "para": p, "ok": False, "msg": msg} for i, n, p in APIS]
    try:
        st, j = _pedir("https://maps.googleapis.com/maps/api/geocode/json?latlng=40.19,-3.68&language=es&key=" + clave)
        ok = j.get("status") in ("OK", "ZERO_RESULTS")
        res["geocoding"] = (ok, "Funciona" if ok else _explica(j.get("error_message") or j.get("status")))
    except Exception as e:
        res["geocoding"] = (None, "Sin internet: %s" % e)
    try:
        st, j = _pedir("https://places.googleapis.com/v1/places:searchText", {"textQuery": "Valdemoro", "pageSize": 1},
                       {"X-Goog-Api-Key": clave, "X-Goog-FieldMask": "places.id"})
        res["places"] = (st == 200, "Funciona" if st == 200 else _explica(json.dumps(j.get("error", j))))
    except Exception as e:
        res["places"] = (None, "Sin internet: %s" % e)
    try:
        st, j = _pedir("https://routes.googleapis.com/directions/v2:computeRoutes",
                       {"origin": {"address": "Valdemoro"}, "destination": {"address": "Pinto, Madrid"}, "travelMode": "DRIVE"},
                       {"X-Goog-Api-Key": clave, "X-Goog-FieldMask": "routes.duration"})
        res["routes"] = (st == 200, "Funciona" if st == 200 else _explica(json.dumps(j.get("error", j))))
    except Exception as e:
        res["routes"] = (None, "Sin internet: %s" % e)
    try:
        st, j = _pedir("https://www.googleapis.com/youtube/v3/videos?part=id&chart=mostPopular&maxResults=1&regionCode=ES&key=" + clave)
        res["youtube"] = (st == 200, "Funciona" if st == 200 else _explica(json.dumps(j.get("error", j))))
    except Exception as e:
        res["youtube"] = (None, "Sin internet: %s" % e)
    mj = ultima.get("maps_js")
    if mj and mj.get("clave_fin") == clave[-6:]:
        res["maps"] = (mj["ok"], "Funciona en la pantalla" if mj["ok"] else _explica(mj["msg"]) + " (" + mj["msg"] + ")")
    else:
        res["maps"] = (None, "La comprueba la pantalla del coche al cargar el mapa")
    out = [{"id": i, "api": n, "para": p, "ok": res.get(i, (None, ""))[0], "msg": res.get(i, (None, ""))[1]} for i, n, p in APIS]
    ultima.update(res=out, ts=time.time())
    LOG.info("APIs de Google: %s", ", ".join("%s=%s" % (o["id"], "ok" if o["ok"] else "no" if o["ok"] is False else "?") for o in out), origen="google")
    return out


def clave_guardada():
    try:
        return json.load(open(AJUSTES, encoding="utf-8")).get("data", {}).get("rp-clave", "")
    except Exception:
        return ""


def limpiar(v):
    return re.sub(r"[\s\"'«»“”]+", "", str(v or ""))


def recibir(d):
    """Lo que llega desde el móvil: clave, ID de mapa y clave de YouTube."""
    clave, mapid, yt = limpiar(d.get("clave")), limpiar(d.get("mapid")), limpiar(d.get("yt"))
    datos = {}
    if clave:
        if not clave.startswith("AIza"):
            return {"ok": False, "error": "La clave de Google empieza por AIza. Eso parece otra cosa"}
        datos["rp-clave"] = clave
    if mapid:
        if mapid.startswith("AIza") or not re.fullmatch(r"[0-9A-Za-z_\-]{8,40}", mapid):
            return {"ok": False, "error": "El ID de mapa son solo letras y números (por ejemplo e5f6dd00696737c72101fead)"}
        datos["rp-mapid"] = mapid
        datos["rp-mapid-fallo"] = ""
    if yt:
        datos["rp-ytkey"] = yt
    if d.get("quitar_mapid"):
        datos["rp-mapid"] = ""
    if not datos:
        return {"ok": False, "error": "No has escrito nada"}
    pendiente.update(datos=datos, ts=time.time())
    LOG.info("Ajustes de Google recibidos desde el móvil: %s", ", ".join(datos), origen="google")
    apis = comprobar(clave or clave_guardada()) if d.get("comprobar", True) else None
    return {"ok": True, "msg": "Enviado. La pantalla del coche se recarga sola en unos segundos", "apis": apis}


def g_pendiente(q):
    """La pantalla pregunta si hay ajustes nuevos del móvil (y se los lleva)."""
    if pendiente["datos"] and time.time() - pendiente["ts"] < 600:
        d = pendiente["datos"]
        pendiente.update(datos=None)
        return {"datos": d}
    return {"datos": None}


def p_google(d):
    a = d.get("accion")
    if a == "maps_js":                      # la pantalla dice si el mapa ha cargado con la clave
        ultima["maps_js"] = {"ok": bool(d.get("ok")), "msg": str(d.get("msg") or "")[:200], "clave_fin": str(d.get("clave_fin") or "")}
        return {"ok": True}
    if a == "comprobar":
        return {"ok": True, "apis": comprobar(limpiar(d.get("clave")) or clave_guardada())}
    return recibir(d)


def arrancar(sis=None, obd=None):
    pass


GET = {"/api/google/pendiente": g_pendiente}
POST = {"/api/google": p_google}
