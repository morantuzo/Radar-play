"""
Radar Play · Mi coche (todo local, sin internet)

Lleva en la Raspberry:
  - Los kilómetros totales: los que pones una vez del cuadro + lo recorrido con GPS.
  - Los viajes, con un consumo estimado a partir del motor (OBD o la pantalla).
  - Los repostajes, que dan el consumo medio REAL (método lleno a lleno).
  - El mantenimiento: plan (filtros, correa de distribución, aceite...) e historial.

Archivos en datos/: km.json (se escribe a menudo), coche.json, viajes.json.
"""
import json, math, os, threading, time, uuid
from datetime import datetime, date

CARPETA = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(CARPETA, "datos")
KMF = os.path.join(DATOS, "km.json")
COCHEF = os.path.join(DATOS, "coche.json")
VIAJESF = os.path.join(DATOS, "viajes.json")
_cerrojo = threading.RLock()

# Plan orientativo para un Alfa Romeo Giulietta 1.6 JTDM. Compruébalo con tu libro de mantenimiento.
PLAN = [
    {"id": "aceite", "nombre": "Aceite y filtro de aceite", "cada_km": 35000, "cada_meses": 12},
    {"id": "aire", "nombre": "Filtro de aire", "cada_km": 35000, "cada_meses": 24},
    {"id": "polen", "nombre": "Filtro de habitáculo (polen)", "cada_km": 35000, "cada_meses": 12},
    {"id": "gasoil", "nombre": "Filtro de gasoil", "cada_km": 67500, "cada_meses": 48},
    {"id": "distribucion", "nombre": "Correa de distribución y bomba de agua", "cada_km": 135000, "cada_meses": 60,
     "notas": "Dato de fábrica. Muchos talleres recomiendan cambiarla antes, sobre 80.000 km o 4 años."},
    {"id": "accesorios", "nombre": "Correa de accesorios", "cada_km": 100000},
    {"id": "frenos_liq", "nombre": "Líquido de frenos", "cada_meses": 24},
    {"id": "frenos", "nombre": "Pastillas y discos (revisar)", "cada_km": 30000},
    {"id": "ruedas", "nombre": "Neumáticos y presiones (revisar)", "cada_km": 10000, "cada_meses": 6},
    {"id": "bateria", "nombre": "Batería (revisar)", "cada_meses": 48},
    {"id": "itv", "nombre": "ITV", "fecha": True},
    {"id": "seguro", "nombre": "Seguro", "fecha": True},
    {"id": "impuesto", "nombre": "Impuesto de circulación", "fecha": True},
]


def _leer(ruta, defecto):
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return defecto


def _guardar(ruta, obj):
    os.makedirs(DATOS, exist_ok=True)
    tmp = ruta + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, ruta)  # así un corte de corriente no deja el archivo a medias


km = _leer(KMF, {"acum": 0.0})
datos = _leer(COCHEF, {})
datos.setdefault("odometro", None)            # {"km": del cuadro, "acum": km["acum"] en ese momento, "fecha"}
datos.setdefault("mant", [dict(x) for x in PLAN])
datos.setdefault("historial", [])
datos.setdefault("repostajes", [])
viajes_lista = _leer(VIAJESF, [])
hoy = lambda: date.today().isoformat()
ahora = lambda: datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


def guardar_datos():
    with _cerrojo:
        _guardar(COCHEF, datos)


def km_total():
    o = datos.get("odometro")
    if not o or o.get("km") is None:
        return None
    return float(o["km"]) + km["acum"] - float(o.get("acum") or 0)


def fmt_km(v):
    return "—" if v is None else "{:,.0f} km".format(v).replace(",", ".")


# ===================== Mantenimiento =====================
def _fecha(s):
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _sumar_meses(d, m):
    y, mm = divmod(d.month - 1 + int(m), 12)
    import calendar
    dia = min(d.day, calendar.monthrange(d.year + y, mm + 1)[1])
    return date(d.year + y, mm + 1, dia)


