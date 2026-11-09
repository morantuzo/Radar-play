"""
Radar Play · iPhone por Bluetooth (solo en la Raspberry)
  - Emparejar el iPhone (la Raspberry aparece como «Radar Play», un equipo de coche).
  - Música: el iPhone suena por los altavoces (A2DP) y se ve canción, artista y
    botones (AVRCP, por BlueZ).
  - Llamadas: contestar, colgar y llamar (manos libres HFP, por oFono). Hace falta
    un micrófono USB para hablar.
  - Contactos: se descargan del iPhone (PBAP, por obexd). En el iPhone hay que
    activar «Sincronizar contactos» en Ajustes › Bluetooth › Radar Play › (i).
Paquetes (los pone instalar.sh): bluez, bluez-obexd, ofono, python3-dbus, python3-gi.
En el PC no hace nada: Radar Play sigue con el teléfono simulado.
"""
import json, math, os, re, struct, subprocess, threading, time, wave
import registro as LOG

CARPETA = os.path.dirname(os.path.abspath(__file__))
CONTACTOS_F = os.path.join(CARPETA, "datos", "bt-contactos.json")
estado = {"disponible": False, "msg": "Arrancando…", "adaptador": None, "emparejando_hasta": 0, "codigo": None,
          "dispositivos": [], "telefono": None, "llamadas": [], "musica": None, "contactos_n": 0, "contactos_fecha": None,
          "contactos_msg": None, "microfono_silenciado": False}
contactos = []
_loop = {"ok": False}
_bus = None
APP_PATH = "/radarplay/agente"
HFP_AG = "0000111f-0000-1000-8000-00805f9b34fb"


def _mac(path):
    m = re.search(r"dev_([0-9A-F_]{17})", str(path))
    return m.group(1).replace("_", ":") if m else None


def _cargar_contactos():
    global contactos
    try:
        with open(CONTACTOS_F, encoding="utf-8") as f:
            c = json.load(f)
        contactos = c.get("lista", [])
        estado.update(contactos_n=len(contactos), contactos_fecha=c.get("fecha"))
    except Exception:
        pass


