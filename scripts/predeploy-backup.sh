#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/yorki}"
DB_DIR="${DB_DIR:-/var/lib/yorki}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/yorki}"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
TARGET_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

mkdir -p "${TARGET_DIR}"

if [[ ! -f "${DB_DIR}/yorki.db" ]]; then
  echo "ERROR: DB not found at ${DB_DIR}/yorki.db"
  exit 1
fi

echo "[backup] Writing snapshot to ${TARGET_DIR}"

# Consistent SQLite snapshot without stopping the app.
sqlite3 "${DB_DIR}/yorki.db" ".backup '${TARGET_DIR}/yorki.db'"

cp -a "${DB_DIR}/yorki.db-wal" "${TARGET_DIR}/" 2>/dev/null || true
cp -a "${DB_DIR}/yorki.db-shm" "${TARGET_DIR}/" 2>/dev/null || true

cp -a "${APP_DIR}/.env" "${TARGET_DIR}/.env" 2>/dev/null || true
cp -a /etc/systemd/system/yorki.service "${TARGET_DIR}/yorki.service" 2>/dev/null || true
cp -a /etc/nginx/sites-enabled/yorki "${TARGET_DIR}/nginx-yorki.conf" 2>/dev/null || true

tar \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='data' \
  --exclude='.git' \
  -czf "${TARGET_DIR}/app-src.tgz" \
  -C "${APP_DIR}" .

echo "${TARGET_DIR}" > "${BACKUP_ROOT}/LATEST"
echo "[backup] Complete"
echo "[backup] Latest: ${TARGET_DIR}"
