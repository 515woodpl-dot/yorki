#!/usr/bin/env bash

set -euo pipefail

USER="${USER:-root}"
IP="${IP:-146.190.130.170}"
APP_DIR="${APP_DIR:-/var/www/yorki}"
SSH_PORT="${SSH_PORT:-22}"

SSH_TARGET="${USER}@${IP}"
SSH_OPTS=(-p "${SSH_PORT}" -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

if command -v sshpass >/dev/null 2>&1 && [[ -n "${SSHPASS:-}" ]]; then
  SSH_CMD=(sshpass -e ssh "${SSH_OPTS[@]}")
else
  SSH_CMD=(ssh "${SSH_OPTS[@]}")
fi

echo "Checking SSH connection to ${SSH_TARGET}..."
if ! "${SSH_CMD[@]}" "${SSH_TARGET}" "exit" >/dev/null 2>&1; then
  echo "Error: SSH connection failed for ${SSH_TARGET}."
  echo "Make sure your SSH key works, or install sshpass and set SSHPASS for password login."
  exit 1
fi

if command -v sshpass >/dev/null 2>&1 && [[ -n "${SSHPASS:-}" ]]; then
  RSYNC_SSH="sshpass -e ssh ${SSH_OPTS[*]}"
else
  RSYNC_SSH="ssh ${SSH_OPTS[*]}"
fi

echo "Syncing files to ${SSH_TARGET}:${APP_DIR}..."
rsync -avz \
  --exclude node_modules \
  --exclude data \
  --exclude .git \
  -e "${RSYNC_SSH}" \
  ./ "${SSH_TARGET}:${APP_DIR}/"

echo "Rebuilding containers on ${SSH_TARGET}:${APP_DIR}..."
"${SSH_CMD[@]}" "${SSH_TARGET}" "APP_DIR='${APP_DIR}' bash -s" <<'EOF'
set -euo pipefail

cd "${APP_DIR}"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
else
  COMPOSE_CMD="docker-compose"
fi

${COMPOSE_CMD} down
${COMPOSE_CMD} up -d --build
docker image prune -f
EOF

echo "Deploy complete."
