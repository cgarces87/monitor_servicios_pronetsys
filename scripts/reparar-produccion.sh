#!/usr/bin/env bash
# ============================================================================
#  Reparacion del .env de produccion tras un deploy que lo sobrescribio.
#  - Resetea el password del rol de BD "monitor" a uno nuevo.
#  - Fija DATABASE_URL, AUTH_JWT_SECRET y demas variables criticas en .env
#    SIN tocar las lineas de GLPI_* / WHATSAPP_* que ya existieran.
#  - Aplica migraciones, compila, (re)crea el admin y reinicia el servicio.
#
#  Uso (en el VPS, dentro de /opt/monitor_servicios_pronetsys):
#     bash scripts/reparar-produccion.sh
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME="monitor_pronetsys"
DB_USER="monitor"

DBPASS="$(openssl rand -hex 16)"
JWT="$(openssl rand -hex 32)"
ADMINPASS="$(openssl rand -hex 6)"

echo "[1/6] Reseteando password del rol de BD '${DB_USER}'..."
sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${DBPASS}';"

echo "[2/6] Fijando variables criticas en .env (preserva GLPI_*/WHATSAPP_*)..."
touch .env
set_env() { sed -i "/^$1=/d" .env; printf '%s="%s"\n' "$1" "$2" >> .env; }
set_env DATABASE_URL "postgresql://${DB_USER}:${DBPASS}@localhost:5432/${DB_NAME}?schema=public"
set_env AUTH_JWT_SECRET "${JWT}"
set_env AUTH_COOKIE_SECURE "true"
set_env API_ENABLED "true"
set_env API_PORT "3000"
set_env API_HOST "127.0.0.1"

echo "[3/6] Generando cliente Prisma y aplicando migraciones..."
npx prisma generate
npx prisma migrate deploy

echo "[4/6] Compilando backend..."
npm run build

echo "[5/6] (Re)creando usuario admin con password temporal..."
npm run user:create -- admin "${ADMINPASS}" admin

echo "[6/6] Reiniciando servicio..."
systemctl restart monitor-pronetsys
sleep 2
CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/health || echo 000)"

echo
echo "============================================================"
echo " API /api/health -> HTTP ${CODE}   (esperado: 200)"
echo " Usuario:  admin"
echo " Password temporal:  ${ADMINPASS}"
echo " (cambiala luego desde el panel: menu Usuarios)"
echo "============================================================"
[ "$CODE" = "200" ] && echo "[OK] Servicio arriba." || { echo "[FALLO] Revisa: journalctl -u monitor-pronetsys -n 30 --no-pager"; exit 1; }