# ===================== Hilo principal (D-Bus + GLib) =====================
def hilo():
    global _bus
    try:
        import dbus, dbus.service, dbus.mainloop.glib
        from gi.repository import GLib
    except ImportError:
        estado["msg"] = "Faltan python3-dbus y python3-gi (los instala instalar.sh)"
        return
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    try:
        _bus = dbus.SystemBus()
    except Exception as e:
        estado["msg"] = "No puedo hablar con Bluetooth: %s" % e
        return

    class Rechazado(dbus.DBusException):
        _dbus_error_name = "org.bluez.Error.Rejected"

    def ventana():
        return time.time() < estado["emparejando_hasta"]

    class Agente(dbus.service.Object):
        @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
        def Release(self): pass

        @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
        def AuthorizeService(self, device, uuid):
            if ventana() or _prop(device, "org.bluez.Device1", "Paired"):
                return
            raise Rechazado("No autorizado")

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="s")
        def RequestPinCode(self, device):
            if not ventana(): raise Rechazado("Fuera de la ventana de emparejar")
            estado["codigo"] = "0000"
            return "0000"

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="u")
        def RequestPasskey(self, device):
            if not ventana(): raise Rechazado("Fuera de la ventana de emparejar")
            return dbus.UInt32(0)

        @dbus.service.method("org.bluez.Agent1", in_signature="ouq", out_signature="")
        def DisplayPasskey(self, device, passkey, entered):
            estado["codigo"] = "%06d" % passkey

        @dbus.service.method("org.bluez.Agent1", in_signature="os", out_signature="")
        def DisplayPinCode(self, device, pincode):
            estado["codigo"] = str(pincode)

        @dbus.service.method("org.bluez.Agent1", in_signature="ou", out_signature="")
        def RequestConfirmation(self, device, passkey):
            # El código sale en el iPhone y en la pantalla: si estás emparejando, se acepta
            if not ventana(): raise Rechazado("Fuera de la ventana de emparejar")
            estado["codigo"] = "%06d" % passkey

        @dbus.service.method("org.bluez.Agent1", in_signature="o", out_signature="")
        def RequestAuthorization(self, device):
            if not ventana(): raise Rechazado("Fuera de la ventana de emparejar")

        @dbus.service.method("org.bluez.Agent1", in_signature="", out_signature="")
        def Cancel(self): estado["codigo"] = None

    def _prop(path, iface, name):
        try:
            return _bus.get_object("org.bluez", path).Get(iface, name, dbus_interface="org.freedesktop.DBus.Properties")
        except Exception:
            return None

    globals()["_prop"] = _prop
    try:
        Agente(_bus, APP_PATH)
        am = dbus.Interface(_bus.get_object("org.bluez", "/org/bluez"), "org.bluez.AgentManager1")
        am.RegisterAgent(APP_PATH, "DisplayYesNo")
        am.RequestDefaultAgent(APP_PATH)
    except Exception as e:
        estado["msg"] = "Bluetooth no responde (¿adaptador conectado?): %s" % str(e)[:120]

    def adaptador():
        om = dbus.Interface(_bus.get_object("org.bluez", "/"), "org.freedesktop.DBus.ObjectManager")
        for p, ifs in om.GetManagedObjects().items():
            if "org.bluez.Adapter1" in ifs:
                return p, ifs["org.bluez.Adapter1"]
        return None, None

    def setp(path, iface, name, val):
        _bus.get_object("org.bluez", path).Set(iface, name, val, dbus_interface="org.freedesktop.DBus.Properties")

    estado_int = {"preparado": None, "ult_conexion": 0}

    def preparar(ap):
        if estado_int["preparado"] == ap:
            return
        try:
            setp(ap, "org.bluez.Adapter1", "Powered", dbus.Boolean(True))
            setp(ap, "org.bluez.Adapter1", "Alias", dbus.String("Radar Play"))
            setp(ap, "org.bluez.Adapter1", "Pairable", dbus.Boolean(True))
            estado_int["preparado"] = ap
        except Exception as e:
            estado["msg"] = "No puedo encender el Bluetooth: %s" % str(e)[:120]

    def ofono():
        try:
            mgr = dbus.Interface(_bus.get_object("org.ofono", "/"), "org.ofono.Manager")
            return mgr.GetModems()
        except Exception:
            return []

    def refrescar():
        try:
            ap, aprops = adaptador()
            if not ap:
                estado.update(disponible=False, adaptador=None, msg="No hay adaptador Bluetooth. Conecta uno USB o activa el de la Raspberry")
                return True
            preparar(ap)
            estado.update(disponible=True, adaptador=str(aprops.get("Alias") or aprops.get("Name")),
                          msg="Listo" if not ventana() else "Visible como «Radar Play»: búscalo en el iPhone")
            if not ventana() and aprops.get("Discoverable"):
                setp(ap, "org.bluez.Adapter1", "Discoverable", dbus.Boolean(False))
                estado["codigo"] = None
            om = dbus.Interface(_bus.get_object("org.bluez", "/"), "org.freedesktop.DBus.ObjectManager")
            objs = om.GetManagedObjects()
            devs, tel, player = [], None, None
            for p, ifs in objs.items():
                d = ifs.get("org.bluez.Device1")
                if not d or not d.get("Paired"):
                    continue
                if not d.get("Trusted"):
                    try: setp(p, "org.bluez.Device1", "Trusted", dbus.Boolean(True))
                    except Exception: pass
                x = {"mac": str(d.get("Address")), "nombre": str(d.get("Alias") or d.get("Name") or d.get("Address")),
                     "conectado": bool(d.get("Connected")), "path": str(p), "icono": str(d.get("Icon") or "")}
                devs.append(x)
                if x["conectado"] and (tel is None or "phone" in x["icono"]):
                    tel = x
            for p, ifs in objs.items():
                mp = ifs.get("org.bluez.MediaPlayer1")
                if mp and tel and str(mp.get("Device")) == tel["path"]:
                    t = mp.get("Track") or {}
                    player = {"path": str(p), "estado": str(mp.get("Status") or ""), "titulo": str(t.get("Title") or ""),
                              "artista": str(t.get("Artist") or ""), "album": str(t.get("Album") or ""),
                              "duracion": int(t.get("Duration") or 0) // 1000, "posicion": int(mp.get("Position") or 0) // 1000,
                              "app": str(mp.get("Name") or "")}
            estado["dispositivos"] = devs
            estado["musica"] = player
            # Llamadas y batería por oFono (manos libres)
            llamadas, extra = [], {}
            for mpath, mprops in ofono():
                mac = _mac(mpath)
                if not tel or mac != tel["mac"]:
                    continue
                m = _bus.get_object("org.ofono", mpath)
                if not mprops.get("Powered"):
                    try: dbus.Interface(m, "org.ofono.Modem").SetProperty("Powered", dbus.Boolean(True))
                    except Exception: pass
                ifaces = mprops.get("Interfaces") or []
                if "org.ofono.VoiceCallManager" in ifaces:
                    for cpath, cprops in dbus.Interface(m, "org.ofono.VoiceCallManager").GetCalls():
                        num = str(cprops.get("LineIdentification") or "")
                        llamadas.append({"id": str(cpath), "numero": num, "nombre": str(cprops.get("Name") or "") or nombre_de(num),
                                         "estado": str(cprops.get("State") or "")})
                if "org.ofono.Handsfree" in ifaces:
                    try: extra["bateria"] = int(dbus.Interface(m, "org.ofono.Handsfree").GetProperties().get("BatteryChargeLevel", -1))
                    except Exception: pass
                if "org.ofono.NetworkRegistration" in ifaces:
                    try:
                        nr = dbus.Interface(m, "org.ofono.NetworkRegistration").GetProperties()
                        extra.update(senal=int(nr.get("Strength", 0)), operador=str(nr.get("Name", "")))
                    except Exception: pass
                extra["modem"] = str(mpath)
            estado["llamadas"] = llamadas
            estado["telefono"] = {**tel, **extra} if tel else None
            # Reconectar el iPhone de confianza si no está conectado
            if not tel and devs and time.time() - estado_int["ult_conexion"] > 20:
                estado_int["ult_conexion"] = time.time()
                for d in devs:
                    try:
                        dbus.Interface(_bus.get_object("org.bluez", d["path"]), "org.bluez.Device1").Connect(
                            reply_handler=lambda: None, error_handler=lambda e: None)
                    except Exception:
                        pass
        except Exception as e:
            estado["msg"] = "Bluetooth: %s" % str(e)[:140]
        return True

    def ordenar(d):
        a = d.get("accion")
        tel = estado.get("telefono")
        if a == "emparejar":
            ap, _ = adaptador()
            if not ap:
                return {"ok": False, "error": "No hay adaptador Bluetooth"}
            estado.update(emparejando_hasta=time.time() + 120, codigo=None)
            setp(ap, "org.bluez.Adapter1", "DiscoverableTimeout", dbus.UInt32(120))
            setp(ap, "org.bluez.Adapter1", "Discoverable", dbus.Boolean(True))
            return {"ok": True}
        if a == "parar_emparejar":
            estado["emparejando_hasta"] = 0
            return {"ok": True}
        if a in ("conectar", "desconectar", "olvidar"):
            dev = next((x for x in estado["dispositivos"] if x["mac"] == d.get("mac")), None)
            if not dev:
                return {"ok": False, "error": "No encuentro ese dispositivo"}
            o = dbus.Interface(_bus.get_object("org.bluez", dev["path"]), "org.bluez.Device1")
            if a == "conectar":
                o.Connect(reply_handler=lambda: None, error_handler=lambda e: None)
            elif a == "desconectar":
                o.Disconnect(reply_handler=lambda: None, error_handler=lambda e: None)
            else:
                ap, _ = adaptador()
                dbus.Interface(_bus.get_object("org.bluez", ap), "org.bluez.Adapter1").RemoveDevice(dev["path"])
            return {"ok": True}
        if a == "musica":
            m = estado.get("musica")
            if not m:
                return {"ok": False, "error": "El iPhone no está mandando música"}
            orden = {"play": "Play", "pause": "Pause", "next": "Next", "previous": "Previous"}.get(d.get("orden"))
            if not orden:
                return {"ok": False, "error": "Orden no válida"}
            getattr(dbus.Interface(_bus.get_object("org.bluez", m["path"]), "org.bluez.MediaPlayer1"), orden)()
            return {"ok": True}
        if a in ("llamar", "contestar", "colgar"):
            if not tel or not tel.get("modem"):
                return {"ok": False, "error": "El iPhone no está conectado para llamadas"}
            m = _bus.get_object("org.ofono", tel["modem"])
            vcm = dbus.Interface(m, "org.ofono.VoiceCallManager")
            if a == "llamar":
                num = re.sub(r"[^\d+*#]", "", str(d.get("numero") or ""))
                if not num:
                    return {"ok": False, "error": "Número vacío"}
                vcm.Dial(num, "default")
            elif a == "contestar":
                c = next((x for x in estado["llamadas"] if x["estado"] in ("incoming", "waiting")), None)
                if not c:
                    return {"ok": False, "error": "No hay llamada entrante"}
                dbus.Interface(_bus.get_object("org.ofono", c["id"]), "org.ofono.VoiceCall").Answer(timeout=8)
            else:
                return colgar(tel, vcm)
            LOG.info("Llamada: %s hecho", a, origen="bt")
            return {"ok": True}
        if a in ("al_iphone", "al_coche"):
            if not tel:
                return {"ok": False, "error": "El iPhone no está conectado"}
            dev = dbus.Interface(_bus.get_object("org.bluez", tel["path"]), "org.bluez.Device1")
            f = dev.DisconnectProfile if a == "al_iphone" else dev.ConnectProfile
            f(HFP_AG, reply_handler=lambda: None, error_handler=lambda e: LOG.aviso("%s: %s", a, e, origen="bt"))
            return {"ok": True}
        if a == "diagnostico":
            return diagnostico_bt()
        return {"ok": False, "error": "Acción desconocida"}

    def colgar(tel, vcm):
        """Cuelga probando varias formas: el iPhone no siempre acepta la primera."""
        errores, hecho = [], False
        try:
            vivas = [(str(p), str(pr.get("State", ""))) for p, pr in vcm.GetCalls() if str(pr.get("State", "")) != "disconnected"]
        except Exception as e:
            vivas = [(c["id"], c["estado"]) for c in estado["llamadas"] if c["estado"] != "disconnected"]
            errores.append("GetCalls: %s" % e)
        if not vivas:
            estado["llamadas"] = []
            return {"ok": True, "msg": "No había ninguna llamada activa"}
        for cp, st in vivas:
            try:
                dbus.Interface(_bus.get_object("org.ofono", cp), "org.ofono.VoiceCall").Hangup(timeout=8)
                hecho = True
            except Exception as e:
                errores.append("Hangup (%s): %s" % (st, str(e)[:120]))
        if not hecho:
            try:
                vcm.HangupAll(timeout=8)
                hecho = True
            except Exception as e:
                errores.append("HangupAll: %s" % str(e)[:120])
        if errores:
            LOG.aviso("Colgar: %s", " · ".join(errores), origen="bt")
        if hecho:
            LOG.info("Llamada colgada desde la pantalla", origen="bt")
            GLib.timeout_add(600, refrescar)
            return {"ok": True}
        # Último recurso: soltar el manos libres. La llamada sigue en el iPhone y la pantalla queda libre.
        try:
            dev = dbus.Interface(_bus.get_object("org.bluez", tel["path"]), "org.bluez.Device1")
            dev.DisconnectProfile(HFP_AG, reply_handler=lambda: None, error_handler=lambda e: None)
            GLib.timeout_add(5000, lambda: (dev.ConnectProfile(HFP_AG, reply_handler=lambda: None, error_handler=lambda e: None), False)[1])
            LOG.aviso("El iPhone no aceptó colgar: llamada pasada al iPhone", origen="bt")
            return {"ok": True, "pasada": True, "msg": "El iPhone no ha dejado colgar desde el coche. He pasado la llamada al iPhone: cuélgala allí."}
        except Exception as e:
            return {"ok": False, "error": "No se pudo colgar: " + " · ".join(errores)[:200]}

    def diagnostico_bt():
        """Qué funciona del iPhone ahora mismo (para la pantalla «Probar el iPhone»)."""
        ap, aprops = adaptador()
        tel = estado.get("telefono")
        r = {"adaptador": bool(ap), "encendido": bool(aprops and aprops.get("Powered")), "emparejados": len(estado["dispositivos"]),
             "conectado": tel["nombre"] if tel else None, "servicios": [], "llamadas": False, "musica": False,
             "audio_musica": False, "modem": None}
        if tel:
            uu = [str(u).lower() for u in (_prop(tel["path"], "org.bluez.Device1", "UUIDs") or [])]
            nombres = {"111f": "Llamadas (HFP)", "110a": "Música (A2DP)", "110e": "Botones (AVRCP)", "110c": "Botones (AVRCP)",
                       "112f": "Contactos (PBAP)", "1132": "Mensajes (MAP)"}
            r["servicios"] = sorted({v for k, v in nombres.items() if any(u[4:8] == k for u in uu)})
            r["llamadas"] = bool(tel.get("modem"))
            r["musica"] = bool(estado.get("musica"))
            om = dbus.Interface(_bus.get_object("org.bluez", "/"), "org.freedesktop.DBus.ObjectManager")
            for p, ifs in om.GetManagedObjects().items():
                if "org.bluez.MediaTransport1" in ifs and str(p).startswith(tel["path"]):
                    r["audio_musica"] = str(ifs["org.bluez.MediaTransport1"].get("State") or "conectado")
            r["modem"] = [str(m[0]) for m in ofono()]
        return {"ok": True, **r}
        return {"ok": False, "error": "Acción desconocida"}

    def en_bucle(fn, d, res, ev):
        try:
            res["r"] = fn(d)
        except Exception as e:
            res["r"] = {"ok": False, "error": str(e)[:160]}
        ev.set()
        return False

    def ejecutar(d):
        res, ev = {}, threading.Event()
        GLib.idle_add(en_bucle, ordenar, d, res, ev)
        if not ev.wait(10):
            return {"ok": False, "error": "Bluetooth no responde"}
        return res["r"]

    _loop.update(ok=True, ejecutar=ejecutar)
    try:
        import ancs
        ancs.iniciar(_bus, dbus, GLib, _prop, adaptador)
    except Exception as e:
        LOG.aviso("Avisos del iPhone no disponibles: %s", e, origen="avisos")
    refrescar()
    GLib.timeout_add(1000, refrescar)
    # Avisa al momento de llamadas nuevas (además del sondeo cada segundo)
    try:
        _bus.add_signal_receiver(lambda *a: refrescar(), signal_name="CallAdded", dbus_interface="org.ofono.VoiceCallManager")
        _bus.add_signal_receiver(lambda *a: refrescar(), signal_name="CallRemoved", dbus_interface="org.ofono.VoiceCallManager")
    except Exception:
        pass
    GLib.MainLoop().run()