def estado_item(it, kt):
    """Cuánto falta para cada tarea. estado: vencido / pronto / ok / sin_datos."""
    r = {"falta_km": None, "falta_dias": None, "progreso": None, "proximo_km": None, "proxima_fecha": None}
    partes, prog = [], []
    if it.get("fecha"):
        f = _fecha(it.get("fecha_limite"))
        if not f:
            return {**r, "estado": "sin_datos", "texto": "Pon la fecha de vencimiento"}
        dias = (f - date.today()).days
        r.update(falta_dias=dias, proxima_fecha=f.isoformat(), progreso=max(0, min(1.2, 1 - dias / 365)))
        txt = ("Vencida hace %d días" % -dias) if dias < 0 else ("Hoy" if dias == 0 else "Vence en %d días" % dias)
        return {**r, "estado": "vencido" if dias < 0 else "pronto" if dias <= 30 else "ok", "texto": txt}
    if it.get("cada_km") and it.get("ultimo_km") is not None:
        r["proximo_km"] = it["ultimo_km"] + it["cada_km"]
        if kt is not None:
            falta = r["proximo_km"] - kt
            r["falta_km"] = round(falta)
            prog.append((kt - it["ultimo_km"]) / it["cada_km"])
            partes.append(("pasado %s" % fmt_km(-falta)) if falta < 0 else ("en %s" % fmt_km(falta)))
    if it.get("cada_meses") and _fecha(it.get("ultima_fecha")):
        f0 = _fecha(it["ultima_fecha"])
        f = _sumar_meses(f0, it["cada_meses"])
        dias = (f - date.today()).days
        r.update(falta_dias=dias, proxima_fecha=f.isoformat())
        prog.append((date.today() - f0).days / max(1, (f - f0).days))
        if dias < 0:
            partes.append("pasado hace %d días" % -dias)
        elif dias < 60:
            partes.append("en %d días" % dias)
        else:
            partes.append("en %d meses" % round(dias / 30.44))
    if not prog:
        return {**r, "estado": "sin_datos", "texto": "Apunta cuándo se hizo la última vez"}
    p = max(prog)
    r["progreso"] = round(max(0, min(1.2, p)), 3)
    venc = (r["falta_km"] is not None and r["falta_km"] < 0) or (r["falta_dias"] is not None and r["falta_dias"] < 0)
    pronto = (r["falta_km"] is not None and r["falta_km"] <= 1500) or (r["falta_dias"] is not None and r["falta_dias"] <= 30)
    return {**r, "estado": "vencido" if venc else "pronto" if pronto else "ok", "texto": "Toca " + " o ".join(partes)}


def pendientes():
    kt = km_total()
    out = []
    for it in datos["mant"]:
        e = estado_item(it, kt)
        if e["estado"] in ("vencido", "pronto"):
            out.append({"id": it["id"], "nombre": it["nombre"], "texto": e["texto"], "urgente": e["estado"] == "vencido"})
    return sorted(out, key=lambda x: not x["urgente"])


# ===================== Consumo =====================
def consumo_real():
    """Lleno a lleno: litros echados entre dos llenos / km entre ellos."""
    rep = sorted([r for r in datos["repostajes"] if r.get("km") is not None], key=lambda r: (r["km"], r.get("fecha", "")))
    tramos, base, litros = [], None, 0.0
    for r in rep:
        if base is None:
            if r.get("lleno", True):
                base = r
            continue
        litros += float(r.get("litros") or 0)
        if r.get("lleno", True):
            d = r["km"] - base["km"]
            if d > 20:
                tramos.append({"hasta": r["id"], "fecha": r.get("fecha"), "km": round(d), "litros": round(litros, 2),
                               "l100": round(litros / d * 100, 2)})
            base, litros = r, 0.0
    tot_km = sum(t["km"] for t in tramos)
    tot_l = sum(t["litros"] for t in tramos)
    euros = [r for r in datos["repostajes"] if r.get("euros") and r.get("litros")]
    precio = sum(r["euros"] for r in euros) / sum(r["litros"] for r in euros) if euros else None
    return {"tramos": tramos, "media": round(tot_l / tot_km * 100, 2) if tot_km else None,
            "ultima": tramos[-1]["l100"] if tramos else None, "precio_litro": round(precio, 3) if precio else None,
            "gastado": round(sum(float(r.get("euros") or 0) for r in datos["repostajes"]), 2)}


