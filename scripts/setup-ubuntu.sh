#!/usr/bin/env bash
# ============================================================================
#  Monitor Servicios Pronetsys — Bootstrap para Ubuntu 22.04 LTS
# ----------------------------------------------------------------------------
#  Instala Node.js 20 LTS + PostgreSQL 14, crea la base de datos, instala
#  las dependencias npm y aplica la migracion inicial de Prisma.
#
#  Uso:
#     sudo bash scripts/setup-ubuntu.sh
#
#  El script es idempotente: puedes correrlo dos veces sin romper nada.
# ============================================================================

set -euo pipefail

# ----- Parametros (puedes sobreescribir via variables de entorno) -----------
DB_NAME="${DB_NAME:-monitor_pronetsys}"
DB_USER="${DB_USER:-monitor}"
DB_PASS="${DB_PASS:-$(openssl rand -hex 16)}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
NODE_MAJOR="${NODE_MAJOR:-20}"
APP_DIR="${APP_DIR:-$(pwd)}"

# ----- Helpers --------------------------------------------------------------
log()  { printf '\n\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\n\033[1;33m[setup]\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31m[setup]\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "Ejecuta este script como root o con sudo."
  fi
}

# ----- 0. Validaciones ------------------------------------------------------
require_root

if ! grep -qi 'ubuntu' /etc/os-release; then
  warn "Este script se diseno para Ubuntu. Continuando bajo tu responsabilidad."
fi

if [ ! -f "$APP_DIR/package.json" ] || [ ! -f "$APP_DIR/prisma/schema.prisma" ]; then
  fail "No encuentro package.json ni prisma/schema.prisma en $APP_DIR. Ejecuta el script desde la raiz del proyecto."
fi

# ----- 1. Paquetes base -----------------------------------------------------
log "Actualizando indices apt e instalando paquetes base..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg lsb-release ufw build-essential openssl

# ----- 2. Node.js 20 LTS (via NodeSource) -----------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  log "Instalando Node.js $NODE_MAJOR LTS desde NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
else
  log "Node.js ya instalado: $(node -v)"
fi

# ----- 3. PostgreSQL --------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "Instalando PostgreSQL..."
  apt-get install -y postgresql postgresql-contrib
  systemctl enable --now postgresql
else
  log "PostgreSQL ya instalado: $(psql --version)"
fi

# ----- 4. Crear usuario y base de datos (idempotente) -----------------------
log "Verificando usuario y base de datos PostgreSQL..."

USER_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'")
if [ "$USER_EXISTS" != "1" ]; then
  log "Creando rol '${DB_USER}' (con CREATEDB para la shadow DB de Prisma)..."
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN CREATEDB PASSWORD '${DB_PASS}';"
else
  warn "Rol '${DB_USER}' ya existia. Conservo su password actual (no la sobreescribo)."
  # Aseguramos CREATEDB aunque el rol ya existiera: 'prisma migrate dev'
  # necesita crear una shadow database temporal o falla con P3014.
  sudo -u postgres psql -c "ALTER ROLE ${DB_USER} CREATEDB;"
  DB_PASS=""  # no la conocemos; el usuario debera ponerla manualmente en .env
fi

DB_EXISTS=$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")
if [ "$DB_EXISTS" != "1" ]; then
  log "Creando base de datos '${DB_NAME}' (owner: ${DB_USER})..."
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
else
  log "Base de datos '${DB_NAME}' ya existia."
fi

# ----- 5. Archivo .env ------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Generando $ENV_FILE a partir de .env.example..."
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  if [ -n "$DB_PASS" ]; then
    DB_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public"
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=\"${DB_URL}\"|" "$ENV_FILE"
    log "DATABASE_URL escrita en .env"
  else
    warn "Rol pre-existente: edita $ENV_FILE y completa el DATABASE_URL manualmente."
  fi
else
  warn ".env ya existe. No lo sobreescribo."
fi

# ----- 6. Dependencias npm y migracion --------------------------------------
log "Instalando dependencias npm..."
cd "$APP_DIR"
npm install

log "Generando cliente Prisma..."
npx prisma generate

if [ -d "$APP_DIR/prisma/migrations" ] && [ -n "$(ls -A "$APP_DIR/prisma/migrations" 2>/dev/null)" ]; then
  log "Aplicando migraciones existentes (prisma migrate deploy)..."
  npx prisma migrate deploy
else
  log "Creando migracion inicial (prisma migrate dev --name init)..."
  npx prisma migrate dev --name init
fi

# Verificacion final: las tablas deben existir
log "Verificando que las tablas se crearon..."
TABLAS=$(sudo -u postgres psql -d "${DB_NAME}" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('services','logs','incidents')")
if [ "$TABLAS" -lt "3" ]; then
  fail "Las tablas no se crearon (encontradas: $TABLAS de 3). Revisa la salida de Prisma arriba."
fi
log "OK: 3 tablas encontradas en public (services, logs, incidents)."

# ----- 7. Resumen final -----------------------------------------------------
cat <<EOF

============================================================================
 [OK] Bootstrap completado.
----------------------------------------------------------------------------
 Base de datos: ${DB_NAME}  (rol: ${DB_USER}, host: ${DB_HOST}:${DB_PORT})
 App dir:       ${APP_DIR}
 .env:          ${ENV_FILE}

 Para correr en primer plano (pruebas):
     cd ${APP_DIR} && npm run dev

 Para correr como servicio del sistema (recomendado en VPS):
     bash scripts/install-systemd.sh

 Para inspeccionar la BD desde el navegador (tunel SSH):
     npm run prisma:studio
============================================================================
EOF
