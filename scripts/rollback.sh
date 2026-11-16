#!/usr/bin/env bash
# Code rollback only. Never replace a live database with a stale snapshot.
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/yorki}"
SERVICE="${SERVICE:-yorki}"
PREVIOUS_DIR="${1:?Usage: rollback.sh /var/www/yorki-previous-TIMESTAMP}"
APP_DIR="$(realpath "$APP_DIR")"
PREVIOUS_DIR="$(realpath "$PREVIOUS_DIR")"
[[ "$(dirname "$PREVIOUS_DIR")" == "$(dirname "$APP_DIR")" && "$PREVIOUS_DIR" != "$APP_DIR" ]] || { echo 'Previous release must be a different sibling directory.'; exit 1; }
[[ -f "$PREVIOUS_DIR/.next/BUILD_ID" && -f "$PREVIOUS_DIR/package.json" ]] || { echo 'Previous release is not built.'; exit 1; }
FAILED_DIR="${APP_DIR}-failed-$(date -u +%Y%m%d-%H%M%S)"
systemctl stop "$SERVICE"
mv "$APP_DIR" "$FAILED_DIR"
if ! mv "$PREVIOUS_DIR" "$APP_DIR"; then
  mv "$FAILED_DIR" "$APP_DIR"
  systemctl start "$SERVICE"
  exit 1
fi
systemctl start "$SERVICE"
echo "Previous code restored; current database retained. Failed release kept at $FAILED_DIR."
