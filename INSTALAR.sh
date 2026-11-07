#!/bin/bash #
# Radar Play · instalar en la Raspberry Pi #
# En el gestor de archivos abre la carpeta radar-play, pulsa F4 (terminal aquí) y escribe: #
#     sudo bash INSTALAR.sh #
# Funciona aunque esté en el pendrive: se copia sola a tu carpeta personal. #
# (Cada línea acaba en # para que funcione aunque se haya guardado desde Windows.) #
D="$(cd "$(dirname "$0")" && pwd)" #
sed -i 's/\r$//' "$D"/sistema/*.sh "$D"/sistema/radar-play.conf 2>/dev/null #
if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$D/sistema/instalar.sh"; fi #
exec bash "$D/sistema/instalar.sh" #
