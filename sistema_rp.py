"""
Radar Play · funciones de sistema para la Raspberry Pi.
En otros equipos (Windows, etc.) solo da información y rechaza las acciones.
"""
import glob, json, os, re, shutil, socket, subprocess, threading, time, zipfile

CARPETA = os.path.dirname(os.path.abspath(__file__))
DATOS = os.path.join(CARPETA, "datos")
CONF_FILE = os.path.join(CARPETA, "sistema", "radar-play.conf")
os.makedirs(DATOS, exist_ok=True)

CONF = {"PUERTO": 8080, "PIN_CONTACTO": -1, "CONTACTO_ACTIVO_BAJO": 1, "APAGADO_SEGUNDOS": 30,
        "OBD_PUERTO": "auto", "PIN_MARCHA_ATRAS": -1, "MARCHA_ATRAS_ACTIVO_BAJO": 1, "GPS_PUERTO": "/dev/ttyACM0", "CARPLAY_CMD": "", "MANDO_IPHONE": 1,
        "PANTALLA_GIRO": 0, "PANTALLA_ESCALA": "1", "PIN_GARAJE": -1, "RF_PIN_TX": 17, "ACTUALIZAR_GITHUB": "morantuzo/Radar-play", "RF_PIN_RX": 27, "GARAJE_ACTIVO_BAJO": 0, "GARAJE_PULSO_MS": 600,
        "RUEDAS": 1, "BLUETOOTH": 1, "ACELEROMETRO": 0, "ACEL_ADELANTE": "x", "GOLPE_G": "2.5",
        "DASHCAM_CAMARA": "", "DASHCAM_GB": 8, "DASHCAM_RES": "1280x720", "DASHCAM_CODIFICADOR": "auto",
        "LEDS": 0, "LEDS_BRILLO": 60, "OBD_EXTRA": "", "LOG_NIVEL": "info"}


def cargar_conf():
    try:
        # utf-8-sig y errors=replace: aguanta el archivo guardado con el Bloc de notas de Windows
        with open(CONF_FILE, encoding="utf-8-sig", errors="replace") as f:
            for linea in f:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                k, v = k.strip(), v.strip().strip('"').strip("'")
                v = v.split("#")[0].strip() if not v.startswith("#") else ""      # comentario al final de la línea
                if k in CONF:
                    if isinstance(CONF[k], int):
                        if re.fullmatch(r"-?\d+", v):
                            CONF[k] = int(v)
                        elif v:
                            print("Aviso: %s=%s no es un número; uso %s" % (k, v, CONF[k]))
                    else:
                        CONF[k] = v
    except FileNotFoundError:
        pass
    return CONF


def _modelo():
    try:
        with open("/proc/device-tree/model") as f:
            return f.read().strip("\x00\n ")
    except Exception:
        return ""


MODELO = _modelo()
ES_PI = "Raspberry" in MODELO
def _version():
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "version.txt"), encoding="utf-8") as f:
            return f.read().strip() or "2026.11"
    except Exception:
        return "2026.11"
VERSION = _version()


def run(cmd, timeout=8, sudo=False):
    if sudo:
        cmd = ["sudo", "-n"] + cmd
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, ((r.stdout or "") + (r.stderr or "")).strip()
    except FileNotFoundError:
        return 127, "No disponible en este equipo"
    except subprocess.TimeoutExpired:
        return 124, "Tiempo agotado"
    except Exception as e:
        return 1, str(e)


def leer(ruta, defecto=None):
    try:
        with open(ruta) as f:
            return f.read().strip()
    except Exception:
        return defecto


def ip_local():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return None
    finally:
        s.close()


# ===================== Estado =====================
contacto = {"activo": CONF["PIN_CONTACTO"] >= 0, "on": None, "apagado_en": None, "pospuesto_hasta": 0, "msg": ""}
camara = {"activo": False, "atras": None, "msg": ""}
gps = {"ok": False, "fix": 0, "lat": None, "lng": None, "speed": None, "track": None, "sats": None, "ts": 0, "estado": "Sin GPS"}


def _backlight():
    d = sorted(glob.glob("/sys/class/backlight/*"))
    return d[0] if d else None


