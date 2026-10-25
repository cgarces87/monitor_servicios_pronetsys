#!/usr/bin/env bash
# ============================================================================
#  Auditoria de seguridad del VPS (SOLO LECTURA: no instala ni cambia nada).
#
#  Compara las versiones instaladas contra los parches de los ultimos CVE:
#    - PHP     CVE-2026-109618 / CVE-2026-109619 (RCE sin autenticacion, 21-oct-2026)
#              -> 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12
#    - HestiaCP CVE-2026-108390 / CVE-2026-111627 -> 1.10.5
#              CVE-2026-43633 (RCE web terminal) -> 1.9.0-1.9.4 vulnerables
#    - Node.js 21-oct-2026 (Brotli RCE CVE-2026-111497 y 6 mas en 22.x)
#              -> 22.23.4 / 24.22.1 / 26.12.1
#    - Python  1-oct-2026 (tarfile/zipfile/ssl) -> 3.10.22 / 3.11.17 / 3.12.15 /
#              3.13.16 / 3.14.8. OJO: el python3 de Ubuntu recibe los parches
#              por apt SIN cambiar el numero de version; por eso para el
#              Python del sistema se revisan las actualizaciones pendientes.
#
#  Uso (como root en el VPS):
#     bash scripts/auditoria-seguridad.sh
#
#  Sale con codigo 1 si encuentra algun FALLO.
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

FALLOS=0
AVISOS=0
ok()    { printf '  \033[1;32m[OK]\033[0m    %s\n' "$*"; }
aviso() { printf '  \033[1;33m[AVISO]\033[0m %s\n' "$*"; AVISOS=$((AVISOS + 1)); }
fallo() { printf '  \033[1;31m[FALLO]\033[0m %s\n' "$*"; FALLOS=$((FALLOS + 1)); }
info()  { printf '  %s\n' "$*"; }
titulo(){ printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }

# version_ge A B -> verdadero si A >= B (orden de versiones de Debian).
version_ge() { dpkg --compare-versions "$1" ge "$2"; }

# Minimo parcheado por rama "X.Y" (vacio = rama sin soporte).
minimo_php() {
  case "$1" in
    8.2) echo 8.2.35 ;; 8.3) echo 8.3.36 ;; 8.4) echo 8.4.27 ;; 8.5) echo 8.5.12 ;;
    *) echo "" ;;
  esac
}
minimo_python() {
  case "$1" in
    3.10) echo 3.10.22 ;; 3.11) echo 3.11.17 ;; 3.12) echo 3.12.15 ;;
    3.13) echo 3.13.16 ;; 3.14) echo 3.14.8 ;; *) echo "" ;;
  esac
}
minimo_node() {
  case "$1" in
    22) echo 22.23.4 ;; 24) echo 24.22.1 ;; 26) echo 26.12.1 ;; *) echo "" ;;
  esac
}

# Paquetes con actualizacion pendiente (simulacion, no instala nada).
PENDIENTES="$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | awk '/^Inst /{print $2}')"
pendiente() { grep -E "$1" <<<"$PENDIENTES" | tr '\n' ' '; }

# ---------------------------------------------------------------------------
titulo "Sistema"
info "Host: $(hostname)  |  $(. /etc/os-release && echo "$PRETTY_NAME")  |  kernel $(uname -r)"
NSEG="$(apt-get -s -o Debug::NoLocking=1 dist-upgrade 2>/dev/null | grep -c '^Inst .*security')"
if [ "${NSEG:-0}" -gt 0 ]; then
  fallo "$NSEG paquetes con actualizacion de SEGURIDAD pendiente (apt update && apt upgrade)."
else
  ok "Sin actualizaciones de seguridad pendientes (segun el ultimo apt update)."
fi
[ -f /var/run/reboot-required ] && aviso "El sistema pide reinicio: $(tr '\n' ' ' < /var/run/reboot-required.pkgs 2>/dev/null)"
if systemctl is-enabled --quiet unattended-upgrades 2>/dev/null; then
  ok "unattended-upgrades habilitado."
else
  aviso "unattended-upgrades no esta habilitado (parches de seguridad automaticos)."
fi

