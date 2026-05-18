#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/yorki}"
BUILD_HEAP_MB="${BUILD_HEAP_MB:-4096}"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-${APP_DIR}/scripts/predeploy-backup.sh}"
HEALTHCHECK_SCRIPT="${HEALTHCHECK_SCRIPT:-${APP_DIR}/scripts/healthcheck.sh}"
ROLLBACK_SCRIPT="${ROLLBACK_SCRIPT:-${APP_DIR}/scripts/rollback.sh}"
SW_PATH="${SW_PATH:-${APP_DIR}/public/sw.js}"

cd "${APP_DIR}"

echo "[deploy] Step 1/7: predeploy backup"
"${BACKUP_SCRIPT}"

echo "[deploy] Step 2/7: stop service"
systemctl stop yorki || true
systemctl reset-failed yorki || true

echo "[deploy] Step 3/7: install deps"
npm ci --ignore-scripts
npm rebuild better-sqlite3

echo "[deploy] Step 4/7: build"
rm -rf .next
NODE_OPTIONS="--max-old-space-size=${BUILD_HEAP_MB}" npm run build

echo "[deploy] Step 5/7: cache-bust service worker"
if [[ -f "${SW_PATH}" ]]; then
  tmpfile="$(mktemp)"
  {
    printf "/* yorki-release %s */\n" "$(date -u +%Y%m%d-%H%M%S)"
    cat "${SW_PATH}"
  } > "${tmpfile}"
  mv "${tmpfile}" "${SW_PATH}"
else
  echo "[deploy] WARN: ${SW_PATH} not found, skipping service worker cache-bust"
fi

echo "[deploy] Step 6/7: start service"
systemctl start yorki
sleep 2

echo "[deploy] Step 7/7: healthcheck"
if ! "${HEALTHCHECK_SCRIPT}"; then
  echo "[deploy] healthcheck failed, rolling back"
  "${ROLLBACK_SCRIPT}" latest
  exit 1
fi

echo "[deploy] SUCCESS"
