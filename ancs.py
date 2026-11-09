"""
Radar Play · Avisos del iPhone (WhatsApp) por Bluetooth
Usa el sistema oficial de Apple para mandar avisos a otros aparatos (ANCS,
el mismo que usan los relojes). La Raspberry se anuncia por Bluetooth LE; al
aceptarla en el iPhone, cada aviso nuevo de WhatsApp llega con el nombre de
la persona o del grupo y el texto. Solo se ven (no se puede contestar).

Funciona dentro del hilo de Bluetooth de bt.py (mismo bus D-Bus y GLib).
En el iPhone: Ajustes › Bluetooth › (i) junto a «Radar Play» ›
«Compartir notificaciones del sistema» (o aceptar el aviso que sale).
"""
import struct, threading, time
from collections import deque
import registro as LOG

ANCS = "7905f431-b5ce-4e99-a40f-4b1e122d00d0"
NS = "9fbf120d-6301-42d9-8c58-25e699a21dbd"       # Notification Source (avisos nuevos / quitados)
CP = "69d1d8f3-45e1-49a8-9821-9bbdfdaad9d9"       # Control Point (pedir el texto)
DS = "22eac6e9-24d6-4bb5-be44-b36ace7c7bfb"       # Data Source (llega el texto)
APPS = {"net.whatsapp.WhatsApp": "whatsapp", "net.whatsapp.WhatsAppSMB": "whatsapp"}
ANUNCIO = "/radarplay/anuncio"
# Lo que se pide de cada aviso: app, título (persona o grupo), subtítulo y mensaje
ATRIBUTOS = [(0, None), (1, 80), (2, 80), (3, 300)]

estado = {"anunciando": False, "conectado": False, "iphone": None, "msg": "Esperando al iPhone", "suscrito": False,
          "ultimo": None, "n_avisos": 0}
eventos = deque(maxlen=300)            # {n, tipo: nuevo|quitar, id, app, titulo, sub, texto, t, previo}
_seq = {"n": 0}
_cola = []                              # UIDs pendientes de pedir su texto
_int = {"rutas": None, "buf": b"", "pidiendo": None, "desde": 0, "previos": set(), "apps": {}, "bus": None}
_cerrojo = threading.Lock()


def _evento(**kv):
    with _cerrojo:
        _seq["n"] += 1
        kv["n"] = _seq["n"]
        eventos.append(kv)


def lista(desde=0):
    with _cerrojo:
        return [e for e in eventos if e["n"] > desde]