# ---------------------------------------------------------------------------
titulo "HestiaCP"
HESTIA_CONF=/usr/local/hestia/conf/hestia.conf
if [ -f "$HESTIA_CONF" ]; then
  HV="$(dpkg-query -W -f='${Version}' hestia 2>/dev/null || grep -oP "^VERSION='\K[^']+" "$HESTIA_CONF")"
  if version_ge "$HV" 1.10.5; then
    ok "HestiaCP $HV (>= 1.10.5)."
  else
    fallo "HestiaCP $HV < 1.10.5 (CVE-2026-108390 RCE root, CVE-2026-111627). Ejecuta: apt update && apt upgrade hestia"
  fi
  if version_ge "$HV" 1.9.0 && ! version_ge "$HV" 1.9.5 && grep -q "^WEB_TERMINAL='true'" "$HESTIA_CONF"; then
    fallo "Web terminal ACTIVO en HestiaCP $HV (CVE-2026-43633, RCE sin autenticacion)."
  fi
  if [ -x /usr/local/hestia/php/bin/php ]; then
    HPV="$(/usr/local/hestia/php/bin/php -r 'echo PHP_VERSION;' 2>/dev/null)"
    HMIN="$(minimo_php "${HPV%.*}")"
    if [ -n "$HMIN" ] && version_ge "$HPV" "$HMIN"; then
      ok "PHP interno del panel (hestia-php) $HPV."
    else
      fallo "PHP interno del panel (hestia-php) $HPV sin el parche del 21-oct (minimo ${HMIN:-rama sin soporte}). Actualiza el paquete hestia-php cuando Hestia lo publique y, mientras, restringe el puerto del panel por IP."
    fi
  fi
else
  info "HestiaCP no detectado en este servidor."
fi

# ---------------------------------------------------------------------------
titulo "PHP (sitios / PHP-FPM)"
PHPS="$(ls /usr/bin/php[0-9].[0-9] 2>/dev/null)"
if [ -z "$PHPS" ] && command -v php >/dev/null 2>&1; then PHPS="$(command -v php)"; fi
if [ -z "$PHPS" ]; then
  info "PHP no instalado."
fi
for BIN in $PHPS; do
  V="$("$BIN" -r 'echo PHP_VERSION;' 2>/dev/null)" || continue
  RAMA="${V%.*}"
  MIN="$(minimo_php "$RAMA")"
  if [ -z "$MIN" ]; then
    fallo "PHP $V: rama sin soporte upstream (sin parche para CVE-2026-109618/109619). Migra los sitios a 8.3+."
  elif version_ge "$V" "$MIN"; then
    ok "PHP $V (>= $MIN)."
  else
    fallo "PHP $V < $MIN: vulnerable a CVE-2026-109618/109619 (RCE). apt update && apt install --only-upgrade 'php$RAMA*'"
  fi

  INI="/etc/php/$RAMA/fpm/php.ini"
  if [ -f "$INI" ]; then
    UP="$(grep -E '^\s*session\.upload_progress\.enabled' "$INI" | tail -1 | awk -F= '{gsub(/ /,"",$2); print $2}')"
    if [ -n "$MIN" ] && ! version_ge "$V" "$MIN" && [ "${UP:-On}" != "0" ] && [ "${UP:-On}" != "Off" ]; then
      aviso "  mitigacion pendiente en $INI: session.upload_progress.enabled = 0 (y reiniciar php$RAMA-fpm)."
    fi
  fi

  # FPM reiniciado despues de actualizar? (los workers viejos siguen vulnerables)
  # (dpkg conserva la fecha de compilacion en el binario; la de instalacion
  # queda en su .list).
  LISTA="/var/lib/dpkg/info/php$RAMA-fpm.list"
  if [ -f "$LISTA" ] && systemctl is-active --quiet "php$RAMA-fpm" 2>/dev/null; then
    INICIO="$(date -d "$(systemctl show -p ActiveEnterTimestamp --value "php$RAMA-fpm")" +%s 2>/dev/null || echo 0)"
    if [ "$(stat -c %Y "$LISTA")" -gt "$INICIO" ]; then
      fallo "  php$RAMA-fpm corre con el binario ANTERIOR a la actualizacion: systemctl restart php$RAMA-fpm"
    fi
  fi
done

