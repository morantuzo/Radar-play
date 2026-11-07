#!/bin/bash
# Radar Play · abre el escritorio normal de la Raspberry (fondo, barra, menú)
# Se usa al salir de Radar Play. También a mano:  bash ~/radar-play/sistema/escritorio.sh
pgrep -f "wf-panel-pi|lxpanel" >/dev/null && { echo "El escritorio ya está abierto"; exit 0; }
S=/etc/xdg/labwc/autostart
if [ -n "$WAYLAND_DISPLAY" ] && [ -f "$S" ]; then
  # Lo mismo que arranca Raspberry Pi OS normalmente (sin Radar Play)
  grep -vE 'kiosk\.sh|radar-play|^\s*#|^\s*$' "$S" | while read -r l; do
    ( eval "${l%&}" >/dev/null 2>&1 & )
  done
else
  ( command -v pcmanfm-pi >/dev/null && pcmanfm-pi || pcmanfm --desktop --profile LXDE-pi ) >/dev/null 2>&1 &
  command -v wf-panel-pi >/dev/null && wf-panel-pi >/dev/null 2>&1 &
  command -v lxpanel >/dev/null && [ -n "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ] && lxpanel --profile LXDE-pi >/dev/null 2>&1 &
fi
echo "Escritorio abierto"
