#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Yorki — SQLite + uploads backup to Google Drive via rclone
#
# SETUP (one-time):
#   1. Install rclone:       brew install rclone
#   2. Configure Drive:      rclone config  → name it "gdrive"
#   3. Make executable:      chmod +x backup.sh
#   4. Schedule twice daily: crontab -e
#      0 8,20 * * * /path/to/your/project/backup.sh >> /path/to/your/project/logs/backup.log 2>&1
#
# REQUIREMENTS:
#   - rclone >= 1.60  (brew install rclone)
#   - sqlite3 CLI     (brew install sqlite3)  — for safe hot backup
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Where the app keeps its data. Must match the app's YORKI_DB_DIR
# (production uses /var/lib/yorki). Read from the environment, then .env.
if [ -z "${YORKI_DB_DIR:-}" ] && [ -f "$PROJECT_DIR/.env" ]; then
  YORKI_DB_DIR="$(grep -E '^YORKI_DB_DIR=' "$PROJECT_DIR/.env" | tail -1 | cut -d= -f2- | tr -d '"' || true)"
fi
DATA_DIR="${YORKI_DB_DIR:-$PROJECT_DIR/data}"
# Attachments are stored privately next to the database (not in public/).
UPLOADS_DIR="$DATA_DIR/uploads"
LEGACY_UPLOADS_DIR="$PROJECT_DIR/public/uploads"
BACKUP_DIR="$DATA_DIR/backups"

command -v sqlite3 >/dev/null || { echo "  ✗ sqlite3 CLI not installed — cannot back up safely"; exit 1; }
command -v rclone  >/dev/null || { echo "  ✗ rclone not installed — off-site copy impossible"; exit 1; }
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
REMOTE="gdrive:yorki-backups"
LOG_DIR="$PROJECT_DIR/logs"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

echo "[$TIMESTAMP] Starting Yorki backup..."

# ── 1. Safe SQLite backup (hot copy — no need to stop the app) ────────────────
DB_SRC="$DATA_DIR/yorki.db"
DB_BACKUP="$BACKUP_DIR/yorki_${TIMESTAMP}.db"

if [ -f "$DB_SRC" ]; then
  sqlite3 "$DB_SRC" ".backup '$DB_BACKUP'"
  # A backup you can't open is not a backup.
  CHECK="$(sqlite3 "$DB_BACKUP" 'PRAGMA integrity_check;')"
  if [ "$CHECK" != "ok" ]; then
    echo "  ✗ Backup failed integrity check: $CHECK"
    exit 1
  fi
  echo "  ✓ Database backed up and verified → $DB_BACKUP"
else
  echo "  ✗ Database not found at $DB_SRC (set YORKI_DB_DIR)"
  exit 1
fi

# ── 2. Sync uploads folder ────────────────────────────────────────────────────
if [ -d "$UPLOADS_DIR" ]; then
  rclone sync "$UPLOADS_DIR" "$REMOTE/uploads" \
    --transfers 4 \
    --checkers 8 \
    --log-level INFO
  echo "  ✓ Uploads synced → $REMOTE/uploads"
else
  echo "  ~ No uploads folder yet — skipping"
fi
# Files uploaded by older versions lived under public/uploads.
if [ -d "$LEGACY_UPLOADS_DIR" ]; then
  rclone sync "$LEGACY_UPLOADS_DIR" "$REMOTE/uploads-legacy" --log-level INFO
  echo "  ✓ Legacy uploads synced → $REMOTE/uploads-legacy"
fi

# ── 3. Upload the DB backup to Drive ─────────────────────────────────────────
if [ -f "$DB_BACKUP" ]; then
  rclone copy "$DB_BACKUP" "$REMOTE/db" \
    --log-level INFO
  echo "  ✓ Database uploaded → $REMOTE/db/yorki_${TIMESTAMP}.db"
fi

# ── 4. Prune local backups older than 7 days ─────────────────────────────────
find "$BACKUP_DIR" -name "yorki_*.db" -mtime +7 -delete
echo "  ✓ Old local backups pruned (>7 days)"

# ── 5. Prune remote Drive backups older than 30 days ─────────────────────────
rclone delete "$REMOTE/db" \
  --min-age 30d \
  --log-level INFO
echo "  ✓ Old remote backups pruned (>30 days)"

echo "[$TIMESTAMP] Backup complete."