# ===================== Contactos (PBAP) =====================
def nombre_de(num):
    n = re.sub(r"\D", "", num or "")[-9:]
    if not n:
        return ""
    for c in contactos:
        for t in c.get("t", []):
            if re.sub(r"\D", "", t)[-9:] == n:
                return c["n"]
    return ""


def parse_vcards(txt):
    txt = re.sub(r"\r?\n[ \t]", "", txt)                  # líneas partidas
    out = []
    for bloque in re.findall(r"BEGIN:VCARD(.*?)END:VCARD", txt, re.S | re.I):
        fn, tels = "", []
        for linea in bloque.splitlines():
            k, _, v = linea.partition(":")
            ku = k.upper()
            if "." in ku.split(";")[0]:                  # «item1.TEL;…» (así exporta el iPhone)
                ku = ku.split(".", 1)[1]
            if ku.startswith("FN"):
                fn = v.strip()
            elif ku.startswith("N") and not fn and not ku.startswith("NOTE") and not ku.startswith("NICKNAME"):
                partes = [p for p in v.split(";") if p]
                fn = " ".join(reversed(partes[:2])).strip()
            elif ku.startswith("TEL") and v.strip():
                tels.append(v.strip())
        if fn and tels:
            out.append({"n": fn.replace("\\,", ","), "t": tels})
    out.sort(key=lambda c: c["n"].lower())
    return out


