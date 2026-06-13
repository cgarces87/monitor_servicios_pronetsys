#!/usr/bin/env bash
# ============================================================================
#  Auto-deploy poller: cron en el VPS lo llama cada N min.
#
#  Si hay commits nuevos en origin/main, dispara scripts/deploy-desde-git.sh.
#  Si no, sale silencioso (nada de spam en /var/log/syslog ni en mail de cron).
#
#  Instalacion (una sola vez, como root en el VPS):
#     crontab -l 2>/dev/null | grep -v auto-pull.sh > /tmp/cron.tmp
#     echo "*/2 * * * * /opt/monitor_servicios_pronetsys/scripts/auto-pull.sh" >> /tmp/cron.tmp
#     crontab /tmp/cron.tmp && rm /tmp/cron.tmp
#
#  Ver actividad:
#     tail -f /var/log/monitor-pronetsys-auto-deploy.log
# ============================================================================

set -euo pipefail

# Cron arranca con PATH minimo. Aseguramos node/npm via PATH estandar +
# nvm si existe (cubrimos los dos modos de instalacion mas comunes).
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RAMA="${RAMA:-main}"
LOG="${LOG:-/var/log/monitor-pronetsys-auto-deploy.log}"
LOCK="/tmp/monitor-pronetsys-auto-deploy.lock"

# Anti-solape: si ya hay un deploy corriendo (npm install puede tardar >2 min),
# el siguiente tick del cron sale sin hacer nada.
exec 9>"$LOCK"
if ! flock -n 9; then
  exit 0
fi

cd "$APP_DIR"

git fetch --quiet origin "$RAMA"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$RAMA")"

# Misma punta -> nada que hacer.
[ "$LOCAL" = "$REMOTE" ] && exit 0

# Hay commits nuevos: deploy completo y al log.
{
  echo
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') Nuevos commits detectados ====="
  echo "  LOCAL=$LOCAL"
  echo "  REMOTE=$REMOTE"
  bash "$SCRIPT_DIR/deploy-desde-git.sh"
} >>"$LOG" 2>&1
