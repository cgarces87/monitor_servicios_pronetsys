#!/usr/bin/env bash
# ============================================================================
#  Build + publicacion del frontend (Fase 3) en el VPS.
#  Compila el frontend Vite y deja los estaticos en frontend/dist, listos
#  para que Nginx los sirva.
#
#  Uso:
#     bash scripts/deploy-frontend.sh
# ============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
FRONT_DIR="$APP_DIR/frontend"

[ -f "$FRONT_DIR/package.json" ] || { echo "No encuentro frontend/package.json. Ejecuta desde la raiz del proyecto." >&2; exit 1; }

echo "[frontend] Instalando dependencias..."
cd "$FRONT_DIR"
npm install

echo "[frontend] Compilando (vite build)..."
npm run build

echo
echo "[OK] Build generado en $FRONT_DIR/dist"
echo "    Asegurate de que Nginx apunte 'root' a esa carpeta."
echo "    Recargar Nginx:  nginx -t && systemctl reload nginx"