def importar_vcf(datos):
    """Contactos subidos como archivo .vcf (exportados desde el iPhone o iCloud)."""
    txt = datos.decode("utf-8", "ignore") if isinstance(datos, bytes) else str(datos)
    lista = parse_vcards(txt)
    if not lista:
        return {"ok": False, "error": "No encuentro contactos con teléfono en ese archivo. Tiene que ser un .vcf"}
    global contactos
    contactos = lista
    fecha = time.strftime("%Y-%m-%d %H:%M")
    os.makedirs(os.path.dirname(CONTACTOS_F), exist_ok=True)
    with open(CONTACTOS_F, "w", encoding="utf-8") as f:
        json.dump({"fecha": fecha, "lista": lista, "origen": "archivo"}, f, ensure_ascii=False)
    estado.update(contactos_n=len(lista), contactos_fecha=fecha, contactos_msg="%d contactos (subidos desde el móvil)" % len(lista), contactos_error=0)
    LOG.info("Contactos: %d importados desde un archivo .vcf", len(lista), origen="bt")
    return {"ok": True, "n": len(lista), "msg": "%d contactos cargados en Radar Play" % len(lista)}


def descargar_contactos():
    tel = estado.get("telefono")
    if not tel:
        estado["contactos_msg"] = "Conecta primero el iPhone"
        return
    try:
        import dbus
        bus = dbus.SessionBus(private=True)
        cli = dbus.Interface(bus.get_object("org.bluez.obex", "/org/bluez/obex"), "org.bluez.obex.Client1")
        estado["contactos_msg"] = "Descargando contactos del iPhone…"
        ses = cli.CreateSession(tel["mac"], {"Target": "PBAP"})
        pb = dbus.Interface(bus.get_object("org.bluez.obex", ses), "org.bluez.obex.PhonebookAccess1")
        pb.Select("int", "pb")
        ruta = os.path.join(CARPETA, "datos", "bt-contactos.vcf")
        tr, props = pb.PullAll(ruta, {"Format": "vcard30"})
        trp = dbus.Interface(bus.get_object("org.bluez.obex", tr), "org.freedesktop.DBus.Properties")
        for _ in range(120):
            st = str(trp.Get("org.bluez.obex.Transfer1", "Status"))
            if st in ("complete", "error"):
                break
            time.sleep(0.5)
        try: cli.RemoveSession(ses)
        except Exception: pass
        if st != "complete":
            raise IOError("El iPhone no ha mandado los contactos (¿activaste «Sincronizar contactos»?)")
        with open(ruta, encoding="utf-8", errors="ignore") as f:
            lista = parse_vcards(f.read())
        global contactos
        contactos = lista
        fecha = time.strftime("%Y-%m-%d %H:%M")
        with open(CONTACTOS_F, "w", encoding="utf-8") as f:
            json.dump({"fecha": fecha, "lista": lista}, f, ensure_ascii=False)
        estado.update(contactos_n=len(lista), contactos_fecha=fecha, contactos_msg="%d contactos del iPhone" % len(lista))
        estado["contactos_error"] = 0
        LOG.info("Contactos: %d descargados del iPhone", len(lista), origen="bt")
    except Exception as e:
        t = str(e)
        estado["contactos_error"] = estado.get("contactos_error", 0) + 1
        if re.search(r"refused|Forbidden|denied|not authori|Unauthorized|111", t, re.I):
            estado["contactos_msg"] = ("El iPhone no deja leer los contactos. En el iPhone: Ajustes › Bluetooth › (i) junto a «Radar Play» › "
                                       "activa «Sincronizar contactos». Si sale un aviso en el iPhone, pulsa Permitir. Lo vuelvo a intentar solo")
        else:
            estado["contactos_msg"] = "No se pudieron leer: %s" % t[:150]
        LOG.aviso("Contactos: %s", t[:200], origen="bt")