# ===================== Viajes =====================
def dist(a, b):
    R = 6371000.0
    la1, la2, dl = math.radians(a[0]), math.radians(b[0]), math.radians(b[1] - a[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1, math.sqrt(h)))


class Viajes:
    def __init__(self):
        self.v, self.ult, self.parado, self.ult_parcial, self.ult_km = None, None, None, 0, 0

    def paso(self, p, vel, consumo, sim, eco=None):
        """p=(lat,lng) o None; vel km/h; consumo l/100 km instantáneo o None. Se llama cada 2 s."""
        t = time.time()
        if p and self.ult:
            d = dist(self.ult, p)
            if 2 < d < (3000 if sim else 150):           # descarta saltos raros del GPS
                if not sim:                               # lo simulado no suma al cuentakilómetros
                    km["acum"] += d / 1000
                if self.v:
                    self.v["km"] += d / 1000
                    if eco is not None and 0 <= eco <= 100:
                        self.v["eco_s"] += eco * d
                        self.v["eco_d"] += d
                    if consumo is not None and 0 < consumo < 40 and vel > 3:
                        self.v["litros"] += consumo * d / 100000
                        self.v["km_con"] += d / 1000
                    if not self.v["ruta"] or dist(self.v["ruta"][-1], p) > 200:
                        self.v["ruta"].append([round(p[0], 5), round(p[1], 5)])
                        if len(self.v["ruta"]) > 150:
                            self.v["ruta"] = self.v["ruta"][::2]
        if p:
            self.ult = p
        if vel > 5 and not self.v and p:
            self.v = {"id": datetime.now().strftime("%Y%m%d-%H%M%S"), "inicio": ahora(), "km": 0.0, "max": 0.0, "suma_v": 0.0,
                      "n": 0, "litros": 0.0, "km_con": 0.0, "km_ini": km_total(), "ruta": [[round(p[0], 5), round(p[1], 5)]], "sim": sim, "eco_s": 0.0, "eco_d": 0.0,
                      "t0": t}
        if self.v:
            self.v["max"] = max(self.v["max"], vel)
            if vel > 2:
                self.v["suma_v"] += vel
                self.v["n"] += 1
                self.parado = None
            else:
                self.parado = self.parado or t
                if t - self.parado > 600:              # 10 min parado: fin del viaje
                    self.cerrar()
            if self.v and t - self.ult_parcial > 120:
                self.ult_parcial = t
                self.guardar(False)
        if t - self.ult_km > 30:
            self.ult_km = t
            _guardar(KMF, km)

    def resumen(self, fin):
        v = self.v
        return {"id": v["id"], "inicio": v["inicio"], "fin": ahora(), "terminado": fin, "km": round(v["km"], 2),
                "duracion_s": int(time.time() - v["t0"]), "vel_media": round(v["suma_v"] / v["n"], 1) if v["n"] else 0,
                "vel_max": round(v["max"], 1), "litros_est": round(v["litros"], 2),
                "consumo_est": round(v["litros"] / v["km_con"] * 100, 1) if v["km_con"] > 0.5 else None,
                "ruta": v["ruta"], "simulado": v["sim"], "km_total_fin": km_total(),
                "eco": round(v["eco_s"] / v["eco_d"]) if v.get("eco_d", 0) > 300 else None}

    def guardar(self, fin):
        if not self.v:
            return
        r = self.resumen(fin)
        with _cerrojo:
            viajes_lista[:] = [x for x in viajes_lista if x["id"] != r["id"]]
            if fin and r["km"] < 0.2:
                pass                                       # viaje de nada: no se guarda
            else:
                viajes_lista.insert(0, r)
            del viajes_lista[400:]
            _guardar(VIAJESF, viajes_lista)

    def cerrar(self):
        if self.v:
            self.guardar(True)
        if self.ult:                                       # dónde se queda aparcado
            datos["aparcado"] = {"lat": round(self.ult[0], 6), "lng": round(self.ult[1], 6), "desde": ahora(),
                                 "simulado": bool(self.v and self.v.get("sim"))}
            guardar_datos()
        self.v, self.parado = None, None
        _guardar(KMF, km)


