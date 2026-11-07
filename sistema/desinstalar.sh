#!/bin/bash
# Quita el arranque automático de Radar Play y deja la Raspberry como estaba.
# Uso:  sudo bash sistema/desinstalar.sh
if [ "$(id -u)" -ne 0 ]; then echo "Ejecútalo así:  sudo bash sistema/desinstalar.sh"; exit 1; fi
U="${SUDO_USER:-}"; [ -z "$U" ] && { echo "Ejecútalo con sudo desde tu usuario."; exit 1; }
H="$(getent passwd "$U" | cut -d: -f6)"
BOOT=/boot/firmware; [ -d "$BOOT" ] || BOOT=/boot
vuelve(){ if [ -f "$1.antes-radar-play" ]; then mv -f "$1.antes-radar-play" "$1"; else [ -n "$2" ] && rm -f "$1"; fi; }
vuelve "$H/.config/labwc/autostart" borrar
vuelve "$H/.config/lxsession/LXDE-pi/autostart" borrar
vuelve "$H/.config/wayfire.ini"
vuelve "$BOOT/cmdline.txt"; vuelve "$BOOT/config.txt"
vuelve /usr/share/plymouth/themes/pix/splash.png
vuelve /etc/default/gpsd
rm -f "$H/.config/systemd/user/default.target.wants/radar-play.service" "$H/.config/systemd/user/radar-play.service"
rm -f /etc/sudoers.d/radar-play /etc/udev/rules.d/90-radar-play.rules /etc/systemd/system.conf.d/radar-play-watchdog.conf
command -v update-initramfs >/dev/null && update-initramfs -u >/dev/null 2>&1 || true
echo "Hecho. Radar Play ya no arranca solo. Reinicia con: sudo reboot"
