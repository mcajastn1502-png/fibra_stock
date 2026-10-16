#!/bin/sh
# Copia el núcleo compartido (configuración, motor y servicio) del backend al frontend (modo demo).
cd "$(dirname "$0")/.."
for f in 00_Config 01_Engine 02_Service; do cp "backend/$f.gs" "frontend/js/core/$f.js"; done
echo "Núcleo sincronizado."
