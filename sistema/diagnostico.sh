#!/bin/bash
# Radar Play · diagnóstico. Uso:  bash ~/radar-play/sistema/diagnostico.sh
# Comprueba lo importante y guarda un informe en datos/logs/diagnostico.txt
# (y lo copia al pendrive si hay uno conectado).
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/datos/logs/diagnostico.txt"; mkdir -p "$DIR/datos/logs"
{
echo "Radar Play · diagnóstico · $(date '+%F %T')"
echo "Equipo: $( (tr -d '\0' </proc/device-tree/model) 2>/dev/null) · $(. /etc/os-release; echo "$PRETTY_NAME") · $(uname -r)"
echo "Carpeta: $DIR · libre: $(df -h "$DIR" | awk 'NR==2{print $4}') · temp: $(vcgencmd measure_temp 2>/dev/null)"
echo
echo "== Programas"
for p in python3 chromium chromium-browser curl gpsd ffmpeg bluetoothctl; do printf '  %-18s %s\n' "$p" "$(command -v $p || echo 'NO')"; done
python3 -c "import serial" 2>/dev/null && echo "  pyserial          ok" || echo "  pyserial          NO"
echo
echo "== Servicio del puente"
systemctl --user is-enabled radar-play 2>&1 | sed 's/^/  activado: /'
systemctl --user is-active radar-play 2>&1 | sed 's/^/  funcionando: /'
P="$(cat "$DIR/datos/puerto" 2>/dev/null || echo 8080)"
if curl -fs --max-time 3 "http://localhost:$P/api/estado" >/dev/null; then echo "  responde en el puerto $P: SÍ"; else echo "  responde en el puerto $P: NO"; fi
echo
echo "== Últimos mensajes del servicio"
journalctl --user -u radar-play -n 25 --no-pager 2>&1 | sed 's/^/  /'
echo
echo "== Prueba de arranque del puente"
( cd "$DIR" && timeout 8 python3 -c "import puente; print('  carga bien')" ) 2>&1 | tail -n 12 | sed 's/^/  /'
echo
echo "== Pantalla a pantalla completa"
grep -h kiosk "$HOME/.config/labwc/autostart" 2>/dev/null | sed 's/^/  labwc: /'
tail -n 5 "$DIR/datos/logs/kiosk.log" 2>/dev/null | sed 's/^/  /'
echo
echo "== Errores y avisos recientes (radar-play.log)"
grep -E " ERROR | WARNING " "$DIR/datos/logs/radar-play.log" 2>/dev/null | tail -n 30 | sed 's/^/  /'
echo
echo "== Final de la instalación"
tail -n 15 "$HOME/radar-play-instalacion.log" 2>/dev/null | sed 's/^/  /'
} > "$OUT" 2>&1
cat "$OUT"
for d in /media/"$USER"/*; do
  [ -d "$d" ] && [ -w "$d" ] && cp "$OUT" "$d/radar-play-diagnostico.txt" && echo && echo "Copiado también al pendrive: $d/radar-play-diagnostico.txt" && break
done
