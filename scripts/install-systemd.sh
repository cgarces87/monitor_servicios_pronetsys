#!/usr/bin/env bash
# ============================================================================
#  Instala el monitor como servicio systemd en Ubuntu 22.04.
#  Compila el TypeScript a dist/ y deja el motor corriendo bajo systemd
#  con reinicio automatico.
#
#  Uso:
#     sudo bash scripts/install-systemd.sh
# ============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
SERVICE_NAME="monitor-pronetsys"
SERVICE_USER="${SERVICE_USER:-www-data}"
NODE_BIN="$(command -v node || true)"

[ "$(id -u)" -eq 0 ] || { echo "Ejecuta con sudo." >&2; exit 1; }
[ -n "$NODE_BIN" ]   || { echo "Node.js no esta en PATH." >&2; exit 1; }
[ -f "$APP_DIR/package.json" ] || { echo "Ejecuta desde la raiz del proyecto." >&2; exit 1; }

echo "[systemd] Compilando TypeScript -> dist/ ..."
cd "$APP_DIR"
npm run build

echo "[systemd] Ajustando permisos para usuario $SERVICE_USER ..."
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
echo "[systemd] Escribiendo unidad en $UNIT_FILE ..."

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Monitor Servicios Pronetsys (motor de chequeo)
Documentation=https://monitor.pronetsys.com.co
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=${NODE_BIN} ${APP_DIR}/dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

# Hardening basico
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo
echo "[OK] Servicio instalado y arrancado."
echo "    Status: systemctl status $SERVICE_NAME"
echo "    Logs:   journalctl -u $SERVICE_NAME -f"
