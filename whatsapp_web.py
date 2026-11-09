"""
Radar Play · WhatsApp Web en la Raspberry (en segundo plano)
Abre web.whatsapp.com en un Chromium escondido (sin ventana). La primera vez
enseña el código QR en la pantalla del coche: lo escaneas con el iPhone en
WhatsApp › Ajustes › Dispositivos vinculados › Vincular un dispositivo.
Desde entonces, cada aviso de WhatsApp (persona o grupo y texto) pasa a la
app WhatsApp de Radar Play. Solo se ven (contestar vendrá más adelante).
Necesita internet en el coche (por ejemplo, compartir datos del iPhone).
Se controla con Chromium por su puerto de depuración (CDP), sin programas extra.
"""
import base64, glob, json, os, random, shutil, socket, struct, subprocess, threading, time, urllib.request
import registro as LOG

PERFIL = os.path.expanduser("~/.config/radar-play-whatsapp")
PUERTO = 9223
URL = "https://web.whatsapp.com/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
estado = {"estado": "apagado", "msg": "", "no_leidos": 0, "desde": 0}
_int = {"proc": None, "ws": None, "qr": None, "qr_t": 0, "parar": False, "sis": None}

# Se ejecuta en WhatsApp Web antes que su código: sus avisos (Notification) pasan a Radar Play
INICIO = r"""
(()=>{ const enviar=(t,o)=>{ try{ window.__rpAviso(JSON.stringify({title:String(t||''),body:String(o&&o.body||''),tag:String(o&&o.tag||'')})); }catch(e){} };
  function N(t,o){ enviar(t,o); this.title=t; this.body=o&&o.body; this.close=()=>{}; this.addEventListener=()=>{}; this.removeEventListener=()=>{}; }
  N.permission='granted'; N.requestPermission=cb=>{ if(cb) cb('granted'); return Promise.resolve('granted'); };
  try{ Object.defineProperty(window,'Notification',{value:N,writable:true,configurable:true}); }catch(e){}
  try{ if(window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification=function(t,o){ enviar(t,o); return Promise.resolve(); }; }catch(e){}
  try{ const q=navigator.permissions.query.bind(navigator.permissions);
       navigator.permissions.query=p=>p&&p.name==='notifications'?Promise.resolve({state:'granted',onchange:null}):q(p); }catch(e){}
  /* Siempre «en segundo plano», que es cuando WhatsApp avisa */
  try{ Object.defineProperty(document,'hidden',{get:()=>true}); Object.defineProperty(document,'visibilityState',{get:()=>'hidden'}); document.hasFocus=()=>false; }catch(e){}
})();
"""

ESTADO_JS = r"""
(()=>{ const qr=document.querySelector('canvas[aria-label], div[data-ref] canvas, canvas');
  const dentro=!!document.querySelector('#pane-side, [data-testid="chat-list"], div[aria-label="Lista de chats"], div[aria-label="Chat list"]');
  const m=(document.title||'').match(/\((\d+)\)/);
  let r=null; if(qr&&!dentro){ const b=qr.getBoundingClientRect(); r={x:b.x,y:b.y,w:b.width,h:b.height}; }
  const txt=(document.body&&document.body.innerText||'').slice(0,400);
  return JSON.stringify({dentro, qr:r, unread:m?+m[1]:0, txt});
})()
"""


