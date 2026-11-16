#!/usr/bin/env bash
# Yorki backup — SQLite database + attachments, verified, copied off-site.
#
# This used to be a Supabase/Postgres script from an earlier version of the
# app and could not back up the current SQLite database. It now simply runs
# the real backup at the project root.
#
#   YORKI_DB_DIR=/var/lib/yorki ./scripts/backup.sh
#
# Schedule (twice daily):
#   0 8,20 * * * YORKI_DB_DIR=/var/lib/yorki /var/www/yorki/scripts/backup.sh >> /var/log/yorki-backup.log 2>&1
set -euo pipefail
exec "$(cd "$(dirname "$0")/.." && pwd)/backup.sh" "$@"