def hilo_contactos_auto():
    """Descarga los contactos la primera vez que se conecta el iPhone (y luego una vez al día)."""
    ultimo = None
    while True:
        tel = estado.get("telefono")
        if tel and (ultimo != tel["mac"] or not estado["contactos_fecha"] or time.time() % 86400 < 60):
            ultimo = tel["mac"]
            if not estado["contactos_fecha"] or estado["contactos_fecha"][:10] != time.strftime("%Y-%m-%d"):
                time.sleep(8)                            # deja que el iPhone termine de conectar
                descargar_contactos()
        elif tel and 0 < estado.get("contactos_error", 0) < 10:
            time.sleep(60)                               # reintenta: quizá acabas de activar «Sincronizar contactos»
            if estado.get("telefono"):
                descargar_contactos()
            continue
        time.sleep(30)


# ===================== HTTP =====================
def arrancar(sis, obd=None):
    _cargar_contactos()
    if not int(sis.CONF.get("BLUETOOTH", 1)):
        estado["msg"] = "Desactivado (BLUETOOTH=0)"
        return
    if not sis.ES_PI:
        estado["msg"] = "El iPhone por Bluetooth funciona en la Raspberry. Aquí se usa el teléfono simulado."
        return
    threading.Thread(target=hilo, daemon=True).start()
    threading.Thread(target=hilo_contactos_auto, daemon=True).start()