# ---------------- WebSocket mínimo (para hablar con Chromium) ----------------
class WS:
    def __init__(self, url):
        assert url.startswith("ws://")
        hostport, ruta = url[5:].split("/", 1)
        host, port = hostport.split(":")
        self.s = socket.create_connection((host, int(port)), timeout=20)
        clave = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall(("GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n" % (ruta, hostport, clave)).encode())
        cab = b""
        while b"\r\n\r\n" not in cab:
            b = self.s.recv(1)
            if not b:
                raise IOError("Chromium cerró la conexión")
            cab += b
        if b" 101 " not in cab.split(b"\r\n")[0]:
            raise IOError("Chromium no acepta la conexión")
        self.s.settimeout(None)
        self.lock = threading.Lock()

    def enviar(self, texto):
        datos = texto.encode()
        n = len(datos)
        cab = bytes([0x81])
        if n < 126:
            cab += bytes([0x80 | n])
        elif n < 65536:
            cab += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            cab += bytes([0x80 | 127]) + struct.pack(">Q", n)
        m = os.urandom(4)
        with self.lock:
            self.s.sendall(cab + m + bytes(b ^ m[i % 4] for i, b in enumerate(datos)))

    def _leer(self, n):
        out = b""
        while len(out) < n:
            b = self.s.recv(n - len(out))
            if not b:
                raise IOError("Conexión cerrada")
            out += b
        return out

    def recibir(self):
        msg = b""
        while True:
            a, b = self._leer(2)
            op, n = a & 0x0F, b & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._leer(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._leer(8))[0]
            datos = self._leer(n)
            if op == 8:
                raise IOError("Chromium cerró")
            if op == 9:                                   # ping → pong
                continue
            msg += datos
            if a & 0x80:
                return msg.decode("utf-8", "replace")

    def cerrar(self):
        try: self.s.close()
        except Exception: pass


class CDP:
    def __init__(self, ws_url, al_evento):
        self.ws = WS(ws_url)
        self.id, self.esperas, self.al_evento = 0, {}, al_evento
        threading.Thread(target=self._bucle, daemon=True, name="whatsapp-cdp").start()

    def _bucle(self):
        try:
            while True:
                m = json.loads(self.ws.recibir())
                if "id" in m and m["id"] in self.esperas:
                    ev, caja = self.esperas.pop(m["id"])
                    caja.append(m)
                    ev.set()
                elif "method" in m:
                    try: self.al_evento(m["method"], m.get("params", {}))
                    except Exception as e: LOG.aviso("WhatsApp: %s", e, origen="whatsapp")
        except Exception:
            self.vivo = False
            for ev, caja in list(self.esperas.values()):
                ev.set()

    vivo = True

    def __call__(self, metodo, timeout=20, **params):
        self.id += 1
        ev, caja = threading.Event(), []
        self.esperas[self.id] = (ev, caja)
        self.ws.enviar(json.dumps({"id": self.id, "method": metodo, "params": params}))
        if not ev.wait(timeout) or not caja:
            raise IOError("Chromium no responde (%s)" % metodo)
        if "error" in caja[0]:
            raise IOError(caja[0]["error"].get("message", "error"))
        return caja[0].get("result", {})


# ---------------- Avisos ----------------
def _aviso(payload):
    import ancs                                            # misma lista de avisos que lee la pantalla
    try:
        d = json.loads(payload)
    except Exception:
        return
    titulo, texto = (d.get("title") or "WhatsApp").strip(), (d.get("body") or "").strip()
    if not texto and titulo == "WhatsApp":
        return
    ancs._evento(tipo="nuevo", id="w%d%04d" % (time.time() * 1000, random.randint(0, 9999)), app="whatsapp",
                 titulo=titulo, sub="", texto=texto, t=int(time.time() * 1000), previo=False)
    LOG.info("Aviso de WhatsApp nuevo (WhatsApp Web)", origen="whatsapp")      # sin nombre ni texto


def _al_evento(metodo, p):
    if metodo == "Runtime.bindingCalled" and p.get("name") == "__rpAviso":
        _aviso(p.get("payload", ""))


def _navegador():
    for c in ("chromium", "chromium-browser", "google-chrome"):
        if shutil.which(c):
            return shutil.which(c)
    return None