def iniciar(bus, dbus, GLib, prop, adaptador):
    """Se llama desde el hilo de bt.py antes de arrancar el bucle de GLib."""
    _int["bus"] = bus

    class Anuncio(dbus.service.Object):
        @dbus.service.method("org.freedesktop.DBus.Properties", in_signature="s", out_signature="a{sv}")
        def GetAll(self, iface):
            return {"Type": "peripheral",
                    "SolicitUUIDs": dbus.Array([ANCS], signature="s"),
                    "LocalName": dbus.String("Radar Play"),
                    "Discoverable": dbus.Boolean(True)}

        @dbus.service.method("org.bluez.LEAdvertisement1", in_signature="", out_signature="")
        def Release(self):
            estado["anunciando"] = False

    try:
        Anuncio(bus, ANUNCIO)
    except Exception as e:
        LOG.aviso("Avisos iPhone: no puedo crear el anuncio: %s", e, origen="avisos")
        return

    def anunciar():
        if estado["anunciando"]:
            return
        ap, _ = adaptador()
        if not ap:
            return
        try:
            mgr = dbus.Interface(bus.get_object("org.bluez", ap), "org.bluez.LEAdvertisingManager1")
            mgr.RegisterAdvertisement(ANUNCIO, {}, reply_handler=lambda: estado.update(anunciando=True),
                                      error_handler=lambda e: (estado.update(anunciando=False, msg="El Bluetooth no deja anunciarse: %s" % str(e)[:90]),
                                                               LOG.aviso("Avisos iPhone: anuncio rechazado: %s", e, origen="avisos")))
        except Exception as e:
            estado["msg"] = "Este Bluetooth no permite avisos (LE): %s" % str(e)[:90]

    def pedir_siguiente():
        if _int["pidiendo"] and time.time() - _int["desde"] < 4:
            return
        if not _cola or not _int["rutas"]:
            _int["pidiendo"] = None
            return
        uid = _cola.pop(0)
        _int.update(pidiendo=uid, desde=time.time(), buf=b"")
        orden = bytes([0]) + struct.pack("<I", uid)
        for aid, largo in ATRIBUTOS:
            orden += bytes([aid]) + (struct.pack("<H", largo) if largo else b"")
        try:
            car = dbus.Interface(bus.get_object("org.bluez", _int["rutas"]["cp"]), "org.bluez.GattCharacteristic1")
            car.WriteValue(dbus.Array(orden, signature="y"), {"type": dbus.String("request")},
                           reply_handler=lambda: None, error_handler=lambda e: (_int.update(pidiendo=None), LOG.aviso("Avisos iPhone: %s", e, origen="avisos")))
        except Exception as e:
            _int["pidiendo"] = None

    def leer_datos(valor):
        """El texto puede llegar en varios trozos: se junta hasta tener los 4 atributos."""
        _int["buf"] += bytes(valor)
        b = _int["buf"]
        if len(b) < 5:
            return
        uid = struct.unpack("<I", b[1:5])[0]
        i, at = 5, {}
        for _ in ATRIBUTOS:
            if i + 3 > len(b):
                return                                  # falta un trozo
            aid, largo = b[i], struct.unpack("<H", b[i + 1:i + 3])[0]
            if i + 3 + largo > len(b):
                return
            at[aid] = b[i + 3:i + 3 + largo].decode("utf-8", "replace")
            i += 3 + largo
        _int.update(buf=b"", pidiendo=None)
        app = at.get(0, "")
        if app in APPS:
            previo = uid in _int["previos"]
            titulo, sub, texto = at.get(1, "").strip(), at.get(2, "").strip(), at.get(3, "").strip()
            _int["apps"][uid] = APPS[app]
            _evento(tipo="nuevo", id=uid, app=APPS[app], titulo=titulo or "WhatsApp", sub=sub, texto=texto,
                    t=int(time.time() * 1000), previo=previo)
            estado["n_avisos"] += 1
            if not previo:
                LOG.info("Aviso de WhatsApp nuevo", origen="avisos")     # sin nombre ni texto en el registro
        GLib.idle_add(lambda: (pedir_siguiente(), False)[1])

    def fuente(valor):
        v = bytes(valor)
        if len(v) < 8:
            return
        ev, flags, cat, _, uid = v[0], v[1], v[2], v[3], struct.unpack("<I", v[4:8])[0]
        if ev == 0:                                     # aviso nuevo
            if flags & 0x04:
                _int["previos"].add(uid)                # ya estaba en el iPhone al conectar: sin ventana emergente
            _cola.append(uid)                           # el filtro de WhatsApp va por la app, al llegar el texto
            pedir_siguiente()
        elif ev == 2:                                   # quitado (lo has leído o borrado en el iPhone)
            if _int["apps"].pop(uid, None):
                _evento(tipo="quitar", id=uid)

    def cambio(iface, cambiado, invalidado, path=None):
        if iface != "org.bluez.GattCharacteristic1" or "Value" not in cambiado or not _int["rutas"]:
            return
        if path == _int["rutas"]["ds"]:
            leer_datos(cambiado["Value"])
        elif path == _int["rutas"]["ns"]:
            fuente(cambiado["Value"])

    bus.add_signal_receiver(cambio, signal_name="PropertiesChanged", dbus_interface="org.freedesktop.DBus.Properties",
                            bus_name="org.bluez", path_keyword="path")

    def buscar_ancs():
        """Mira si el iPhone ofrece el servicio de avisos y se suscribe."""
        try:
            om = dbus.Interface(bus.get_object("org.bluez", "/"), "org.freedesktop.DBus.ObjectManager")
            objs = om.GetManagedObjects()
            svc = next((p for p, i in objs.items() if str(i.get("org.bluez.GattService1", {}).get("UUID", "")).lower() == ANCS), None)
            if not svc:
                if _int["rutas"]:
                    LOG.info("Avisos del iPhone desconectados", origen="avisos")
                _int["rutas"] = None
                estado.update(conectado=False, suscrito=False,
                              msg="Esperando al iPhone. Actívalo en el iPhone: Ajustes › Bluetooth › (i) › Compartir notificaciones del sistema")
                anunciar()
                return True
            rutas = {}
            for p, i in objs.items():
                c = i.get("org.bluez.GattCharacteristic1")
                if c and str(p).startswith(str(svc) + "/"):
                    u = str(c.get("UUID", "")).lower()
                    rutas[{NS: "ns", CP: "cp", DS: "ds"}.get(u, "x")] = str(p)
            if not all(k in rutas for k in ("ns", "cp", "ds")):
                return True
            if _int["rutas"] == rutas and estado["suscrito"]:
                return True
            _int["rutas"] = rutas
            dev = str(objs[svc]["org.bluez.GattService1"].get("Device", ""))
            estado.update(conectado=True, iphone=str(prop(dev, "org.bluez.Device1", "Alias") or "iPhone"), msg="Conectando los avisos…")
            ds = dbus.Interface(bus.get_object("org.bluez", rutas["ds"]), "org.bluez.GattCharacteristic1")
            ns = dbus.Interface(bus.get_object("org.bluez", rutas["ns"]), "org.bluez.GattCharacteristic1")

            def ok_ns():
                estado.update(suscrito=True, msg="Avisos de WhatsApp activos")
                LOG.info("Avisos del iPhone activos", origen="avisos")

            def fallo(e):
                t = str(e)
                estado.update(suscrito=False, msg="Acepta en el iPhone «Permitir notificaciones». Si no sale: Ajustes › Bluetooth › (i) › Compartir notificaciones del sistema"
                              if "auth" in t.lower() or "permit" in t.lower() or "encrypt" in t.lower() else "Avisos: %s" % t[:100])
                LOG.aviso("Avisos iPhone: %s", t[:200], origen="avisos")
            ds.StartNotify(reply_handler=lambda: ns.StartNotify(reply_handler=ok_ns, error_handler=fallo), error_handler=fallo)
        except Exception as e:
            estado["msg"] = "Avisos: %s" % str(e)[:100]
        return True

    def latido():
        pedir_siguiente()
        return True

    buscar_ancs()
    GLib.timeout_add_seconds(4, buscar_ancs)
    GLib.timeout_add_seconds(2, latido)
