#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# TaskFlow Nightly Backup Script
#
# Backs up the Supabase PostgreSQL database to a local directory.
# Optionally syncs to an external location (USB drive, S3, etc.)
#
# SETUP:
# 1. Install pg_dump: sudo apt install postgresql-client
# 2. Make executable: chmod +x /home/pi/taskflow/scripts/backup.sh
# 3. Add to cron (runs at 2 AM daily):
#    crontab -e
#    0 2 * * * /home/pi/taskflow/scripts/backup.sh >> /var/log/taskflow-backup.log 2>&1
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
BACKUP_DIR="/home/pi/backups/taskflow"
KEEP_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Load env vars from the app's .env.local
# Extract the DB connection from the Supabase URL
if [ -f "/home/pi/taskflow/.env.local" ]; then
  export $(grep -v '^#' /home/pi/taskflow/.env.local | xargs)
fi

# Derive Postgres connection from Supabase URL
# Format: https://PROJECT_ID.supabase.co
# DB host: db.PROJECT_ID.supabase.co
if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "[backup] ERROR: NEXT_PUBLIC_SUPABASE_URL not set"
  exit 1
fi

PROJECT_ID=$(echo "$NEXT_PUBLIC_SUPABASE_URL" | sed 's|https://||' | sed 's|\.supabase\.co||')
DB_HOST="db.${PROJECT_ID}.supabase.co"
DB_NAME="postgres"
DB_USER="postgres"

# DB password must be set in .env.local as SUPABASE_DB_PASSWORD
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "[backup] WARNING: SUPABASE_DB_PASSWORD not set — backup may fail"
fi

# ── Create backup directory ───────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/db_${TIMESTAMP}.sql.gz"

echo "[backup] Starting backup at $(date)"
echo "[backup] Target: ${BACKUP_FILE}"

# ── Run pg_dump ───────────────────────────────────────────────────────────────
PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" pg_dump \
  --host="$DB_HOST" \
  --port=5432 \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-password \
  --format=plain \
  --no-acl \
  --no-owner \
  | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "[backup] Backup complete. Size: ${BACKUP_SIZE}"

# ── Clean old backups ─────────────────────────────────────────────────────────
echo "[backup] Removing backups older than ${KEEP_DAYS} days..."
find "$BACKUP_DIR" -name "*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
REMAINING=$(ls "$BACKUP_DIR" | wc -l)
echo "[backup] Retained backups: ${REMAINING}"

# ── Optional: sync to USB drive ───────────────────────────────────────────────
# Uncomment if you have a USB drive mounted at /media/pi/backup
# if [ -d "/media/pi/backup" ]; then
#   rsync -av --delete "$BACKUP_DIR/" "/media/pi/backup/taskflow/"
#   echo "[backup] Synced to USB drive"
# fi

# ── Optional: sync to Cloudflare R2 / S3 ─────────────────────────────────────
# Requires: pip install awscli + AWS credentials configured
# aws s3 sync "$BACKUP_DIR/" "s3://your-bucket/taskflow-backups/" \
#   --endpoint-url "https://your-r2-account.r2.cloudflarestorage.com"

echo "[backup] Done at $(date)"
