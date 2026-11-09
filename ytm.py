"""
Radar Play · YouTube Music con TU cuenta (Premium)
- Inicias sesión una vez en la Raspberry (ventana de YouTube Music). Radar
  Play guarda la sesión y cierra la ventana.
- Tu contenido sale de tu cuenta con ytmusicapi: tu inicio, tus listas (y las
  compartidas que guardaste), «Me gusta», álbumes, búsquedas y la radio de
  cada canción. Sin límite de búsquedas.
- El sonido lo pone mpv (solo audio, sin anuncios, muy ligero) con yt-dlp.
  Sigue sonando aunque cambies de pantalla.
Herramientas no oficiales: si YouTube cambia algo puede fallar unos días;
instalar.sh y Radar Play actualizan yt-dlp y ytmusicapi.
"""
import glob, json, os, shutil, socket, subprocess, threading, time, urllib.request
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
AUTH = os.path.join(CARPETA, "datos", "ytm-cuenta.json")
COOKIES = os.path.join(CARPETA, "datos", "ytm-cookies.txt")
PERFIL = os.path.expanduser("~/.config/radar-play-ytmusic")
PUERTO = 9224
SOCK = "/tmp/radar-play-mpv.sock"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

estado = {"cuenta": False, "nombre": "", "foto": "", "msg": "", "login": False, "error": ""}
rep = {"cola": [], "idx": -1, "pausa": True, "pos": 0.0, "dur": 0.0, "cargando": False, "vol": 100, "duck": False,
       "error": "", "repetir": "no", "n": 0}
_int = {"yt": None, "proc_login": None, "mpv": None, "sock": None, "lock": threading.Lock(), "urls": {}, "rid": 0,
        "resp": {}, "sis": None, "cache": {}}


# ===================== Sesión =====================
def _yt():
    if _int["yt"]:
        return _int["yt"]
    if not os.path.exists(AUTH):
        return None
    from ytmusicapi import YTMusic
    _int["yt"] = YTMusic(AUTH, language="es", location="ES")
    return _int["yt"]


def _cargar_cuenta():
    if not os.path.exists(AUTH):
        estado.update(cuenta=False)
        return
    try:
        yt = _yt()
        info = {}
        try:
            info = yt.get_account_info() or {}
        except Exception:
            pass
        estado.update(cuenta=True, nombre=info.get("accountName", ""), foto=info.get("accountPhotoUrl", ""), error="")
        LOG.info("YT Music: sesión cargada", origen="ytm")
    except Exception as e:
        estado.update(cuenta=False, error="La sesión no vale: %s" % str(e)[:120])
        LOG.aviso("YT Music: %s", e, origen="ytm")


