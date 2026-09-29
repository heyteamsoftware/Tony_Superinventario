#!/usr/bin/env bash
# Actualiza el Superinventario en el servidor con la última versión de GitHub.
#   sudo bash /var/www/html/Tony_Superinventario/deploy/actualizar.sh
set -euo pipefail

APP=/var/www/html/Tony_Superinventario
DATOS=/var/lib/tony-superinventario
SERVICIO=tony-superinventario
export DB_PATH="$DATOS/inventario.db"

cd "$APP"
echo "· Descargando cambios…"
sudo -u www-data git pull --ff-only

echo "· Instalando dependencias…"
sudo -u www-data HOME=/tmp npm ci --omit=dev --no-audit --no-fund

if [ -f "$DB_PATH" ]; then
  echo "· Copia de seguridad previa…"
  sudo -u www-data /usr/local/bin/node scripts/copia.js
fi

echo "· Reiniciando el servicio…"
systemctl restart "$SERVICIO"
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3100/api/meta >/dev/null 2>&1; then
    echo "✔ Superinventario actualizado ($(sudo -u www-data git log -1 --format='%h %s'))"
    exit 0
  fi
  sleep 1
done
echo "✖ El servicio no responde. Revisa: journalctl -u $SERVICIO -n 50" >&2
exit 1