def info():
    i = {"plataforma": "raspberry" if ES_PI else "otro", "modelo": MODELO or os.name, "version": VERSION}
    t = leer("/sys/class/thermal/thermal_zone0/temp")
    i["temp"] = round(int(t) / 1000, 1) if t and t.isdigit() else None
    try:
        i["carga"] = round(os.getloadavg()[0], 2)
    except Exception:
        i["carga"] = None
    mi = leer("/proc/meminfo", "")
    tot = re.search(r"MemTotal:\s+(\d+)", mi)
    disp = re.search(r"MemAvailable:\s+(\d+)", mi)
    i["memoria"] = round(100 - int(disp.group(1)) * 100 / int(tot.group(1))) if tot and disp else None
    try:
        du = shutil.disk_usage(CARPETA)
        i["disco_libre_gb"] = round(du.free / 1e9, 1)
        i["disco_uso"] = round(du.used * 100 / du.total)
    except Exception:
        i["disco_libre_gb"] = i["disco_uso"] = None
    up = leer("/proc/uptime")
    i["encendido_s"] = int(float(up.split()[0])) if up else None
    i["ip"] = ip_local()
    i["wifi"] = None
    if ES_PI:
        c, out = run(["nmcli", "-t", "-f", "ACTIVE,SSID,SIGNAL", "dev", "wifi"], 5)
        for l in out.splitlines():
            p = re.split(r"(?<!\\):", l)
            if len(p) >= 3 and p[0] in ("yes", "sí", "si"):
                i["wifi"] = {"ssid": p[1].replace("\\:", ":"), "senal": int(p[2]) if p[2].isdigit() else None}
        c, out = run(["vcgencmd", "get_throttled"], 3)
        m = re.search(r"0x([0-9a-fA-F]+)", out)
        if m:
            v = int(m.group(1), 16)
            i["bajo_voltaje"] = bool(v & 0x1)
            i["bajo_voltaje_antes"] = bool(v & 0x10000)
            i["limitado"] = bool(v & 0x6)
    bl = _backlight()
    if bl:
        b, mx = leer(bl + "/brightness"), leer(bl + "/max_brightness")
        i["brillo"] = round(int(b) * 100 / int(mx)) if b and mx and int(mx) else None
    else:
        i["brillo"] = None
    c, out = run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"], 3)
    m = re.search(r"Volume:\s*([\d.]+)", out)
    i["volumen"] = round(float(m.group(1)) * 100) if m else None
    i["silencio"] = "MUTED" in out
    i["protegido"] = bool(re.search(r"^\S+ / overlay", leer("/proc/mounts", "") or "", re.M))
    i["contacto"] = dict(contacto)
    i["camara"] = dict(camara)
    i["gps"] = {k: gps[k] for k in ("ok", "fix", "sats", "estado")}
    i["actualizacion"] = buscar_zip()
    return i


# ===================== Antes de apagar =====================
al_apagar = []          # funciones a llamar justo antes de apagar (guardar viaje, aparcado…)
_apagado_hecho = [False]


def antes_de_apagar():
    if _apagado_hecho[0]:
        return
    _apagado_hecho[0] = True
    for f in al_apagar:
        try:
            f()
        except Exception:
            pass


# ===================== Acciones =====================
def _luego(fn, s=1.5):
    threading.Timer(s, fn).start()


def _solo_pi():
    return None if ES_PI else {"ok": False, "error": "Esta función es para la Raspberry Pi."}