def iniciar_sesion():
    """Abre una ventana de YouTube Music para entrar con tu cuenta. Cuando entras, guarda la sesión."""
    if estado["login"]:
        return {"ok": True}
    sis = _int["sis"]
    nav = next((shutil.which(c) for c in ("chromium", "chromium-browser", "google-chrome") if shutil.which(c)), None)
    if not nav:
        return {"ok": False, "error": "No encuentro Chromium"}
    try:
        import apps
        env = apps._entorno()
    except Exception:
        env = dict(os.environ)
    subprocess.call(["pkill", "-f", PERFIL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.makedirs(PERFIL, exist_ok=True)
    url = "https://accounts.google.com/ServiceLogin?service=youtube&hl=es&continue=https%3A%2F%2Fmusic.youtube.com%2F"
    _int["proc_login"] = subprocess.Popen(
        [nav, "--user-data-dir=" + PERFIL, "--remote-debugging-port=%d" % PUERTO, "--remote-allow-origins=*",
         "--app=" + url, "--start-maximized", "--lang=es-ES", "--no-first-run", "--password-store=basic", "--class=radar-play-ytm"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    estado.update(login=True, msg="Entra con tu cuenta de Google en la ventana. Se cierra sola al terminar.", error="")
    threading.Thread(target=_vigilar_login, daemon=True, name="ytm-login").start()
    LOG.info("YT Music: ventana para iniciar sesión abierta", origen="ytm")
    return {"ok": True}


def _cookies_navegador():
    from whatsapp_web import CDP
    with urllib.request.urlopen("http://127.0.0.1:%d/json/version" % PUERTO, timeout=3) as r:
        ws = json.loads(r.read())["webSocketDebuggerUrl"]
    cdp = CDP(ws, lambda *a: None)
    try:
        return cdp("Storage.getCookies").get("cookies", [])
    finally:
        cdp.ws.cerrar()


def _guardar_sesion(cookies):
    yt_c = [c for c in cookies if c["domain"].endswith("youtube.com")]
    cab = "; ".join("%s=%s" % (c["name"], c["value"]) for c in yt_c)
    os.makedirs(os.path.dirname(AUTH), exist_ok=True)
    json.dump({"cookie": cab, "x-goog-authuser": "0", "origin": "https://music.youtube.com", "user-agent": UA,
               "accept-language": "es-ES,es;q=0.9", "content-type": "application/json"}, open(AUTH, "w"))
    os.chmod(AUTH, 0o600)
    # Para yt-dlp (mejor calidad Premium y menos bloqueos «confirma que no eres un robot»)
    with open(COOKIES, "w") as f:
        f.write("# Netscape HTTP Cookie File\n")
        for c in cookies:
            if not (c["domain"].endswith("youtube.com") or c["domain"].endswith("google.com")):
                continue
            f.write("\t".join([c["domain"], "TRUE" if c["domain"].startswith(".") else "FALSE", c.get("path", "/"),
                               "TRUE" if c.get("secure") else "FALSE", str(int(c.get("expires", 0)) if c.get("expires", -1) > 0 else 0),
                               c["name"], c["value"]]) + "\n")
    os.chmod(COOKIES, 0o600)
    _int["yt"] = None


def _vigilar_login():
    hasta = time.time() + 900
    try:
        while time.time() < hasta:
            time.sleep(3)
            p = _int["proc_login"]
            if not p or p.poll() is not None:
                estado.update(msg="Has cerrado la ventana sin terminar de entrar")
                return
            try:
                ck = _cookies_navegador()
            except Exception:
                continue
            nombres = {c["name"] for c in ck if c["domain"].endswith("youtube.com")}
            if "SAPISID" in nombres or "__Secure-3PAPISID" in nombres:
                time.sleep(4)                                   # deja que YouTube Music termine de cargar
                _guardar_sesion(_cookies_navegador())
                _cargar_cuenta()
                estado.update(msg="Sesión iniciada" if estado["cuenta"] else "No se pudo leer la cuenta")
                LOG.info("YT Music: sesión iniciada", origen="ytm")
                return
        estado.update(msg="Se acabó el tiempo para entrar")
    finally:
        estado["login"] = False
        p = _int["proc_login"]
        if p and p.poll() is None:
            try: os.killpg(p.pid, 15)
            except Exception: pass


def cerrar_sesion():
    for f in (AUTH, COOKIES):
        try: os.remove(f)
        except Exception: pass
    shutil.rmtree(PERFIL, ignore_errors=True)
    _int.update(yt=None, cache={})
    estado.update(cuenta=False, nombre="", foto="")
    parar()
    return {"ok": True}


# ===================== Contenido de tu cuenta =====================
def _foto(th):
    th = th or []
    return (th[-1]["url"] if th else "").replace("w60-h60", "w400-h400").replace("w120-h120", "w400-h400")


def _artistas(x):
    a = x.get("artists") or []
    if isinstance(a, list):
        return ", ".join(i.get("name", "") for i in a if i and i.get("name"))
    return str(a or "")


def _norm(x):
    """Cualquier cosa de YouTube Music → {tipo, id, title, sub, thumb, dur}"""
    if not isinstance(x, dict):
        return None
    if x.get("videoId"):
        return {"tipo": "cancion", "id": x["videoId"], "title": x.get("title", ""), "sub": _artistas(x) or x.get("author", ""),
                "thumb": _foto(x.get("thumbnails") or (x.get("thumbnail") or [])), "dur": x.get("duration") or "",
                "album": (x.get("album") or {}).get("name", "") if isinstance(x.get("album"), dict) else ""}
    if x.get("playlistId") and not x.get("browseId", "").startswith("MPRE"):
        return {"tipo": "lista", "id": x["playlistId"], "title": x.get("title", ""), "sub": x.get("description") or _artistas(x) or x.get("author", "") or (str(x.get("count", "")) + " canciones" if x.get("count") else ""),
                "thumb": _foto(x.get("thumbnails"))}
    if x.get("browseId", "").startswith("MPRE") or x.get("type") in ("Album", "Single", "EP"):
        return {"tipo": "album", "id": x.get("browseId"), "title": x.get("title", ""), "sub": _artistas(x) or x.get("year", ""), "thumb": _foto(x.get("thumbnails"))}
    if x.get("browseId", "").startswith("UC"):
        return {"tipo": "artista", "id": x["browseId"], "title": x.get("title") or x.get("artist", ""), "sub": "Artista", "thumb": _foto(x.get("thumbnails"))}
    return None


def _cache(clave, seg, fn):
    c = _int["cache"].get(clave)
    if c and time.time() - c[0] < seg:
        return c[1]
    v = fn()
    _int["cache"][clave] = (time.time(), v)
    return v


def inicio():
    yt = _yt()
    def f():
        out = []
        for sec in yt.get_home(limit=8):
            items = [i for i in (_norm(x) for x in sec.get("contents") or []) if i]
            if items:
                out.append({"titulo": sec.get("title", ""), "items": items[:20]})
        return out
    return _cache("inicio", 1800, f)


def biblioteca():
    yt = _yt()
    def f():
        listas = [i for i in (_norm(x) for x in yt.get_library_playlists(limit=100)) if i]
        albumes = []
        try:
            albumes = [i for i in (_norm(x) for x in yt.get_library_albums(limit=50)) if i]
        except Exception:
            pass
        return {"listas": listas, "albumes": albumes}
    return _cache("biblio", 600, f)


def lista(pid):
    yt = _yt()
    def f():
        if pid.startswith("MPRE"):
            p = yt.get_album(pid)
            th = _foto(p.get("thumbnails"))
            canc = [dict(_norm(t) or {}, thumb=_foto(t.get("thumbnails")) or th) for t in p.get("tracks") or [] if t.get("videoId")]
            return {"title": p.get("title", ""), "sub": _artistas(p) + (" · " + str(p.get("year")) if p.get("year") else ""), "thumb": th, "items": canc}
        p = yt.get_liked_songs(limit=500) if pid == "LM" else yt.get_playlist(pid, limit=300)
        canc = [i for i in (_norm(t) for t in p.get("tracks") or []) if i and i["tipo"] == "cancion"]
        return {"title": p.get("title") or ("Me gusta" if pid == "LM" else ""), "sub": (p.get("author") or {}).get("name", "") if isinstance(p.get("author"), dict) else "",
                "thumb": _foto(p.get("thumbnails")) or (canc[0]["thumb"] if canc else ""), "items": canc}
    return _cache("l-" + pid, 300, f)


def buscar(q):
    yt = _yt()
    def f():
        canc = [i for i in (_norm(x) for x in yt.search(q, filter="songs", limit=20)) if i]
        listas = []
        for filtro in ("albums", "playlists"):
            try:
                listas += [i for i in (_norm(x) for x in yt.search(q, filter=filtro, limit=8)) if i]
            except Exception:
                pass
        return {"canciones": canc, "listas": listas}
    return _cache("s-" + q.lower(), 900, f)


def explorar():
    yt = _yt()
    def f():
        out = []
        try:
            ex = yt.get_explore()
            for k, titulo in (("new_releases", "Novedades"), ("top_songs", "Lo más escuchado"), ("trending", "Tendencias"), ("new_videos", "Vídeos nuevos")):
                v = ex.get(k)
                items = v.get("items") if isinstance(v, dict) else v
                items = [i for i in (_norm(x) for x in items or []) if i]
                if items:
                    out.append({"titulo": titulo, "items": items[:20]})
        except Exception as e:
            LOG.aviso("YT Music explorar: %s", e, origen="ytm")
        try:
            mood = yt.get_mood_categories()
            gen = []
            for grupo, cats in mood.items():
                for c in cats[:12]:
                    gen.append({"tipo": "animo", "id": c["params"], "title": c["title"], "sub": grupo})
            if gen:
                out.append({"titulo": "Estados de ánimo y géneros", "items": gen, "animo": True})
        except Exception:
            pass
        return out
    return _cache("explorar", 3600, f)


def animo(params):
    yt = _yt()
    return _cache("m-" + params, 3600, lambda: [i for i in (_norm(x) for x in yt.get_mood_playlists(params)) if i])


def radio(video_id):
    yt = _yt()
    r = yt.get_watch_playlist(videoId=video_id, limit=30)
    return [i for i in (_norm(t) for t in r.get("tracks") or []) if i and i["tipo"] == "cancion"]


# ===================== Reproductor (mpv, solo audio) =====================
def _ytdlp():
    for c in (os.path.expanduser("~/.local/bin/yt-dlp"), shutil.which("yt-dlp") or ""):
        if c and os.access(c, os.X_OK):
            return c
    return None


def _url(video_id):
    """Enlace del audio (con tu sesión Premium si está guardada)."""
    u = _int["urls"].get(video_id)
    if u and time.time() - u[0] < 3 * 3600:
        return u[1]
    y = _ytdlp()
    if not y:
        raise RuntimeError("Falta yt-dlp (lo instala instalar.sh)")
    c = [y, "-f", "bestaudio[ext=webm]/bestaudio/best", "-g", "--no-playlist", "--no-warnings"]
    if os.path.exists(COOKIES):
        c += ["--cookies", COOKIES]
    if shutil.which("node"):
        c += ["--js-runtimes", "node"]
    r = subprocess.run(c + ["https://music.youtube.com/watch?v=" + video_id], capture_output=True, text=True, timeout=60)
    if r.returncode != 0 and "--js-runtimes" in c:                 # yt-dlp antiguo sin esa opción
        c2 = [x for x in c if x not in ("--js-runtimes", "node")]
        r = subprocess.run(c2 + ["https://music.youtube.com/watch?v=" + video_id], capture_output=True, text=True, timeout=60)
    url = (r.stdout or "").strip().splitlines()
    if r.returncode != 0 or not url:
        raise RuntimeError((r.stderr or "yt-dlp no da el audio").strip().splitlines()[-1][:160])
    _int["urls"][video_id] = (time.time(), url[0])
    return url[0]


def _mpv():
    p = _int["mpv"]
    if p and p.poll() is None and _int["sock"]:
        return True
    if not shutil.which("mpv"):
        rep["error"] = "Falta mpv (lo instala instalar.sh)"
        return False
    try: os.remove(SOCK)
    except Exception: pass
    _int["mpv"] = subprocess.Popen(["mpv", "--idle=yes", "--no-video", "--no-terminal", "--input-ipc-server=" + SOCK,
                                    "--cache=yes", "--demuxer-max-bytes=20MiB", "--volume=%d" % rep["vol"]],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(40):
        if os.path.exists(SOCK):
            break
        time.sleep(0.1)
    s = socket.socket(socket.AF_UNIX)
    s.connect(SOCK)
    _int["sock"] = s
    threading.Thread(target=_leer_mpv, args=(s,), daemon=True, name="mpv").start()
    _cmd("observe_property", 1, "time-pos")
    _cmd("observe_property", 2, "duration")
    _cmd("observe_property", 3, "pause")
    return True


def _cmd(*args):
    s = _int["sock"]
    if not s:
        return
    try:
        with _int["lock"]:
            s.sendall((json.dumps({"command": list(args)}) + "\n").encode())
    except Exception:
        _int["sock"] = None


def _leer_mpv(s):
    buf = b""
    try:
        while True:
            b = s.recv(4096)
            if not b:
                break
            buf += b
            while b"\n" in buf:
                linea, buf = buf.split(b"\n", 1)
                try:
                    m = json.loads(linea)
                except Exception:
                    continue
                ev = m.get("event")
                if ev == "property-change":
                    n, v = m.get("name"), m.get("data")
                    if n == "time-pos" and v is not None:
                        rep["pos"] = float(v)
                    elif n == "duration" and v is not None:
                        rep["dur"] = float(v)
                    elif n == "pause":
                        rep["pausa"] = bool(v)
                elif ev == "file-loaded":
                    rep.update(cargando=False, error="")
                elif ev == "end-file" and m.get("reason") == "eof":
                    threading.Thread(target=siguiente, kwargs={"fin": True}, daemon=True).start()
                elif ev == "end-file" and m.get("reason") == "error":
                    rep.update(cargando=False, error="No se pudo reproducir")
                    threading.Thread(target=siguiente, daemon=True).start()
    except Exception:
        pass
    _int["sock"] = None


def _tocar_idx(i):
    if not (0 <= i < len(rep["cola"])):
        return {"ok": False}
    rep.update(idx=i, cargando=True, pos=0.0, dur=0.0, error="")
    rep["n"] += 1
    n = rep["n"]
    t = rep["cola"][i]

    def hilo():
        try:
            url = _url(t["id"])
            if n != rep["n"]:
                return                                    # ya has elegido otra
            if not _mpv():
                return
            _cmd("loadfile", url, "replace")
            _cmd("set_property", "pause", False)
            # Prepara la siguiente para que empiece sin espera
            if i + 1 < len(rep["cola"]):
                try: _url(rep["cola"][i + 1]["id"])
                except Exception: pass
        except Exception as e:
            rep.update(cargando=False, error=str(e)[:160])
            LOG.aviso("YT Music: %s", e, origen="ytm")
    threading.Thread(target=hilo, daemon=True).start()
    return {"ok": True}


def tocar(cola, i, radio_auto=True):
    rep["cola"] = [c for c in cola if c.get("id")][:500]
    r = _tocar_idx(int(i))
    if radio_auto and len(rep["cola"]) <= 1 and rep["cola"]:
        threading.Thread(target=_rellenar, args=(rep["cola"][0]["id"],), daemon=True).start()
    return r


def _rellenar(vid):
    try:
        mas = radio(vid)
        ya = {c["id"] for c in rep["cola"]}
        rep["cola"] += [m for m in mas if m["id"] not in ya]
    except Exception as e:
        LOG.aviso("YT Music radio: %s", e, origen="ytm")


def siguiente(fin=False):
    if fin and rep["repetir"] == "una":
        return _tocar_idx(rep["idx"])
    i = rep["idx"] + 1
    if i >= len(rep["cola"]):
        if rep["repetir"] == "todo" and rep["cola"]:
            i = 0
        elif rep["cola"]:
            _rellenar(rep["cola"][rep["idx"]]["id"])        # como YT Music: sigue la radio
            if i >= len(rep["cola"]):
                return {"ok": False}
    return _tocar_idx(i)


def anterior():
    if rep["pos"] > 4:
        _cmd("seek", 0, "absolute")
        return {"ok": True}
    return _tocar_idx(max(0, rep["idx"] - 1))


def parar():
    _cmd("stop")
    rep.update(idx=-1, cola=[], pausa=True, pos=0.0, dur=0.0)


def duck(on):
    """Baja la música mientras habla el navegador o se lee un mensaje."""
    rep["duck"] = on
    _cmd("set_property", "volume", int(rep["vol"] * (0.3 if on else 1)))


def estado_rep():
    i = rep["idx"]
    act = rep["cola"][i] if 0 <= i < len(rep["cola"]) else None
    return {"actual": act, "idx": i, "cola_n": len(rep["cola"]), "pausa": rep["pausa"], "pos": rep["pos"], "dur": rep["dur"],
            "cargando": rep["cargando"], "error": rep["error"], "repetir": rep["repetir"], "vol": rep["vol"]}


# ===================== API para la pantalla =====================
def _seguro(fn, *a):
    try:
        if not _yt():
            return {"ok": False, "error": "sincuenta"}
        return {"ok": True, "d": fn(*a)}
    except Exception as e:
        LOG.aviso("YT Music: %s", e, origen="ytm")
        t = str(e)
        return {"ok": False, "error": "La sesión ha caducado: vuelve a iniciar sesión" if "401" in t or "403" in t or "Sign in" in t else t[:160]}


def g_ytm(q):
    a = (q.get("a") or [""])[0]
    if a == "inicio":
        return _seguro(inicio)
    if a == "biblioteca":
        return _seguro(biblioteca)
    if a == "explorar":
        return _seguro(explorar)
    if a == "lista":
        return _seguro(lista, (q.get("id") or [""])[0])
    if a == "animo":
        return _seguro(animo, (q.get("id") or [""])[0])
    if a == "buscar":
        return _seguro(buscar, (q.get("q") or [""])[0][:120])
    if a == "cola":
        i = rep["idx"]
        return {"ok": True, "d": rep["cola"][max(0, i):i + 40], "idx": i}
    return {**estado, "rep": estado_rep(), "herramientas": {"mpv": bool(shutil.which("mpv")), "yt_dlp": bool(_ytdlp()),
            "ytmusicapi": _hay_ytmusicapi()}}


def _hay_ytmusicapi():
    try:
        import ytmusicapi  # noqa
        return True
    except Exception:
        return False


def p_ytm(d):
    a = d.get("accion")
    if a == "login":
        return iniciar_sesion()
    if a == "salir":
        return cerrar_sesion()
    if a == "tocar":
        return tocar(d.get("cola") or [], int(d.get("i", 0)))
    if a == "radio":                     # empieza la radio de una canción
        try:
            c = d.get("cancion") or {}
            return tocar([c] + [x for x in radio(c["id"]) if x["id"] != c["id"]], 0, radio_auto=False)
        except Exception as e:
            return {"ok": False, "error": str(e)[:150]}
    if a == "pausa":
        _cmd("cycle", "pause")
        return {"ok": True}
    if a == "seguir":
        _cmd("set_property", "pause", False)
        return {"ok": True}
    if a == "parar_pausa":
        _cmd("set_property", "pause", True)
        return {"ok": True}
    if a == "siguiente":
        return siguiente()
    if a == "anterior":
        return anterior()
    if a == "ir":
        return _tocar_idx(int(d.get("i", 0)))
    if a == "seek":
        _cmd("seek", float(d.get("t", 0)), "absolute")
        return {"ok": True}
    if a == "repetir":
        rep["repetir"] = d.get("v") if d.get("v") in ("no", "todo", "una") else "no"
        return {"ok": True}
    if a == "volumen":
        rep["vol"] = max(0, min(130, int(d.get("v", 100))))
        _cmd("set_property", "volume", rep["vol"])
        return {"ok": True}
    if a == "me_gusta":
        try:
            _yt().rate_song(d.get("id"), "LIKE" if d.get("on") else "INDIFFERENT")
            _int["cache"].pop("l-LM", None)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)[:150]}
    if a == "parar":
        parar()
        return {"ok": True}
    return {"ok": False, "error": "Acción desconocida"}


def _actualizar_herramientas():
    """yt-dlp y ytmusicapi se quedan viejos rápido: se actualizan cada 3 días."""
    marca = os.path.join(CARPETA, "datos", "ytm-actualizado")
    try:
        if time.time() - os.path.getmtime(marca) < 3 * 86400:
            return
    except Exception:
        pass
    time.sleep(120)
    r = subprocess.run([sys_python(), "-m", "pip", "install", "--user", "--break-system-packages", "-U", "-q", "yt-dlp[default]", "ytmusicapi"],
                       capture_output=True, text=True, timeout=600)
    LOG.info("YT Music: herramientas actualizadas (%s)", "ok" if r.returncode == 0 else (r.stderr or "")[-120:], origen="ytm")
    if r.returncode == 0:
        open(marca, "w").close()


def sys_python():
    import sys
    return sys.executable or "python3"


def arrancar(sis, obd=None):
    _int["sis"] = sis
    threading.Thread(target=_cargar_cuenta, daemon=True).start()
    if sis.ES_PI and os.path.exists(AUTH):          # solo cuando ya usas tu cuenta
        threading.Thread(target=_actualizar_herramientas, daemon=True, name="ytm-actualizar").start()


GET = {"/api/ytm": g_ytm}
POST = {"/api/ytm": p_ytm}
