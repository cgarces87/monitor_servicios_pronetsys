#!/usr/bin/env bash
# ============================================================================
#  Despliegue en el VPS basado en git pull.
#
#  Workflow esperado:
#     [Windows]   git push origin main
#     [VPS]       bash /opt/monitor_servicios_pronetsys/scripts/deploy-desde-git.sh
#
#  Que hace, en orden:
#    1) git fetch + reset --hard origin/main   (descarta cambios sin commit)
#    2) npm install                            (idempotente)
#    3) prisma migrate deploy                  (aplica migraciones pendientes)
#    4) npm run build                          (backend)
#    5) bash scripts/deploy-frontend.sh        (vite build)
#    6) systemctl restart monitor-pronetsys    (reinicia backend)
#
#  Nota: .env esta en .gitignore, asi que el reset --hard NO lo toca.
# ============================================================================

set -euo pipefail

# Detectamos la raiz del proyecto a partir de la ubicacion del script
# (../ desde scripts/), asi puede ejecutarse desde cualquier cwd. APP_DIR
# se puede sobreescribir por env var si hace falta apuntar a otra ruta.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RAMA="${RAMA:-main}"
SERVICIO="${SERVICIO:-monitor-pronetsys}"

[ -f "$APP_DIR/package.json" ] || { echo "No encuentro package.json en $APP_DIR. Ejecuta desde la raiz del proyecto." >&2; exit 1; }
[ -d "$APP_DIR/.git" ]         || { echo "$APP_DIR no es un repo git. Clonalo primero." >&2; exit 1; }

cd "$APP_DIR"

echo "[1/6] git fetch + reset --hard origin/$RAMA ..."
git fetch --prune origin
git reset --hard "origin/$RAMA"
echo "    HEAD ahora en: $(git log -1 --oneline)"

echo "[2/6] npm install ..."
npm install --no-audit --no-fund

echo "[3/6] prisma migrate deploy ..."
npx prisma migrate deploy

echo "[4/6] npm run build (backend) ..."
npm run build

echo "[5/6] vite build (frontend) ..."
bash scripts/deploy-frontend.sh

echo "[6/6] systemctl restart $SERVICIO ..."
systemctl restart "$SERVICIO"
systemctl --no-pager --lines=5 status "$SERVICIO" || true

echo
echo "[OK] Despliegue completado."
