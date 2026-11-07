"""
Radar Play · Abrir webs completas en su propia ventana (YouTube con tu cuenta)
En la Raspberry abre YouTube en una ventana de Chromium encima de Radar Play,
con su botón de cerrar. Se cierra sola si el coche se mueve (más de 10 km/h).
En el PC solo abre la web en el navegador.
"""
import glob, os, subprocess, threading, time, webbrowser
import registro as LOG

WEBS = {"youtube": "https://m.youtube.com/", "youtube-music": "https://music.youtube.com/"}
PERFIL = os.path.expanduser("~/.config/radar-play-web")
_estado = {"proc": None, "web": None, "desde": 0}
_ctx = {"sis": None, "vel": lambda: 0}


def _entorno():
    env = dict(os.environ)
    run = env.get("XDG_RUNTIME_DIR") or "/run/user/%d" % os.getuid()
    env["XDG_RUNTIME_DIR"] = run
    if not env.get("WAYLAND_DISPLAY"):
        socks = sorted(x for x in glob.glob(os.path.join(run, "wayland-*")) if not x.endswith(".lock"))
        if socks:
            env["WAYLAND_DISPLAY"] = os.path.basename(socks[0])
    env.setdefault("DISPLAY", ":0")
    return env


def abierta():
    p = _estado["proc"]
    return bool(p and p.poll() is None)


def abrir(web):
    url = WEBS.get(web)
    if not url:
        return {"ok": False, "error": "Web desconocida"}
    sis = _ctx["sis"]
    if not (sis and sis.ES_PI):
        webbrowser.open(url)
        return {"ok": True, "msg": "Abierto en el navegador"}
    if (_ctx["vel"]() or 0) > 10:
        return {"ok": False, "error": "Para abrir YouTube completo, para el coche"}
    cerrar()
    nav = next((c for c in ("chromium", "chromium-browser") if subprocess.call(["which", c], stdout=subprocess.DEVNULL) == 0), None)
    if not nav:
        return {"ok": False, "error": "No encuentro Chromium"}
    try:
        _estado["proc"] = subprocess.Popen(
            [nav, "--user-data-dir=" + PERFIL, "--app=" + url, "--start-maximized", "--lang=es-ES",
             "--password-store=basic", "--no-first-run", "--noerrdialogs", "--autoplay-policy=no-user-gesture-required",
             "--ozone-platform-hint=auto", "--class=radar-play-web"],
            env=_entorno(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        _estado.update(web=web, desde=time.time())
        LOG.info("Abre %s completo en otra ventana", web, origen="apps")
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)[:150]}


def cerrar(motivo="pantalla"):
    p = _estado["proc"]
    if p and p.poll() is None:
        try:
            os.killpg(p.pid, 15)
        except Exception:
            try: p.terminate()
            except Exception: pass
        LOG.info("Cierra %s (%s)", _estado["web"], motivo, origen="apps")
    subprocess.call(["pkill", "-f", PERFIL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _estado.update(proc=None, web=None)
    return {"ok": True}


def _vigilar():
    while True:
        try:
            if abierta() and (_ctx["vel"]() or 0) > 10:
                cerrar("el coche se mueve")
        except Exception:
            pass
        time.sleep(2)


def arrancar(sis, obd=None):
    _ctx["sis"] = sis
    try:
        import coche
        _ctx["vel"] = lambda: coche._instante(sis, obd())[1] if obd else 0
    except Exception:
        pass
    threading.Thread(target=_vigilar, daemon=True, name="apps").start()


def g_apps(q):
    return {"abierta": _estado["web"] if abierta() else None}


def p_apps(d):
    if d.get("accion") == "cerrar":
        return cerrar()
    return abrir(d.get("web") or "youtube")


GET = {"/api/apps": g_apps}
POST = {"/api/apps": p_apps}