# ---------------------------------------------------------------------------
titulo "Python"
for BIN in /usr/bin/python3.[0-9]* /usr/local/bin/python3.[0-9]*; do
  [ -x "$BIN" ] || continue
  case "$BIN" in *-config) continue ;; esac
  V="$("$BIN" -c 'import platform; print(platform.python_version())' 2>/dev/null)" || continue
  RAMA="$(cut -d. -f1,2 <<<"$V")"
  if [ "${BIN#/usr/local/}" != "$BIN" ]; then
    # Compilado a mano: no recibe parches de apt, se compara contra upstream.
    MIN="$(minimo_python "$RAMA")"
    if [ -n "$MIN" ] && version_ge "$V" "$MIN"; then ok "$BIN $V."
    else fallo "$BIN $V compilado a mano, sin parches del 1-oct-2026 (minimo ${MIN:-rama sin soporte})."; fi
  else
    PEND="$(pendiente "^(lib)?python$RAMA")"
    if [ -n "$PEND" ]; then
      fallo "$BIN $V (Ubuntu) con parches pendientes: $PEND"
    else
      ok "$BIN $V (paquete de Ubuntu al dia; los parches se aplican sin cambiar el numero)."
    fi
  fi
done
command -v snap >/dev/null 2>&1 && snap list certbot >/dev/null 2>&1 \
  && info "certbot via snap trae su propio Python: snap refresh certbot"

# ---------------------------------------------------------------------------
titulo "Node.js (motor del monitor)"
if command -v node >/dev/null 2>&1; then
  V="$(node -p process.versions.node)"
  MIN="$(minimo_node "${V%%.*}")"
  if [ -z "$MIN" ]; then
    fallo "Node $V: rama sin soporte (EOL). Instala Node 22 LTS."
  elif version_ge "$V" "$MIN"; then
    ok "Node $V (>= $MIN)."
  else
    fallo "Node $V < $MIN: vulnerable al Brotli RCE CVE-2026-111497 y otros. Actualiza (NodeSource: apt update && apt install --only-upgrade nodejs) y systemctl restart monitor-pronetsys"
  fi
else
  aviso "Node no esta en PATH."
fi

# ---------------------------------------------------------------------------
titulo "Nginx / OpenSSL / PostgreSQL"
command -v nginx >/dev/null 2>&1 && info "$(nginx -v 2>&1)"
info "$(openssl version 2>/dev/null)"
command -v psql >/dev/null 2>&1 && info "$(psql --version)"
PEND="$(pendiente '^(nginx|openssl|libssl|postgresql)')"
if [ -n "$PEND" ]; then fallo "Parches pendientes: $PEND"; else ok "nginx/openssl/postgresql sin parches pendientes."; fi

# ---------------------------------------------------------------------------
titulo "Dependencias npm del monitor"
if [ -f "$APP_DIR/package-lock.json" ]; then
  for DIR in "$APP_DIR" "$APP_DIR/frontend"; do
    [ -f "$DIR/package-lock.json" ] || continue
    RES="$(cd "$DIR" && npm audit --omit=dev --json 2>/dev/null | node -e '
      let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
        try { const m = JSON.parse(d).metadata.vulnerabilities; console.log(`${m.critical} ${m.high} ${m.moderate}`); }
        catch { console.log("? ? ?"); }
      });')"
    read -r CRIT HIGH MOD <<<"$RES"
    if [ "$CRIT" = "?" ]; then aviso "$DIR: no se pudo ejecutar npm audit (sin red?)."
    elif [ "$CRIT" -gt 0 ] || [ "$HIGH" -gt 0 ]; then fallo "$DIR: $CRIT criticas, $HIGH altas (npm audit --omit=dev)."
    else ok "$DIR: sin vulnerabilidades criticas/altas ($MOD moderadas)."; fi
  done
else
  aviso "No hay package-lock.json en $APP_DIR (despliega la ultima version del repo)."
fi

# ---------------------------------------------------------------------------
titulo "Puertos expuestos a Internet"
while read -r DIR PROC; do
  case "$DIR" in 127.*|\[::1\]*|localhost*) continue ;; esac
  PUERTO="${DIR##*:}"
  case "$PUERTO" in
    5432|3306|6379|3000|2785|27017) fallo "Puerto $PUERTO escuchando en $DIR ($PROC): deberia ser solo 127.0.0.1 o filtrado por firewall." ;;
    *) info "$DIR  $PROC" ;;
  esac
done < <(ss -Htlnp 2>/dev/null | awk '{print $4, $6}')

# ---------------------------------------------------------------------------
titulo "Resumen"
if [ "$FALLOS" -gt 0 ]; then
  printf '  \033[1;31m%d fallo(s)\033[0m, %d aviso(s).\n' "$FALLOS" "$AVISOS"
  exit 1
fi
printf '  \033[1;32mSin fallos\033[0m, %d aviso(s).\n' "$AVISOS"