def _arrancar_chromium():
    nav = _navegador()
    if not nav:
        raise RuntimeError("No encuentro Chromium")
    subprocess.call(["pkill", "-f", PERFIL], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    os.makedirs(PERFIL, exist_ok=True)
    for f in glob.glob(os.path.join(PERFIL, "Singleton*")):
        try: os.remove(f)
        except Exception: pass
    _int["proc"] = subprocess.Popen(
        [nav, "--headless=new", "--remote-debugging-port=%d" % PUERTO, "--remote-allow-origins=*",
         "--user-data-dir=" + PERFIL, "--user-agent=" + UA, "--window-size=1100,850", "--lang=es-ES",
         "--no-first-run", "--no-default-browser-check", "--mute-audio", "--password-store=basic",
         "--disable-features=Translate", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(40):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/json" % PUERTO, timeout=2) as r:
                pags = [x for x in json.loads(r.read()) if x.get("type") == "page"]
            if pags:
                return pags[0]["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Chromium no arranca")


def _sesion():
    estado.update(estado="arrancando", msg="Abriendo WhatsApp Web…")
    url = _arrancar_chromium()
    cdp = CDP(url, _al_evento)
    _int["ws"] = cdp
    cdp("Page.enable")
    cdp("Runtime.enable")
    cdp("Runtime.addBinding", name="__rpAviso")
    cdp("Page.addScriptToEvaluateOnNewDocument", source=INICIO)
    cdp("Emulation.setUserAgentOverride", userAgent=UA, acceptLanguage="es-ES,es")
    cdp("Page.navigate", url=URL)
    LOG.info("WhatsApp Web abierto en segundo plano", origen="whatsapp")
    antes, sin_cambios = None, 0
    while cdp.vivo and not _int["parar"] and _int["proc"].poll() is None:
        time.sleep(3)
        try:
            r = json.loads(cdp("Runtime.evaluate", expression=ESTADO_JS, returnByValue=True)["result"]["value"])
        except Exception as e:
            sin_cambios += 1
            if sin_cambios > 10:
                raise
            continue
        sin_cambios = 0
        if r["dentro"]:
            nuevo = "conectado"
            estado.update(estado=nuevo, msg="WhatsApp conectado", no_leidos=r["unread"])
            _int["qr"] = None
        elif r["qr"] and r["qr"]["w"] > 50:
            nuevo = "qr"
            if time.time() - _int["qr_t"] > 4:
                q = r["qr"]
                pad = 24
                img = cdp("Page.captureScreenshot", format="png",
                          clip={"x": max(0, q["x"] - pad), "y": max(0, q["y"] - pad), "width": q["w"] + 2 * pad, "height": q["h"] + 2 * pad, "scale": 1})
                _int.update(qr="data:image/png;base64," + img["data"], qr_t=time.time())
            estado.update(estado=nuevo, msg="Escanea el código con tu iPhone")
        else:
            nuevo = "cargando"
            t = r.get("txt", "")
            estado.update(estado=nuevo, msg="Cargando WhatsApp…" if not t else ("Cargando WhatsApp… " + t[:80].replace("\n", " ")))
        if nuevo != antes:
            LOG.info("WhatsApp Web: %s", nuevo, origen="whatsapp")
            antes = nuevo


def _hilo():
    espera = 10
    while not _int["parar"]:
        try:
            _sesion()
        except Exception as e:
            estado.update(estado="error", msg="WhatsApp Web: %s" % str(e)[:120])
            LOG.aviso("WhatsApp Web: %s", e, origen="whatsapp")
        cerrar_chromium()
        if _int["parar"]:
            break
        time.sleep(espera)
        espera = min(espera * 2, 300)


def cerrar_chromium():
    p = _int["proc"]
    if p and p.poll() is None:
        try: os.killpg(p.pid, 15)
        except Exception: pass
    _int["proc"] = None
    if _int["ws"]:
        try: _int["ws"].ws.cerrar()
        except Exception: pass
    _int["ws"] = None


def arrancar(sis, obd=None):
    _int["sis"] = sis
    if not int(sis.CONF.get("WHATSAPP_WEB", 1)):
        estado.update(estado="apagado", msg="Desactivado (WHATSAPP_WEB=0)")
        return
    if not sis.ES_PI:
        estado.update(estado="apagado", msg="WhatsApp Web funciona en la Raspberry")
        return
    threading.Thread(target=_hilo, daemon=True, name="whatsapp-web").start()


def g_wa(q):
    return {**estado, "qr": _int["qr"] if estado["estado"] == "qr" else None}


def p_wa(d):
    a = d.get("accion")
    if a == "reiniciar":
        cerrar_chromium()                      # el hilo lo vuelve a abrir
        return {"ok": True}
    if a == "cerrar_sesion":
        cerrar_chromium()
        time.sleep(1)
        shutil.rmtree(PERFIL, ignore_errors=True)
        LOG.info("WhatsApp Web: sesión cerrada en la Raspberry", origen="whatsapp")
        return {"ok": True}
    return {"ok": False, "error": "Acción desconocida"}


GET = {"/api/whatsapp": g_wa}
POST = {"/api/whatsapp": p_wa}
