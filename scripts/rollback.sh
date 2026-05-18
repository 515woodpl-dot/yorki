#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/yorki}"
DB_DIR="${DB_DIR:-/var/lib/yorki}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/yorki}"
TARGET="${1:-latest}"

if [[ "${TARGET}" == "latest" ]]; then
  if [[ ! -f "${BACKUP_ROOT}/LATEST" ]]; then
    echo "ERROR: ${BACKUP_ROOT}/LATEST not found"
    exit 1
  fi
  BACKUP_DIR="$(cat "${BACKUP_ROOT}/LATEST")"
else
  BACKUP_DIR="${BACKUP_ROOT}/${TARGET}"
fi

if [[ ! -d "${BACKUP_DIR}" ]]; then
  echo "ERROR: backup dir not found: ${BACKUP_DIR}"
  exit 1
fi

echo "[rollback] Using ${BACKUP_DIR}"
systemctl stop yorki || true

if [[ -f "${BACKUP_DIR}/yorki.db" ]]; then
  cp -a "${BACKUP_DIR}/yorki.db" "${DB_DIR}/yorki.db"
fi
if [[ -f "${BACKUP_DIR}/yorki.db-wal" ]]; then
  cp -a "${BACKUP_DIR}/yorki.db-wal" "${DB_DIR}/yorki.db-wal"
fi
if [[ -f "${BACKUP_DIR}/yorki.db-shm" ]]; then
  cp -a "${BACKUP_DIR}/yorki.db-shm" "${DB_DIR}/yorki.db-shm"
fi

if [[ -f "${BACKUP_DIR}/.env" ]]; then
  cp -a "${BACKUP_DIR}/.env" "${APP_DIR}/.env"
fi
if [[ -f "${BACKUP_DIR}/yorki.service" ]]; then
  cp -a "${BACKUP_DIR}/yorki.service" /etc/systemd/system/yorki.service
  systemctl daemon-reload
fi
if [[ -f "${BACKUP_DIR}/nginx-yorki.conf" ]]; then
  cp -a "${BACKUP_DIR}/nginx-yorki.conf" /etc/nginx/sites-enabled/yorki
  nginx -t && systemctl reload nginx
fi

systemctl start yorki
echo "[rollback] Completed"