def g_bt(q):
    return {**estado, "emparejando": time.time() < estado["emparejando_hasta"]}


def g_contactos(q):
    return {"lista": contactos, "fecha": estado["contactos_fecha"]}


# ===================== Pruebas de sonido =====================
def _cmd(c, t=6):
    try:
        r = subprocess.run(c, capture_output=True, text=True, timeout=t)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except FileNotFoundError:
        return 127, ""
    except Exception as e:
        return 1, str(e)


def audio_info():
    """Altavoces, micrófono y si el iPhone está en modo música o llamada."""
    info = {"altavoces": [], "microfonos": [], "bt_perfil": None}
    rc, out = _cmd(["pactl", "list", "cards"])
    if rc == 0:
        tarjeta, perfil = None, None
        for l in out.splitlines():
            l = l.strip()
            if l.startswith("Name:"):
                tarjeta = l.split(":", 1)[1].strip()
            elif l.startswith("Active Profile:") and tarjeta and tarjeta.startswith("bluez"):
                info["bt_perfil"] = l.split(":", 1)[1].strip()
    for tipo, clave in (("sinks", "altavoces"), ("sources", "microfonos")):
        rc, out = _cmd(["pactl", "list", "short", tipo])
        if rc == 0:
            info[clave] = [x.split("\t")[1] for x in out.splitlines() if "\t" in x and not x.split("\t")[1].endswith(".monitor")]
    return info


