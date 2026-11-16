#!/usr/bin/env bash
# Historical cron entrypoint: verified SQLite snapshot, then off-host copy.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v rclone >/dev/null || { echo 'rclone is required for the off-host backup entrypoint. For local snapshots use scripts/backup.sh.'; exit 1; }
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/yorki}"
export APP_DIR BACKUP_ROOT
bash "$SCRIPT_DIR/scripts/backup.sh"
LATEST="$(cat "$BACKUP_ROOT/LATEST")"
[[ -f "$LATEST/COMPLETE" ]] || { echo 'Backup did not complete.'; exit 1; }
# copy preserves older snapshots; never sync/delete remote recovery files.
rclone copy "$LATEST" "${YORKI_BACKUP_REMOTE:-gdrive:yorki-backups}/$(basename "$LATEST")"
echo 'Verified local backup copied off-host.'