viajes = Viajes()
tele = {"ts": 0}


def telemetria(d):
    """La pantalla de Radar Play envía posición, velocidad y datos del motor cada 2 s."""
    tele.update(d)
    tele["ts"] = time.time()


def _instante(sis, obd):
    g = sis.gps
    fresco = time.time() - tele["ts"] < 6
    if g.get("ok") and time.time() - g.get("ts", 0) < 6:
        p, vel, sim = (g["lat"], g["lng"]), g.get("speed") or 0, False
    elif fresco and tele.get("lat") is not None:
        p, vel, sim = (tele["lat"], tele["lng"]), tele.get("speed") or 0, bool(tele.get("sim"))
    else:
        p, vel, sim = None, 0, False
    if obd.get("ok") and obd.get("speed") is not None:
        vel = obd["speed"]
    consumo = tele.get("consumo") if fresco else None
    eco = tele.get("eco") if fresco else None
    return p, vel, consumo, sim, eco


def hilo(sis, obtener_obd):
    while True:
        try:
            p, vel, consumo, sim, eco = _instante(sis, obtener_obd())
            viajes.paso(p, vel, consumo, sim, eco)
        except Exception as e:
            print("coche:", e)
        time.sleep(2)


def apagando():
    viajes.cerrar()


def arrancar(sis, obtener_obd):
    threading.Thread(target=hilo, args=(sis, obtener_obd), daemon=True).start()


# ===================== Lo que ve la pantalla =====================
def _mes(s):
    return str(s or "")[:7]


def info():
    kt = km_total()
    reales = [v for v in viajes_lista if not v.get("simulado")]
    mes = datetime.now().strftime("%Y-%m")
    del_mes = [v for v in reales if _mes(v.get("inicio")) == mes]
    con = [v for v in reales if v.get("consumo_est") is not None]
    km_con = sum(v["km"] for v in con)
    actual = viajes.resumen(False) if viajes.v else None
    items = []
    for it in datos["mant"]:
        items.append({**it, **estado_item(it, kt)})
    orden = {"vencido": 0, "pronto": 1, "ok": 2, "sin_datos": 3}
    items.sort(key=lambda x: (orden[x["estado"]], x.get("progreso") is None, -(x.get("progreso") or 0)))
    return {
        "km_total": kt, "odometro": datos.get("odometro"),
        "viaje": actual and {k: actual[k] for k in ("km", "duracion_s", "vel_media", "consumo_est", "simulado", "eco")},
        "aparcado": None if viajes.v else datos.get("aparcado"),
        "eco_media": (lambda e: round(sum(e) / len(e)) if e else None)([v["eco"] for v in reales[:20] if v.get("eco") is not None]),
        "mes": {"km": round(sum(v["km"] for v in del_mes), 1), "viajes": len(del_mes),
                "horas": round(sum(v["duracion_s"] for v in del_mes) / 3600, 1)},
        "consumo_est": round(sum(v["litros_est"] for v in con) / km_con * 100, 1) if km_con > 1 else None,
        "consumo": consumo_real(),
        "repostajes": sorted(datos["repostajes"], key=lambda r: (r.get("fecha", ""), r.get("km") or 0), reverse=True),
        "viajes": ([actual] if actual else []) + [v for v in viajes_lista if not actual or v["id"] != actual["id"]][:60],
        "mant": items, "historial": sorted(datos["historial"], key=lambda h: (h.get("fecha", ""), h.get("km") or 0), reverse=True),
        "gasto_taller": round(sum(float(h.get("coste") or 0) for h in datos["historial"]), 2),
        "pendientes": pendientes(),
    }


def _num(v, entero=False):
    if v in (None, ""):
        return None
    s = str(v).strip().replace(" ", "").replace("€", "")
    if "," in s:                       # 1.234,5 → 1234.5
        s = s.replace(".", "").replace(",", ".")
    elif entero:                       # 146.600 km → 146600
        s = s.replace(".", "")
    v = float(s)
    return int(round(v)) if entero else v


