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
(()=>{ const enviar=(t,o,org)=>{ try{ window.__rpAviso(JSON.stringify({title:String(t||''),body:String(o&&o.body||''),tag:String(o&&o.tag||''),origen:org||'aviso'})); }catch(e){} };
  function N(t,o){ enviar(t,o); this.title=t; this.body=o&&o.body; this.close=()=>{}; this.addEventListener=()=>{}; this.removeEventListener=()=>{}; }
  N.permission='granted'; N.requestPermission=cb=>{ if(cb) cb('granted'); return Promise.resolve('granted'); };
  try{ Object.defineProperty(window,'Notification',{value:N,writable:true,configurable:true}); }catch(e){}
  try{ if(window.ServiceWorkerRegistration) ServiceWorkerRegistration.prototype.showNotification=function(t,o){ enviar(t,o); return Promise.resolve(); }; }catch(e){}
  try{ const q=navigator.permissions.query.bind(navigator.permissions);
       navigator.permissions.query=p=>p&&p.name==='notifications'?Promise.resolve({state:'granted',onchange:null}):q(p); }catch(e){}
  /* Sin nadie mirando, WhatsApp «en segundo plano» (así avisa). Cuando lo abres en Radar Play, visible */
  window.__rpVisible=false;
  try{ Object.defineProperty(document,'hidden',{get:()=>!window.__rpVisible}); Object.defineProperty(document,'visibilityState',{get:()=>window.__rpVisible?'visible':'hidden'});
       document.hasFocus=()=>!!window.__rpVisible; }catch(e){}
  /* Más rápido que los avisos: mira la lista de chats y avisa cuando un chat con mensajes sin leer cambia */
  const visto=new Map(); let listo=false, t=null;
  function revisar(){
    const lista=document.querySelector('#pane-side'); if(!lista) return;
    lista.querySelectorAll('[role="listitem"], [role="row"]').forEach(f=>{
      const tit=[...f.querySelectorAll('span[title]')].map(x=>x.getAttribute('title')).filter(Boolean);
      if(!tit.length) return; const nombre=tit[0], prev=tit.length>1?tit[tit.length-1]:'';
      const sinLeer=!!f.querySelector('[aria-label*="no leído"],[aria-label*="no leídos"],[aria-label*="unread"],[aria-label*="sin leer"]');
      const k=nombre+'|'+prev;
      if(listo&&sinLeer&&prev&&visto.get(nombre)!==k) enviar(nombre,{body:prev},'lista');
      visto.set(nombre,k);
    });
    listo=true;
  }
  /* Foto de la lista de chats y del chat abierto, para pintarlos en Radar Play */
  const HORA=/^(\d{1,2}:\d{2}|ayer|hoy|lunes|martes|miércoles|jueves|viernes|sábado|domingo|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
  function chats(){
    const p=document.querySelector('#pane-side'); if(!p) return null;
    return [...p.querySelectorAll('[role="listitem"], [role="row"]')].map(f=>{
      const tit=[...f.querySelectorAll('span[title]')].map(x=>x.getAttribute('title')).filter(Boolean); if(!tit.length) return null;
      const ul=f.querySelector('[aria-label*="no leído"],[aria-label*="unread"],[aria-label*="sin leer"]');
      const img=f.querySelector('img'); let hora='';
      f.querySelectorAll('div,span').forEach(x=>{ if(!hora&&!x.children.length){ const v=(x.textContent||'').trim(); if(HORA.test(v)) hora=v; } });
      return {nombre:tit[0], prev:tit.length>1?tit[tit.length-1]:'', nl:ul?(parseInt(ul.textContent)||1):0, hora,
        foto:img&&/^https:/.test(img.src)?img.src:'', silencio:!!f.querySelector('[data-icon*="muted"]')};
    }).filter(Boolean);
  }
  function chatAbierto(){
    const m=document.querySelector('#main'); if(!m) return null;
    const cab=m.querySelector('header span[title], header span[dir="auto"]');
    const nombre=cab?(cab.getAttribute('title')||cab.textContent||'').trim():'';
    const fimg=m.querySelector('header img'); let jid='', grupo=false;
    const filas=[...m.querySelectorAll('[data-id]')].filter(x=>/^(true|false)_/.test(x.getAttribute('data-id')||''));
    const msgs=filas.slice(-80).map(x=>{ const id=x.getAttribute('data-id'), pz=id.split('_'); if(!jid){ jid=pz[1]||''; grupo=/@g\.us$/.test(jid); }
      const cp=x.querySelector('[data-pre-plain-text]'), pre=cp?cp.getAttribute('data-pre-plain-text'):'';
      const mm=pre.match(/^\[([^\]]+)\]\s*(.*?):\s*$/);
      const te=x.querySelector('.selectable-text, span.copyable-text'); let texto=te?te.innerText.trim():'', tipo='texto';
      if(!texto){ if(x.querySelector('img[src^="blob:"]')){ tipo='foto'; texto='📷 Foto'; } else if(x.querySelector('audio,[data-icon*="audio"],[data-icon*="ptt"]')){ tipo='audio'; texto='🎤 Audio'; }
        else if(x.querySelector('video,[data-icon*="video"]')){ tipo='video'; texto='🎬 Vídeo'; } else if(x.querySelector('[data-icon*="sticker"], img[src*="sticker"]')){ tipo='sticker'; texto='Sticker'; }
        else { texto=(x.innerText||'').split('\n').filter(l=>l.trim()&&!/^\d{1,2}:\d{2}$/.test(l.trim())).join(' ').slice(0,300); } }
      const part=pz.length>3?pz[pz.length-1]:'';
      return {id, yo:id.startsWith('true_'), autor:mm?mm[2]:'', hora:mm?mm[1].split(',')[0].trim():'', texto, tipo, de:/@c\.us$/.test(part)?part.split('@')[0]:''};
    });
    return {nombre, foto:fimg&&/^https:/.test(fimg.src)?fimg.src:'', numero:/@c\.us$/.test(jid)?jid.split('@')[0]:'', grupo, msgs};
  }
  let ultC='', ultM='';
  function mandar(){
    try{ const c=chats(); if(c){ const j=JSON.stringify(c); if(j!==ultC){ ultC=j; window.__rpChats(j); } }
         const m=chatAbierto(); const jm=JSON.stringify(m); if(jm!==ultM){ ultM=jm; window.__rpChat(jm); } }catch(e){}
  }
  let t2=null;
  new MutationObserver(()=>{ clearTimeout(t); t=setTimeout(revisar,250); clearTimeout(t2); t2=setTimeout(mandar,300); }).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','src']});
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
_vistos = {}


def _aviso(payload):
    import ancs                                            # misma lista de avisos que lee la pantalla
    try:
        d = json.loads(payload)
    except Exception:
        return
    titulo, texto = (d.get("title") or "WhatsApp").strip(), (d.get("body") or "").strip()
    if not texto and titulo == "WhatsApp":
        return
    # El mismo mensaje puede llegar por la lista de chats y por el aviso: solo una vez
    clave, ahora = (titulo, texto[-60:]), time.time()
    for k, t in list(_vistos.items()):
        if ahora - t > 90:
            _vistos.pop(k, None)
    if clave in _vistos or any(k[0] == titulo and (k[1].endswith(texto[-30:]) or texto.endswith(k[1][-30:])) for k in _vistos if ahora - _vistos[k] < 20):
        return
    _vistos[clave] = ahora
    ancs._evento(tipo="nuevo", id="w%d%04d" % (time.time() * 1000, random.randint(0, 9999)), app="whatsapp",
                 titulo=titulo, sub="", texto=texto, t=int(time.time() * 1000), previo=False)
    LOG.info("Aviso de WhatsApp nuevo (WhatsApp Web)", origen="whatsapp")      # sin nombre ni texto


_datos = {"chats": [], "chats_t": 0, "chat": None, "chat_t": 0, "abierto": None}


def _al_evento(metodo, p):
    if metodo == "Runtime.bindingCalled" and p.get("name") == "__rpAviso":
        _aviso(p.get("payload", ""))
    elif metodo == "Runtime.bindingCalled" and p.get("name") == "__rpChats":
        try: _datos.update(chats=json.loads(p.get("payload") or "[]")[:60], chats_t=time.time())
        except Exception: pass
    elif metodo == "Runtime.bindingCalled" and p.get("name") == "__rpChat":
        try: _datos.update(chat=json.loads(p.get("payload") or "null"), chat_t=time.time())
        except Exception: pass
    elif metodo == "Page.screencastFrame":
        with _foto["cond"]:
            _foto.update(jpg=base64.b64decode(p["data"]), n=_foto["n"] + 1)
            _foto["cond"].notify_all()
        cdp = _int["ws"]
        if cdp:
            threading.Thread(target=lambda: _seguro(cdp, "Page.screencastFrameAck", sessionId=p["sessionId"]), daemon=True).start()


def _seguro(cdp, metodo, **kv):
    try:
        return cdp(metodo, timeout=5, **kv)
    except Exception:
        return None


# ---------------- WhatsApp Web en directo dentro de Radar Play ----------------
_foto = {"jpg": None, "n": 0, "cond": threading.Condition(), "mirando": 0, "tam": None}


def _empezar_video(w, h):
    cdp = _int["ws"]
    if not cdp:
        return
    w, h = max(600, min(w, 1920)), max(400, min(h, 1200))
    if _foto["tam"] != (w, h):
        _seguro(cdp, "Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=1, mobile=False)
        _foto["tam"] = (w, h)
    _seguro(cdp, "Runtime.evaluate", expression="window.__rpVisible=true; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus'))")
    _seguro(cdp, "Page.startScreencast", format="jpeg", quality=70, maxWidth=w, maxHeight=h, everyNthFrame=1)
    r = _seguro(cdp, "Page.captureScreenshot", format="jpeg", quality=70)
    if r:
        with _foto["cond"]:
            _foto.update(jpg=base64.b64decode(r["data"]), n=_foto["n"] + 1)
            _foto["cond"].notify_all()


def _parar_video():
    cdp = _int["ws"]
    if cdp:
        _seguro(cdp, "Page.stopScreencast")
        _seguro(cdp, "Runtime.evaluate", expression="window.__rpVisible=false; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur'))")


def emitir(h, w, alto):
    """Manda WhatsApp Web como vídeo MJPEG mientras la pantalla lo esté mirando."""
    if estado["estado"] not in ("conectado", "qr", "cargando") or not _int["ws"]:
        return h.responder({"ok": False, "error": "WhatsApp Web no está abierto"}, 503)
    _foto["mirando"] += 1
    _empezar_video(w, alto)
    try:
        h.send_response(200)
        h.send_header("Content-Type", "multipart/x-mixed-replace; boundary=rpframe")
        h.send_header("Cache-Control", "no-store")
        h.end_headers()
        ult = -1
        while estado["estado"] in ("conectado", "qr", "cargando"):
            with _foto["cond"]:
                _foto["cond"].wait_for(lambda: _foto["n"] != ult, timeout=10)
                jpg, ult = _foto["jpg"], _foto["n"]
            if not jpg:
                continue
            h.wfile.write(b"--rpframe\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(jpg) + jpg + b"\r\n")
            h.wfile.flush()
    except Exception:
        pass
    finally:
        _foto["mirando"] -= 1
        if _foto["mirando"] <= 0:
            _foto["mirando"] = 0
            _parar_video()


TECLAS = {"Enter": (13, "\r"), "Backspace": (8, ""), "Escape": (27, ""), "Tab": (9, ""), "ArrowUp": (38, ""), "ArrowDown": (40, ""),
          "ArrowLeft": (37, ""), "ArrowRight": (39, ""), "Delete": (46, "")}


def entrada(d):
    """Toques, rueda y teclado que llegan de la pantalla de Radar Play."""
    cdp = _int["ws"]
    if not cdp:
        return {"ok": False}
    t = d.get("t")
    x, y = float(d.get("x", 0)), float(d.get("y", 0))
    if t == "toque":
        for tipo in ("mouseMoved", "mousePressed", "mouseReleased"):
            _seguro(cdp, "Input.dispatchMouseEvent", type=tipo, x=x, y=y, button="left" if tipo != "mouseMoved" else "none", clickCount=1)
    elif t == "rueda":
        _seguro(cdp, "Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=0, deltaY=float(d.get("dy", 0)))
    elif t == "texto":
        _seguro(cdp, "Input.insertText", text=str(d.get("v", ""))[:2000])
    elif t == "enviar":                    # escribe en el chat abierto y pulsa Intro
        r = _seguro(cdp, "Runtime.evaluate", returnByValue=True, expression=
                    "(()=>{const c=document.querySelector('footer [contenteditable=\"true\"]'); if(!c) return false; c.focus(); return true;})()")
        if not (r and r.get("result", {}).get("value")):
            return {"ok": False, "error": "Abre primero un chat"}
        _seguro(cdp, "Input.insertText", text=str(d.get("v", ""))[:2000])
        time.sleep(0.15)
        base = {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "nativeVirtualKeyCode": 13}
        _seguro(cdp, "Input.dispatchKeyEvent", type="rawKeyDown", **base)
        _seguro(cdp, "Input.dispatchKeyEvent", type="char", text="\r", **base)
        _seguro(cdp, "Input.dispatchKeyEvent", type="keyUp", **base)
        LOG.info("WhatsApp: mensaje enviado desde Radar Play", origen="whatsapp")
    elif t == "tecla":
        k = str(d.get("k", ""))
        code, txt = TECLAS.get(k, (0, ""))
        if code:
            base = {"key": k, "code": k, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code}
            _seguro(cdp, "Input.dispatchKeyEvent", type="rawKeyDown", **base)
            if txt:
                _seguro(cdp, "Input.dispatchKeyEvent", type="char", text=txt, **base)
            _seguro(cdp, "Input.dispatchKeyEvent", type="keyUp", **base)
    return {"ok": True}


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
         "--disable-features=Translate", "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
         "--disable-backgrounding-occluded-windows", "about:blank"],
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
    _foto["tam"] = None
    cdp("Page.enable")
    cdp("Runtime.enable")
    cdp("Runtime.addBinding", name="__rpAviso")
    cdp("Runtime.addBinding", name="__rpChats")
    cdp("Runtime.addBinding", name="__rpChat")
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


def _evaluar(cdp, js):
    r = _seguro(cdp, "Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
    return (r or {}).get("result", {}).get("value")


def _clic(cdp, x, y):
    for tipo in ("mouseMoved", "mousePressed", "mouseReleased"):
        _seguro(cdp, "Input.dispatchMouseEvent", type=tipo, x=x, y=y, button="left" if tipo != "mouseMoved" else "none", clickCount=1)


def abrir_chat(nombre):
    """Abre ese chat en WhatsApp Web (si no se ve en la lista, lo busca)."""
    cdp = _int["ws"]
    if not cdp or estado["estado"] != "conectado":
        return {"ok": False, "error": "WhatsApp no está conectado"}
    n = json.dumps(nombre)
    buscar = """(()=>{ const f=[...document.querySelectorAll('#pane-side [role="listitem"], #pane-side [role="row"]')]
        .find(r=>{ const s=r.querySelector('span[title]'); return s&&s.getAttribute('title')===%s; });
      if(!f) return null; f.scrollIntoView({block:'center'}); const b=f.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()""" % n
    pos = _evaluar(cdp, buscar)
    if not pos:                                  # no está a la vista: usa el buscador de WhatsApp
        caja = _evaluar(cdp, """(()=>{ const c=document.querySelector('#side [contenteditable="true"], [aria-label*="Buscar"][contenteditable="true"], [aria-label*="Search"][contenteditable="true"]');
          if(!c) return null; c.focus(); document.execCommand('selectAll'); document.execCommand('delete'); return true; })()""")
        if caja:
            _seguro(cdp, "Input.insertText", text=nombre)
            for _ in range(10):
                time.sleep(0.3)
                pos = _evaluar(cdp, buscar)
                if pos:
                    break
    if not pos:
        return {"ok": False, "error": "No encuentro ese chat"}
    _clic(cdp, pos["x"], pos["y"])
    _evaluar(cdp, "window.__rpVisible=true; document.dispatchEvent(new Event('visibilitychange'))")   # lo estás leyendo: se marca leído
    _datos["abierto"] = nombre
    for _ in range(15):
        time.sleep(0.2)
        c = _datos.get("chat")
        if c and c.get("nombre") == nombre:
            break
    return {"ok": True}


def cerrar_chat():
    cdp = _int["ws"]
    _datos["abierto"] = None
    if cdp:
        _evaluar(cdp, "window.__rpVisible=false; document.dispatchEvent(new Event('visibilitychange'))")
        for tipo in ("rawKeyDown", "keyUp"):
            _seguro(cdp, "Input.dispatchKeyEvent", type=tipo, key="Escape", code="Escape", windowsVirtualKeyCode=27, nativeVirtualKeyCode=27)
    return {"ok": True}


def g_chats(q):
    return {"estado": estado["estado"], "chats": _datos["chats"], "t": _datos["chats_t"]}


def g_chat(q):
    c = _datos.get("chat")
    if not c or c.get("nombre") != _datos.get("abierto"):
        return {"chat": None, "abierto": _datos.get("abierto")}
    return {"chat": c, "abierto": _datos.get("abierto"), "t": _datos["chat_t"]}


def p_wa(d):
    a = d.get("accion")
    if a == "entrada":
        return entrada(d)
    if a == "abrir":
        return abrir_chat(str(d.get("nombre") or ""))
    if a == "cerrar_chat":
        return cerrar_chat()
    if a == "responder":                 # respuesta rápida sin abrir nada en la pantalla
        nombre, texto = str(d.get("nombre") or ""), str(d.get("texto") or "").strip()
        if not texto:
            return {"ok": False, "error": "Respuesta vacía"}
        seguia = _datos.get("abierto")
        r = abrir_chat(nombre)
        if not r.get("ok"):
            return r
        r = entrada({"t": "enviar", "v": texto})
        if seguia != nombre:
            cerrar_chat()                 # vuelve a dejarlo cerrado para que sigan llegando los avisos
        return r
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


GET = {"/api/whatsapp": g_wa, "/api/whatsapp/chats": g_chats, "/api/whatsapp/chat": g_chat}
POST = {"/api/whatsapp": p_wa}
