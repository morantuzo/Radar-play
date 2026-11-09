#!/bin/bash
# ============================================================
#  Instala Radar Play como sistema de arranque en la Raspberry Pi
#  Raspberry Pi OS (64 bits, con escritorio) Bookworm o Trixie.
#  Uso:   sudo bash sistema/instalar.sh      (o  sudo bash INSTALAR.sh)
#  Se puede ejecutar desde el pendrive: se copia sola a tu carpeta personal.
#  Todo lo que hace queda en ~/radar-play-instalacion.log
#  Si se corta a medias, vuelve a ejecutarla: continúa sin problema.
# ============================================================
if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo así:  sudo bash sistema/instalar.sh"; exit 1; fi
U="${SUDO_USER:-}"
if [ -z "$U" ] || [ "$U" = "root" ]; then echo "Ejecútalo con sudo desde tu usuario normal (no como root)."; exit 1; fi
H="$(getent passwd "$U" | cut -d: -f6)"
ORIGEN="$(cd "$(dirname "$0")/.." && pwd)"
APP="$H/radar-play"
BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
LOGI="$H/radar-play-instalacion.log"
PROBLEMAS=()
exec > >(tee -a "$LOGI") 2>&1
chown "$U:$U" "$LOGI" 2>/dev/null

paso(){ echo; echo "=== $*"; }
mal(){ echo "  ✗ $*"; PROBLEMAS+=("$*"); }
bien(){ echo "  ✓ $*"; }
copia(){ [ -f "$1" ] && [ ! -f "$1.antes-radar-play" ] && cp "$1" "$1.antes-radar-play"; true; }
APTO=(-y -o DPkg::Lock::Timeout=900 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
export DEBIAN_FRONTEND=noninteractive
# Instala paquetes de uno en uno si en bloque falla, para que uno roto no pare el resto
instala(){
  local critico="$1"; shift
  apt-get install "${APTO[@]}" "$@" && { bien "$*"; return 0; }
  echo "  Reintento paquete a paquete…"
  apt-get install -f "${APTO[@]}" >/dev/null 2>&1
  local p ok=0
  for p in "$@"; do
    if apt-get install "${APTO[@]}" "$p" >/dev/null 2>&1; then bien "$p"; else
      if [ "$critico" = "si" ]; then mal "No se pudo instalar $p (imprescindible)"; ok=1; else echo "  · $p no disponible (opcional, sigo)"; fi
    fi
  done
  return $ok
}

echo "============================================================"
echo " Radar Play · instalación para el usuario $U"
echo " $(date '+%F %T') · $( (tr -d '\0' </proc/device-tree/model) 2>/dev/null || uname -m)"
echo " $(. /etc/os-release 2>/dev/null; echo "$PRETTY_NAME")"
echo "============================================================"

paso "0/10 Comprobaciones"
if [ ! -f "$ORIGEN/puente.py" ] || [ ! -f "$ORIGEN/radar-play-google.html" ]; then
  echo "No encuentro los archivos de Radar Play junto a este instalador ($ORIGEN)."
  echo "Asegúrate de copiar la carpeta «radar-play» completa (la de dentro del zip)."; exit 1
fi
LIBRE=$(df -Pm "$H" | awk 'NR==2{print $4}')
[ "${LIBRE:-0}" -lt 1500 ] && mal "Queda poco espacio en la tarjeta (${LIBRE} MB). Hacen falta unos 1.500 MB."
RED=no
for u in http://archive.raspberrypi.com http://deb.debian.org http://raspbian.raspberrypi.com http://www.google.com; do
  c=$(curl -s -o /dev/null -I --max-time 10 -w '%{http_code}' "$u" 2>/dev/null); [ -n "$c" ] && [ "$c" != "000" ] && { RED=si; break; }
done
if [ "$RED" = si ]; then bien "Hay internet"
else mal "Parece que no hay internet. Si la instalación de programas falla, conecta la WiFi (icono de arriba a la derecha) y vuelve a ejecutarlo"; fi
# Con la hora mal, las descargas fallan («Release file is not valid yet»)
AN=$(date +%Y); if [ "$AN" -lt 2025 ]; then
  echo "  La hora de la Raspberry está mal ($(date)). La pongo en hora…"
  timedatectl set-ntp true 2>/dev/null; sleep 5
  HD=$(curl -fsI --max-time 10 http://deb.debian.org 2>/dev/null | grep -i '^date:' | cut -d' ' -f2-)
  [ -n "$HD" ] && date -s "$HD" >/dev/null && bien "Hora: $(date)"
fi

paso "1/10 Copiando Radar Play a $APP"
if [ "$ORIGEN" != "$APP" ]; then
  mkdir -p "$APP"
  # Conserva tus datos (km, viajes, mantenimiento) si ya estaba instalado
  if command -v rsync >/dev/null; then rsync -a --checksum --exclude datos "$ORIGEN"/ "$APP"/; else ( cd "$ORIGEN" && tar --exclude=./datos -cf - . ) | ( cd "$APP" && tar -xf - ); fi
  [ -d "$ORIGEN/datos" ] && [ ! -d "$APP/datos" ] && cp -r "$ORIGEN/datos" "$APP/datos"
  bien "Copiado desde $ORIGEN"
else bien "Ya está en su sitio"; fi
# Comprueba que los archivos copiados no están dañados (tarjeta SD o pendrive con fallos)
MALOS=$(grep -lP '\x00' "$APP"/*.py "$APP"/js/*.js "$APP"/*.html 2>/dev/null)
if [ -n "$MALOS" ]; then
  mal "Archivos dañados en la tarjeta (llenos de ceros): $(echo $MALOS | xargs -n1 basename | tr '\n' ' ')· La tarjeta SD o el pendrive están fallando"
  [ "$ORIGEN" != "$APP" ] && for f in $MALOS; do cp -f "$ORIGEN/${f#$APP/}" "$f"; done
fi
# Archivos tocados en Windows: quita los saltos de línea \r de scripts y configuración
for f in "$APP"/sistema/*.sh "$APP"/INSTALAR.sh "$APP"/sistema/radar-play.conf; do [ -f "$f" ] && sed -i 's/\r$//' "$f"; done
mkdir -p "$APP/datos/logs"
chmod +x "$APP"/sistema/*.sh "$APP"/*.py "$APP"/INSTALAR.sh 2>/dev/null
chown -R "$U:$U" "$APP"
cp "$LOGI" "$APP/datos/logs/instalacion.log" 2>/dev/null

paso "2/10 Instalando programas (tarda unos minutos, no apagues)"
echo "  Si el sistema está actualizándose solo, espero a que termine…"
dpkg --configure -a >/dev/null 2>&1
ok_up=1; for i in 1 2 3; do apt-get update -o DPkg::Lock::Timeout=900 && { ok_up=0; break; }; echo "  apt-get update falló, reintento ($i/3)…"; sleep 10; done
[ $ok_up -ne 0 ] && mal "No se pudo actualizar la lista de programas (apt-get update). Mira el log."
if command -v chromium >/dev/null || command -v chromium-browser >/dev/null; then bien "Chromium ya instalado"
else
  if apt-cache show chromium >/dev/null 2>&1; then CH=chromium; else CH=chromium-browser; fi
  instala si "$CH"
fi
instala si python3 python3-serial curl
instala no espeak-ng libttspico-utils python3-gpiozero python3-lgpio gpsd gpsd-clients unzip rsync wlr-randr
echo "  Piezas opcionales (Bluetooth del iPhone, ruedas, acelerómetro, LEDs, dashcam):"
instala no bluez bluez-obexd ofono python3-dbus python3-gi python3-smbus python3-spidev ffmpeg v4l-utils i2c-tools pulseaudio-utils pipewire-bin alsa-utils
if ! sudo -u "$U" python3 -c "import bleak" 2>/dev/null; then
  apt-get install "${APTO[@]}" python3-bleak >/dev/null 2>&1 || sudo -u "$U" python3 -m pip install --user --break-system-packages bleak >/dev/null 2>&1 || echo "  · bleak no instalado (solo hace falta para los sensores de ruedas)"
fi

# Voz natural en español (Piper). Si no se puede descargar, se usa pico2wave o espeak-ng
PIPER="$H/.local/share/radar-play/piper"
if [ ! -x "$PIPER/piper/piper" ] && [ "$(uname -m)" = "aarch64" ]; then
  echo "  · Descargando la voz en español (unos 80 MB)…"
  sudo -u "$U" mkdir -p "$PIPER"
  if sudo -u "$U" bash -c "cd '$PIPER' && timeout 300 wget -q -O piper.tgz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz && tar xzf piper.tgz && rm -f piper.tgz \
      && timeout 300 wget -q -O es_ES-davefx-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx \
      && timeout 120 wget -q -O es_ES-davefx-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json"; then
    bien "Voz en español instalada"
  else
    rm -rf "$PIPER"; echo "  · No se pudo descargar la voz natural: se usará la voz básica"
  fi
fi

paso "3/10 Comprobando que Radar Play arranca"
if sudo -u "$U" bash -c "cd '$APP' && python3 -c 'import puente' " 2>"$APP/datos/logs/prueba-arranque.txt"; then bien "El puente de Radar Play carga sin errores"
else mal "El puente falla al cargar: $(tail -n 3 "$APP/datos/logs/prueba-arranque.txt" | tr '\n' ' ')"; fi

paso "4/10 Permisos de usuario"
for g in dialout gpio video input netdev bluetooth i2c spi audio; do getent group "$g" >/dev/null && usermod -aG "$g" "$U"; done
bien "Grupos: dialout gpio video input bluetooth i2c spi audio"

paso "5/10 Entrar directamente al escritorio al encender"
rc(){ TERM=dumb timeout 60 raspi-config nonint "$@" </dev/null >/dev/null 2>&1; }   # sin ventanas que esperen
if command -v raspi-config >/dev/null; then
  rc do_boot_behaviour B4 || mal "No pude activar el inicio automático (do_boot_behaviour)"
  rc do_wayland W3; rc do_blanking 1; rc do_i2c 0; rc do_spi 0
  bien "Inicio automático, pantalla sin apagarse, I2C y SPI"
else mal "No encuentro raspi-config (¿es Raspberry Pi OS?)"; fi

paso "6/10 Bluetooth y sonido"
BTC=/etc/bluetooth/main.conf
if [ -f "$BTC" ]; then
  copia "$BTC"
  sed -i -E 's/^#?\s*Name\s*=.*/Name = Radar Play/; s/^#?\s*Class\s*=.*/Class = 0x200420/; s/^#?\s*DiscoverableTimeout\s*=.*/DiscoverableTimeout = 120/' "$BTC"
  grep -q '^Class' "$BTC" || sed -i '/^\[General\]/a Class = 0x200420' "$BTC"
  grep -q '^Name' "$BTC" || sed -i '/^\[General\]/a Name = Radar Play' "$BTC"
  bien "La Raspberry aparecerá como «Radar Play»"
fi
cat > /etc/dbus-1/system.d/radar-play-ofono.conf <<EOF2
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><policy user="$U"><allow send_destination="org.ofono"/></policy></busconfig>
EOF2
mkdir -p "$H/.config/wireplumber/bluetooth.lua.d" "$H/.config/wireplumber/wireplumber.conf.d"
cat > "$H/.config/wireplumber/bluetooth.lua.d/80-radar-play.lua" <<'EOF2'
bluez_monitor.properties["bluez5.roles"] = "[ a2dp_sink a2dp_source hfp_hf hsp_hs ]"
bluez_monitor.properties["bluez5.hfphsp-backend"] = "ofono"
EOF2
cat > "$H/.config/wireplumber/wireplumber.conf.d/80-radar-play.conf" <<'EOF2'
monitor.bluez.properties = {
  bluez5.roles = [ a2dp_sink a2dp_source hfp_hf hsp_hs ]
  bluez5.hfphsp-backend = "ofono"
}
EOF2
systemctl enable bluetooth >/dev/null 2>&1
systemctl list-unit-files ofono.service >/dev/null 2>&1 && systemctl enable ofono >/dev/null 2>&1

paso "7/10 Servicio del puente (se reinicia solo si falla)"
SD="$H/.config/systemd/user"
mkdir -p "$SD/default.target.wants"
cat > "$SD/radar-play.service" <<UNIT
[Unit]
Description=Radar Play (web, OBD-II, GPS, sistema)
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=/usr/bin/python3 "$APP/puente.py" --sin-navegador
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
UNIT
ln -sf ../radar-play.service "$SD/default.target.wants/radar-play.service"
loginctl enable-linger "$U" 2>/dev/null || mal "No pude activar el arranque del servicio sin sesión (loginctl)"
bien "Servicio radar-play preparado"

paso "8/10 Radar Play a pantalla completa al arrancar"
mkdir -p "$H/.config/labwc"; copia "$H/.config/labwc/autostart"
# Quita líneas viejas de Radar Play y añade la nueva (respeta lo demás que hubiera)
touch "$H/.config/labwc/autostart"; sed -i '/radar-play\|kiosk\.sh/d' "$H/.config/labwc/autostart"
echo "\"$APP/sistema/kiosk.sh\" &" >> "$H/.config/labwc/autostart"
if [ -f "$H/.config/wayfire.ini" ] && ! grep -q "radarplay" "$H/.config/wayfire.ini"; then
  copia "$H/.config/wayfire.ini"
  if grep -q '^\[autostart\]' "$H/.config/wayfire.ini"; then sed -i "/^\[autostart\]/a radarplay = \"$APP/sistema/kiosk.sh\"" "$H/.config/wayfire.ini"
  else printf '\n[autostart]\nradarplay = "%s/sistema/kiosk.sh"\n' "$APP" >> "$H/.config/wayfire.ini"; fi
fi
mkdir -p "$H/.config/lxsession/LXDE-pi"; copia "$H/.config/lxsession/LXDE-pi/autostart"
echo "@$APP/sistema/kiosk.sh" > "$H/.config/lxsession/LXDE-pi/autostart"
chown -R "$U:$U" "$H/.config"
bien "Arranque automático de la pantalla"

paso "9/10 Permisos para apagar, WiFi y brillo"
cat > /etc/sudoers.d/radar-play <<SUDO
$U ALL=(root) NOPASSWD: /usr/bin/systemctl poweroff, /usr/bin/systemctl reboot, /usr/bin/nmcli, /usr/bin/raspi-config nonint do_overlayfs 0, /usr/bin/raspi-config nonint do_overlayfs 1
SUDO
chmod 440 /etc/sudoers.d/radar-play
visudo -cf /etc/sudoers.d/radar-play >/dev/null || { rm -f /etc/sudoers.d/radar-play; mal "No se pudieron dar los permisos de apagado"; }
cat > /etc/udev/rules.d/90-radar-play.rules <<'UDEV'
# Brillo de la pantalla oficial
SUBSYSTEM=="backlight", RUN+="/bin/chmod 0666 /sys/class/backlight/%k/brightness"
# Adaptador CarPlay Carlinkit
SUBSYSTEM=="usb", ATTR{idVendor}=="1314", ATTR{idProduct}=="152[0-9]", MODE="0666"
UDEV
udevadm control --reload-rules 2>/dev/null
bien "Permisos"

paso "10/10 Arranque silencioso, logo, vigilante y GPS"
CMD="$BOOT/cmdline.txt"; CFG="$BOOT/config.txt"
if [ -f "$CMD" ] && [ -f "$CFG" ]; then
  copia "$CMD"; copia "$CFG"
  L="$(head -n1 "$CMD")"
  L="${L//console=tty1/console=tty3}"
  for t in quiet splash loglevel=3 logo.nologo vt.global_cursor_default=0 plymouth.ignore-serial-consoles; do
    echo " $L " | grep -q " $t " || L="$L $t"
  done
  GIRO="$(grep '^PANTALLA_GIRO=' "$APP/sistema/radar-play.conf" | cut -d= -f2 | tr -d ' \r')"
  L="$(echo "$L" | sed -E 's/ ?video=DSI-1:[^ ]*//')"
  if [ -n "$GIRO" ] && [ "$GIRO" != "0" ]; then L="$L video=DSI-1:720x1280@60,rotate=$GIRO"; fi
  echo "$L" > "$CMD"
  grep -q "^disable_splash=1" "$CFG" || echo "disable_splash=1" >> "$CFG"
  grep -q "^dtparam=watchdog=on" "$CFG" || echo "dtparam=watchdog=on" >> "$CFG"
  bien "Arranque silencioso"
else mal "No encuentro $CMD (¿es Raspberry Pi OS?)"; fi
T=/usr/share/plymouth/themes/pix
if [ -d "$T" ]; then
  copia "$T/splash.png"; cp "$APP/sistema/splash.png" "$T/splash.png"
  command -v plymouth-set-default-theme >/dev/null && plymouth-set-default-theme pix
  command -v update-initramfs >/dev/null && update-initramfs -u >/dev/null 2>&1
  bien "Logo de Radar Play al encender"
fi
mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=15\nRebootWatchdogSec=2min\n' > /etc/systemd/system.conf.d/radar-play-watchdog.conf
GPS="$(grep '^GPS_PUERTO=' "$APP/sistema/radar-play.conf" | cut -d= -f2 | tr -d ' \r')"; GPS="${GPS:-/dev/ttyACM0}"
if [ -d /etc/default ] && command -v gpsd >/dev/null; then
  copia /etc/default/gpsd
  printf 'START_DAEMON="true"\nDEVICES="%s"\nUSBAUTO="false"\nGPSD_OPTIONS="-n"\n' "$GPS" > /etc/default/gpsd
  systemctl enable gpsd.socket >/dev/null 2>&1
  bien "GPS preparado ($GPS)"
fi

cp "$LOGI" "$APP/datos/logs/instalacion.log" 2>/dev/null; chown -R "$U:$U" "$APP/datos"
echo
echo "============================================================"
if [ ${#PROBLEMAS[@]} -eq 0 ]; then
  echo " ✓ Listo, sin problemas. Al reiniciar, la Raspberry arrancará"
  echo "   directamente en Radar Play."
else
  echo " Terminado, pero con ${#PROBLEMAS[@]} problema(s):"
  for p in "${PROBLEMAS[@]}"; do echo "   ✗ $p"; done
  echo " Hazle una foto a esta pantalla o mándame el archivo:"
  echo "   $LOGI"
fi
echo " Radar Play está en: $APP"
echo " Diagnóstico en cualquier momento:  bash ~/radar-play/sistema/diagnostico.sh"
echo " Para quitarlo todo:  sudo bash ~/radar-play/sistema/desinstalar.sh"
echo "============================================================"
[ -n "$RP_SIN_REINICIO" ] && exit 0
read -r -p "¿Reiniciar ahora? [S/n] " R
case "$R" in n|N) echo "Reinicia cuando quieras con: sudo reboot";; *) reboot;; esac
