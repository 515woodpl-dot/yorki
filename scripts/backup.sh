#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-/var/www/yorki}"
cd "$APP_DIR"
exec node "$SCRIPT_DIR/backup-state.cjs"