def _item(i):
    for it in datos["mant"]:
        if it["id"] == i:
            return it
    raise ValueError("No encuentro esa tarea de mantenimiento")


def accion(d):
    a = d.get("accion")
    try:
        with _cerrojo:
            if a == "odometro":
                v = _num(d.get("km"), True)
                if v is None or not 0 <= v < 2000000:
                    raise ValueError("Escribe los km que marca el cuadro")
                datos["odometro"] = {"km": v, "acum": round(km["acum"], 3), "fecha": hoy()}
            elif a == "repostaje":
                litros = _num(d.get("litros"))
                if not litros or litros <= 0 or litros > 120:
                    raise ValueError("Escribe los litros que echaste")
                r = {"id": d.get("id") or uuid.uuid4().hex[:8], "fecha": d.get("fecha") or hoy(),
                     "km": _num(d.get("km"), True) if d.get("km") not in (None, "") else (round(km_total()) if km_total() is not None else None),
                     "litros": round(litros, 2), "euros": _num(d.get("euros")), "lleno": bool(d.get("lleno", True)),
                     "notas": (d.get("notas") or "").strip()[:120]}
                if r["km"] is None:
                    raise ValueError("Pon los km del cuadro (o ajusta el cuentakilómetros primero)")
                datos["repostajes"] = [x for x in datos["repostajes"] if x["id"] != r["id"]] + [r]
            elif a == "borrar_repostaje":
                datos["repostajes"] = [x for x in datos["repostajes"] if x["id"] != d.get("id")]
            elif a == "hecho":
                it = _item(d.get("item"))
                f = d.get("fecha") or hoy()
                kh = _num(d.get("km"), True) if d.get("km") not in (None, "") else (round(km_total()) if km_total() is not None else None)
                h = {"id": uuid.uuid4().hex[:8], "item": it["id"], "nombre": it["nombre"], "fecha": f, "km": kh,
                     "coste": _num(d.get("coste")), "taller": (d.get("taller") or "").strip()[:60], "notas": (d.get("notas") or "").strip()[:200]}
                if it.get("fecha"):
                    if not _fecha(d.get("fecha_limite")):
                        raise ValueError("Pon la nueva fecha de vencimiento")
                    it["fecha_limite"] = d["fecha_limite"][:10]
                    h["fecha_limite"] = it["fecha_limite"]
                else:
                    it["ultima_fecha"], it["ultimo_km"] = f, kh
                datos["historial"].append(h)
            elif a == "borrar_historial":
                datos["historial"] = [x for x in datos["historial"] if x["id"] != d.get("id")]
            elif a == "editar_item":
                it = _item(d["id"]) if d.get("id") else None
                if not it:
                    it = {"id": uuid.uuid4().hex[:8]}
                    datos["mant"].append(it)
                nombre = (d.get("nombre") or "").strip()
                if not nombre:
                    raise ValueError("Ponle un nombre")
                it["nombre"] = nombre[:60]
                it["fecha"] = bool(d.get("fecha"))
                for k in ("cada_km", "cada_meses", "ultimo_km"):
                    if k in d:
                        it[k] = _num(d.get(k), True)
                for k in ("ultima_fecha", "fecha_limite"):
                    if k in d:
                        it[k] = d.get(k)[:10] if _fecha(d.get(k)) else None
                if "notas" in d:
                    it["notas"] = (d.get("notas") or "").strip()[:200]
            elif a == "borrar_item":
                datos["mant"] = [x for x in datos["mant"] if x["id"] != d.get("id")]
            elif a == "restaurar_plan":
                ya = {x["id"] for x in datos["mant"]}
                datos["mant"] += [dict(x) for x in PLAN if x["id"] not in ya]
            elif a == "borrar_viaje":
                viajes_lista[:] = [x for x in viajes_lista if x["id"] != d.get("id")]
                _guardar(VIAJESF, viajes_lista)
                return {"ok": True}
            else:
                raise ValueError("Acción desconocida")
            guardar_datos()
        return {"ok": True}
    except (ValueError, KeyError, TypeError) as e:
        return {"ok": False, "error": str(e)}