def accion(a, d):
    try:
        import registro
        registro.info("Sistema: %s%s", a, (" " + str(d.get("valor"))) if d.get("valor") is not None and a in ("volumen", "brillo") else "", origen="acción")
    except Exception:
        pass
    if a == "posponer":
        contacto["pospuesto_hasta"] = time.time() + int(d.get("segundos", 300))
        return {"ok": True}
    if a == "guardar_ajustes":
        return {"ok": True}
    no = _solo_pi()
    if no:
        return no
    if a == "volumen":
        v = max(0, min(100, int(d.get("valor", 50))))
        c, out = run(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "%d%%" % v])
        if c:
            c, out = run(["amixer", "-q", "sset", "Master", "%d%%" % v])
        return {"ok": c == 0, "error": out if c else None}
    if a == "silencio":
        c, out = run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"])
        return {"ok": c == 0, "error": out if c else None}
    if a == "brillo":
        bl = _backlight()
        if not bl:
            return {"ok": False, "error": "Esta pantalla no permite cambiar el brillo desde el sistema (las HDMI lo hacen con sus botones)."}
        mx = int(leer(bl + "/max_brightness", "255"))
        v = max(5, min(100, int(d.get("valor", 80))))
        try:
            with open(bl + "/brightness", "w") as f:
                f.write(str(round(mx * v / 100)))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": "Sin permiso para el brillo: vuelve a ejecutar el instalador. (%s)" % e}
    if a == "wifi_lista":
        c, out = run(["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "dev", "wifi", "list", "--rescan", "yes"], 20, sudo=True)
        if c:
            return {"ok": False, "error": out or "No se pudo buscar redes"}
        redes, vistos = [], set()
        for l in out.splitlines():
            p = [x.replace("\\:", ":") for x in re.split(r"(?<!\\):", l)]
            if len(p) < 4 or not p[1] or p[1] in vistos:
                continue
            vistos.add(p[1])
            redes.append({"ssid": p[1], "senal": int(p[2]) if p[2].isdigit() else 0, "segura": bool(p[3] and p[3] != "--"), "actual": p[0] == "*"})
        redes.sort(key=lambda r: (-r["actual"], -r["senal"]))
        return {"ok": True, "redes": redes}
    if a == "wifi_conectar":
        ssid = str(d.get("ssid", ""))
        if not ssid:
            return {"ok": False, "error": "Falta el nombre de la red"}
        cmd = ["nmcli", "dev", "wifi", "connect", ssid]
        if d.get("clave"):
            cmd += ["password", str(d["clave"])]
        c, out = run(cmd, 40, sudo=True)
        return {"ok": c == 0, "error": None if c == 0 else (out or "No se pudo conectar")}
    if a == "apagar":
        _luego(lambda: (antes_de_apagar(), run(["systemctl", "poweroff"], sudo=True)))
        return {"ok": True}
    if a == "reiniciar":
        _luego(lambda: (antes_de_apagar(), run(["systemctl", "reboot"], sudo=True)))
        return {"ok": True}
    if a == "escritorio":
        open(os.path.expanduser("~/.radar-play-escritorio"), "w").close()
        def _cerrar():
            # kiosk.sh ve el aviso, no vuelve a abrir el navegador y abre el escritorio normal
            run(["pkill", "-f", "radar-play-chromium"])
            time.sleep(2)
            run(["pkill", "-f", "chromium.*kiosk"])
        _luego(_cerrar, 1)
        return {"ok": True}
    if a == "protegido":
        on = bool(d.get("on"))
        c, out = run(["raspi-config", "nonint", "do_overlayfs", "0" if on else "1"], 120, sudo=True)
        return {"ok": c == 0, "error": None if c == 0 else (out or "No se pudo cambiar"), "reiniciar": True}
    if a == "actualizar":
        return actualizar()
    return {"ok": False, "error": "Acción desconocida"}


# ===================== Actualizar desde USB =====================
def buscar_zip():
    pats = ["/media/*/*/Radar-Play*.zip", "/media/*/Radar-Play*.zip", "/mnt/*/Radar-Play*.zip",
            os.path.expanduser("~/Descargas/Radar-Play*.zip"), os.path.expanduser("~/Downloads/Radar-Play*.zip")]
    zs = [z for p in pats for z in glob.glob(p)]
    if not zs:
        return None
    z = max(zs, key=os.path.getmtime)
    return {"ruta": z, "fecha": time.strftime("%d/%m/%Y %H:%M", time.localtime(os.path.getmtime(z)))}


def actualizar():
    z = buscar_zip()
    if not z:
        return {"ok": False, "error": "No encuentro Radar-Play.zip en el USB ni en Descargas."}
    base = os.path.realpath(CARPETA)
    try:
        with zipfile.ZipFile(z["ruta"]) as zf:
            nombres = [n for n in zf.namelist() if n.startswith("radar-play/")]
            if "radar-play/radar-play-google.html" not in nombres:
                return {"ok": False, "error": "Ese zip no parece de Radar Play."}
            copia = os.path.join(os.path.dirname(base), "radar-play-copia")
            shutil.rmtree(copia, ignore_errors=True)
            shutil.copytree(base, copia, ignore=shutil.ignore_patterns("datos", "__pycache__"))
            for n in nombres:
                rel = n[len("radar-play/"):]
                if not rel or rel.endswith("/") or rel.startswith("datos/") or rel == "sistema/radar-play.conf":
                    continue
                dst = os.path.realpath(os.path.join(base, rel))
                if not dst.startswith(base + os.sep):
                    continue
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with zf.open(n) as src, open(dst + ".nuevo", "wb") as out:
                    shutil.copyfileobj(src, out)
                os.replace(dst + ".nuevo", dst)
                if dst.endswith((".sh", ".py")):
                    os.chmod(dst, 0o755)
    except zipfile.BadZipFile:
        return {"ok": False, "error": "El zip está dañado. Vuelve a copiarlo."}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    _luego(lambda: os._exit(0), 1.5)    # systemd vuelve a arrancar el puente con el código nuevo
    return {"ok": True, "copia": "radar-play-copia"}


# ===================== Copia de ajustes =====================
AJUSTES = os.path.join(DATOS, "ajustes.json")


def leer_ajustes():
    try:
        with open(AJUSTES, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def guardar_ajustes(obj):
    if not isinstance(obj, dict) or not isinstance(obj.get("data"), dict):
        return {"ok": False}
    tmp = AJUSTES + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, AJUSTES)
    return {"ok": True}


# ===================== Contacto (llave) y apagado =====================
def hilo_contacto():
    pin = CONF["PIN_CONTACTO"]
    contacto["activo"] = pin >= 0
    if pin < 0:
        contacto["msg"] = "Sin cable de contacto (PIN_CONTACTO=-1)"
        return
    if not ES_PI:
        contacto["msg"] = "Solo en la Raspberry"
        return
    try:
        from gpiozero import Button
        b = Button(pin, pull_up=True, bounce_time=0.1)
    except Exception as e:
        contacto["msg"] = "No puedo leer el pin %d: %s" % (pin, e)
        return
    contacto["msg"] = "Leyendo el contacto en el GPIO %d" % pin
    t_off, apagando = None, False
    while True:
        on = b.is_pressed if CONF["CONTACTO_ACTIVO_BAJO"] else not b.is_pressed
        contacto["on"] = on
        ahora = time.time()
        if on:
            t_off, contacto["apagado_en"] = None, None
        elif ahora < contacto["pospuesto_hasta"]:
            t_off, contacto["apagado_en"] = contacto["pospuesto_hasta"], None
        else:
            t_off = t_off or ahora
            resto = CONF["APAGADO_SEGUNDOS"] - (ahora - t_off)
            contacto["apagado_en"] = max(0, int(resto + .99))
            if resto <= 0 and not apagando:
                apagando = True
                antes_de_apagar()
                run(["systemctl", "poweroff"], sudo=True)
        time.sleep(0.5)


# ===================== Marcha atrás =====================
def hilo_marcha_atras():
    pin = CONF["PIN_MARCHA_ATRAS"]
    if pin < 0 or not ES_PI:
        camara["msg"] = "Sin cable de marcha atrás" if pin < 0 else "Solo en la Raspberry"
        return
    try:
        from gpiozero import Button
        b = Button(pin, pull_up=True, bounce_time=0.05)
    except Exception as e:
        camara["msg"] = "No puedo leer el pin %d: %s" % (pin, e)
        return
    camara.update(activo=True, msg="Leyendo la marcha atrás en el GPIO %d" % pin)
    while True:
        camara["atras"] = b.is_pressed if CONF["MARCHA_ATRAS_ACTIVO_BAJO"] else not b.is_pressed
        time.sleep(0.05)


# ===================== GPS (gpsd) =====================
def hilo_gps():
    while True:
        try:
            s = socket.create_connection(("127.0.0.1", 2947), timeout=5)
            s.sendall(b'?WATCH={"enable":true,"json":true}\n')
            gps["estado"] = "Esperando señal del GPS…"
            buf = b""
            s.settimeout(10)
            while True:
                trozo = s.recv(4096)
                if not trozo:
                    break
                buf += trozo
                while b"\n" in buf:
                    linea, buf = buf.split(b"\n", 1)
                    try:
                        m = json.loads(linea)
                    except Exception:
                        continue
                    if m.get("class") == "TPV":
                        modo = int(m.get("mode") or 0)
                        gps["fix"] = modo
                        if modo >= 2 and m.get("lat") is not None:
                            gps.update(ok=True, lat=m["lat"], lng=m["lon"], speed=round((m.get("speed") or 0) * 3.6, 1),
                                       track=m.get("track"), ts=time.time(), estado="Posición %dD" % modo)
                        else:
                            gps.update(ok=False, estado="Buscando satélites…")
                    elif m.get("class") == "SKY":
                        sats = m.get("satellites") or []
                        gps["sats"] = m.get("uSat") if m.get("uSat") is not None else sum(1 for x in sats if x.get("used"))
                    elif m.get("class") == "DEVICES" and not m.get("devices"):
                        gps["estado"] = "No hay ningún GPS conectado"
        except Exception:
            gps.update(ok=False, estado="Sin GPS" + ("" if ES_PI else " (solo en la Raspberry)"))
        time.sleep(10)


def arrancar_hilos():
    threading.Thread(target=hilo_contacto, daemon=True).start()
    threading.Thread(target=hilo_gps, daemon=True).start()
    threading.Thread(target=hilo_marcha_atras, daemon=True).start()
