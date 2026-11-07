#!/bin/bash
# Radar Play a pantalla completa. Si el navegador se cierra o falla, vuelve a abrirse.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PERFIL="$HOME/.config/radar-play-chromium"
SALIR="$HOME/.radar-play-escritorio"
rm -f "$SALIR"                       # cada arranque vuelve al modo coche
NAV="$(command -v chromium || command -v chromium-browser)"
CONF="$DIR/sistema/radar-play.conf"
val(){ grep -E "^$1=" "$CONF" 2>/dev/null | tail -n1 | cut -d= -f2 | tr -d ' \r'; }
GIRO="$(val PANTALLA_GIRO)"; GIRO="${GIRO:-0}"
ESCALA="$(val PANTALLA_ESCALA)"; ESCALA="${ESCALA:-1}"

# Girar la pantalla (p. ej. la Touch Display 2, que viene en vertical)
if [ "$GIRO" != "0" ] && command -v wlr-randr >/dev/null && [ -n "$WAYLAND_DISPLAY" ]; then
  OUT="$(wlr-randr 2>/dev/null | awk '/^[A-Za-z]/{print $1}' | grep -m1 DSI)"
  [ -z "$OUT" ] && OUT="$(wlr-randr 2>/dev/null | awk '/^[A-Za-z]/{print $1; exit}')"
  [ -n "$OUT" ] && wlr-randr --output "$OUT" --transform "$GIRO" >/dev/null 2>&1
  sleep 1
fi

# Esperar a que el puente esté listo (máximo 40 s)
for _ in $(seq 1 80); do
  P="$(cat "$DIR/datos/puerto" 2>/dev/null || echo 8080)"
  curl -fs "http://localhost:$P/api/estado" >/dev/null 2>&1 && break
  sleep 0.5
done

LOGD="$DIR/datos/logs"; mkdir -p "$LOGD"; LOGC="$LOGD/chromium.log"

# Si el puente no arranca, en vez de «No se puede acceder» sale una página con el motivo
pagina_fallo(){
  local F="$DIR/datos/fallo.html" J E
  J="$(journalctl --user -u radar-play -n 30 --no-pager 2>&1 | sed 's/&/\&amp;/g; s/</\&lt;/g')"
  E="$(grep -E " ERROR | WARNING " "$LOGD/radar-play.log" 2>/dev/null | tail -n 12 | sed 's/&/\&amp;/g; s/</\&lt;/g')"
  cat > "$F" <<HTML
<!doctype html><html lang="es"><meta charset="utf-8"><title>Radar Play</title>
<style>body{margin:0;background:#06080b;color:#f1f4f7;font:17px/1.45 system-ui,sans-serif;padding:28px 36px}h1{margin:0 0 6px;font-size:30px}
p{color:#9aa3ae;margin:4px 0 14px}pre{background:#13171d;border-radius:12px;padding:12px 14px;font-size:12.5px;white-space:pre-wrap;max-height:38vh;overflow:auto;color:#c9d1d9}b{color:#ffb020}</style>
<h1>Radar Play no ha podido arrancar</h1>
<p>Lo reintento solo cada pocos segundos. Si sigue así, hazle una foto a esta pantalla y mándamela, o ejecuta <b>bash ~/radar-play/sistema/diagnostico.sh</b>.</p>
<p id="st">Esperando al puente en el puerto $P…</p>
<pre>$J</pre>${E:+<p>Errores recientes:</p><pre>$E</pre>}
<script>setInterval(()=>fetch('http://localhost:$P/api/estado',{mode:'no-cors',cache:'no-store'}).then(()=>{document.getElementById('st').textContent='¡Ya responde! Abriendo…';location.href='http://localhost:$P/radar-play-google.html?kiosk=1';}).catch(()=>{}),4000);</script></html>
HTML
  echo "file://$F"
}
# El log del navegador no crece sin fin: si pasa de 2 MB se guarda uno anterior
[ -f "$LOGC" ] && [ "$(stat -c %s "$LOGC" 2>/dev/null || echo 0)" -gt 2000000 ] && mv -f "$LOGC" "$LOGC.1"
echo "$(date '+%F %T') kiosk: arranca (giro $GIRO, escala $ESCALA, puerto $P)" >> "$LOGD/kiosk.log"
while [ ! -f "$SALIR" ]; do
  P="$(cat "$DIR/datos/puerto" 2>/dev/null || echo 8080)"
  if curl -fs --max-time 3 "http://localhost:$P/api/estado" >/dev/null 2>&1; then URL="http://localhost:$P/radar-play-google.html?kiosk=1"
  else URL="$(pagina_fallo)"; echo "$(date '+%F %T') kiosk: el puente no responde, muestro la página de fallo" >> "$LOGD/kiosk.log"; fi
  P="$(cat "$DIR/datos/puerto" 2>/dev/null || echo 8080)"
  # Evita el aviso de "Chromium no se cerró correctamente" tras un corte de corriente
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PERFIL/Default/Preferences" 2>/dev/null
  "$NAV" --kiosk --lang=es-ES --user-data-dir="$PERFIL" \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble --no-first-run \
    --password-store=basic --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream --disable-pinch --overscroll-history-navigation=0 \
    --ignore-gpu-blocklist --enable-gpu-rasterization --check-for-update-interval=31536000 --disable-features=Translate \
    --ozone-platform-hint=auto --force-device-scale-factor="$ESCALA" \
    "$URL" >>"$LOGC" 2>&1
  echo "$(date '+%F %T') kiosk: Chromium se ha cerrado (código $?)" >> "$LOGD/kiosk.log"
  [ -f "$SALIR" ] && break
  sleep 2
done

# Modo escritorio (mantenimiento): hasta el próximo arranque
bash "$DIR/sistema/escritorio.sh" >/dev/null 2>&1