def _tono(ruta, seg=1.2):
    with wave.open(ruta, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
        fr = b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * (440 if i < 22050 * seg / 2 else 660) * i / 22050)))
                      for i in range(int(22050 * seg)))
        w.writeframes(fr)


def _reproducir(ruta):
    for c in (["pw-play", ruta], ["paplay", ruta], ["aplay", "-q", ruta]):
        rc, out = _cmd(c, 15)
        if rc != 127:
            return rc == 0, out.strip()[:160]
    return False, "No hay programa para reproducir sonido"


def prueba_tono():
    ruta = os.path.join(CARPETA, "datos", "prueba-tono.wav")
    _tono(ruta)
    ok, msg = _reproducir(ruta)
    LOG.info("Prueba de altavoces: %s %s", "ok" if ok else "fallo", msg, origen="bt")
    return {"ok": ok, "error": None if ok else "No suena: " + msg}


def prueba_microfono(seg=4):
    """Graba unos segundos, mide el nivel y lo vuelve a poner por los altavoces."""
    ruta = os.path.join(CARPETA, "datos", "prueba-micro.wav")
    try: os.remove(ruta)
    except Exception: pass
    hecho = False
    for c in (["pw-record", "--rate", "16000", "--channels", "1", ruta], ["arecord", "-q", "-f", "S16_LE", "-r", "16000", "-c", "1", ruta]):
        try:
            pr = subprocess.Popen(c, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except FileNotFoundError:
            continue
        time.sleep(seg)
        pr.terminate()
        try: pr.wait(3)
        except Exception: pr.kill()
        hecho = True
        break
    if not hecho or not os.path.exists(ruta):
        return {"ok": False, "error": "No se pudo grabar. ¿Hay micrófono conectado?"}
    try:
        with wave.open(ruta) as w:
            n = w.getnframes(); datos = w.readframes(n)
        muestras = struct.unpack("<%dh" % (len(datos) // 2), datos[:len(datos) // 2 * 2]) if datos else ()
        pico = max((abs(x) for x in muestras), default=0)
    except Exception as e:
        return {"ok": False, "error": "La grabación no se puede leer: %s" % e}
    nivel = round(pico / 327.67)
    _reproducir(ruta)
    LOG.info("Prueba de micrófono: nivel %s %%", nivel, origen="bt")
    return {"ok": True, "nivel": nivel, "msg": "No se oye nada: revisa el micrófono" if nivel < 3 else "Micrófono bien (nivel %d %%)" % nivel}


def p_bt(d):
    a = d.get("accion")
    if a == "tono":
        return prueba_tono()
    if a == "microfono":
        return prueba_microfono()
    if a == "audio":
        return {"ok": True, **audio_info()}
    if a == "contactos":
        threading.Thread(target=descargar_contactos, daemon=True).start()
        return {"ok": True}
    if a == "silenciar":
        try:
            subprocess.run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SOURCE@", "toggle"], timeout=3)
            estado["microfono_silenciado"] = not estado["microfono_silenciado"]
            return {"ok": True, "silenciado": estado["microfono_silenciado"]}
        except Exception as e:
            return {"ok": False, "error": str(e)}
    if not _loop["ok"]:
        return {"ok": False, "error": estado["msg"]}
    return _loop["ejecutar"](d)


GET = {"/api/bt": g_bt, "/api/bt/contactos": g_contactos}
POST = {"/api/bt": p_bt}


# ===================== Avisos de WhatsApp (ancs.py) =====================
def g_avisos(q):
    import ancs
    desde = int((q.get("desde") or ["0"])[0] or 0)
    return {"disponible": _loop["ok"], **ancs.estado, "eventos": ancs.lista(desde),
            "emparejando": time.time() < estado["emparejando_hasta"]}


def p_avisos(d):
    if d.get("accion") == "activar":
        estado["emparejando_hasta"] = time.time() + 180      # deja emparejar por Bluetooth LE 3 minutos
        LOG.info("Avisos: ventana para aceptar en el iPhone abierta", origen="avisos")
        return {"ok": True}
    return {"ok": False, "error": "Acción desconocida"}


GET["/api/avisos"] = g_avisos
POST["/api/avisos"] = p_avisos
