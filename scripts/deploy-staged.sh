#!/usr/bin/env bash
# Run from a NEW sibling checkout; never over the running app directory.
set -euo pipefail
umask 077
APP_DIR="${APP_DIR:-/var/www/yorki}"
SERVICE="${SERVICE:-yorki}"
SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
APP_DIR="$(realpath "$APP_DIR")"
[[ "$SOURCE_DIR" != "$APP_DIR" && "$(dirname "$SOURCE_DIR")" == "$(dirname "$APP_DIR")" ]] || { echo 'Use a new sibling checkout beside the running app.'; exit 1; }
[[ ! -L "$APP_DIR" ]] || { echo 'Symlink deployments require a separate procedure.'; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo 'Install Node.js 24 LTS before deployment.'; exit 1; }
[[ "$(systemctl show "$SERVICE" -p WorkingDirectory --value)" == "$APP_DIR" ]] || { echo 'Service working directory differs; inspect the unit before proceeding.'; exit 1; }
systemctl is-active --quiet "$SERVICE" || { echo 'Existing service must be running before starting this procedure.'; exit 1; }
SERVICE_USER="$(systemctl show "$SERVICE" -p User --value)"
SERVICE_USER="${SERVICE_USER:-root}"
SERVICE_GROUP="$(systemctl show "$SERVICE" -p Group --value)"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}"
MAIN_PID="$(systemctl show "$SERVICE" -p MainPID --value)"
RUNNING_ABI="$("/proc/$MAIN_PID/exe" -p 'process.versions.modules')"
CURRENT_ABI="$(node -p 'process.versions.modules')"
[[ "$RUNNING_ABI" == "$CURRENT_ABI" ]] || { echo 'Running service uses a different Node ABI. Plan the Node upgrade and rollback before deploying.'; exit 1; }
available_kb="$(df -Pk "$SOURCE_DIR" | awk 'NR==2 {print $4}')"
(( available_kb >= 3145728 )) || { echo 'At least 3 GiB free required. Nothing stopped or deleted.'; exit 1; }
for name in .env .env.local .env.production .env.production.local; do
  if [[ -f "$APP_DIR/$name" ]]; then cp -p "$APP_DIR/$name" "$SOURCE_DIR/$name"; fi
done
cd "$SOURCE_DIR"
npm ci
APP_DIR="$APP_DIR" node - <<'JS'
const path=require('node:path'),fs=require('node:fs');
require('@next/env').loadEnvConfig(process.env.APP_DIR, false);
const key=process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH;
if(key) {
  const source=path.resolve(process.env.APP_DIR,key);
  if(source.startsWith(process.env.APP_DIR+path.sep)) {
    const relative=path.relative(process.env.APP_DIR,source);
    if(relative.startsWith('public/')) throw Error('Move calendar key out of public/ before deploying.');
    const target=path.join(process.cwd(),relative);
    fs.mkdirSync(path.dirname(target),{recursive:true});
    fs.copyFileSync(source,target); fs.chmodSync(target,0o600);
  } else if(!fs.existsSync(source)) throw Error('Configured calendar credentials do not exist.');
}
JS
# Check the active data location without opening or migrating the DB.
DB_PATH="$(APP_DIR="$APP_DIR" node - <<'JS'
const path=require('node:path'),fs=require('node:fs');
require('@next/env').loadEnvConfig(process.env.APP_DIR, false);
const configured=process.env.YORKI_DB_PATH?.trim() || (process.env.YORKI_DB_DIR?.trim() && path.join(process.env.YORKI_DB_DIR.trim(),'yorki.db'));
if(!configured || !path.isAbsolute(configured)) throw Error('Set an absolute YORKI_DB_DIR or YORKI_DB_PATH in the running service environment first.');
const resolved=path.resolve(configured);
if(resolved.startsWith(process.env.APP_DIR+path.sep) || resolved.startsWith(process.cwd()+path.sep)) throw Error('Data must live outside app and release directories before staged deployment.');
if(!fs.existsSync(resolved)) throw Error('Configured live database does not exist.');
console.log(resolved);
JS
)"
# Keep settings in the release even if the old service set them only at runtime.
printf '\nYORKI_DB_PATH=%s\nAPP_URL=https://task.goldenstoneworks.com/task\n' "$DB_PATH" >> .env.production.local
# Build against isolated sample data, never the production database.
YORKI_DB_PATH="$SOURCE_DIR/.build-data/yorki.db" npm run build
npm test
# Recheck space after building, reserving room for the snapshot and legacy copies.
BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/yorki}"
export BACKUP_ROOT
mkdir -p "$BACKUP_ROOT"
data_kb="$( { du -sk "$(dirname "$DB_PATH")"; if [[ -d "$APP_DIR/public/uploads" ]]; then du -sk "$APP_DIR/public/uploads"; fi; } | awk '{n+=$1} END {print n+0}')"
required_kb=$((data_kb * 2 + 524288))
for location in "$SOURCE_DIR" "$BACKUP_ROOT" "$(dirname "$DB_PATH")"; do
  free_kb="$(df -Pk "$location" | awk 'NR==2 {print $4}')"
  (( free_kb >= required_kb )) || { echo 'Insufficient free space for backup and upload migration. Existing app still running.'; exit 1; }
done
PREVIOUS_DIR="${APP_DIR}-previous-$(date -u +%Y%m%d-%H%M%S)"
STOPPED=0
MOVED=0
rollback_code() {
  local result=$?
  trap - EXIT
  if (( result != 0 && STOPPED == 1 )); then
    if (( MOVED == 1 )); then
      systemctl stop "$SERVICE" || true
      mv "$APP_DIR" "${SOURCE_DIR}-failed"
      mv "$PREVIOUS_DIR" "$APP_DIR"
    fi
    systemctl start "$SERVICE" || true
    echo 'Deployment failed. Previous code restored where necessary; database was not reverted.' >&2
  fi
  exit "$result"
}
trap rollback_code EXIT
systemctl stop "$SERVICE"
STOPPED=1
# Snapshot through the new release's native SQLite module, using the live env/path.
(cd "$APP_DIR" && YORKI_DB_PATH="$DB_PATH" node "$SOURCE_DIR/scripts/backup-state.cjs")
(cd "$APP_DIR" && YORKI_DB_PATH="$DB_PATH" node "$SOURCE_DIR/scripts/migrate-private-uploads.cjs")
# Keep ownership consistent with the existing app service.
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$SOURCE_DIR"
if [[ -d "$(dirname "$DB_PATH")/uploads/legacy" ]]; then
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$(dirname "$DB_PATH")/uploads/legacy"
fi
mv "$APP_DIR" "$PREVIOUS_DIR"
# If the second rename fails, restore immediately before the general failure trap.
if ! mv "$SOURCE_DIR" "$APP_DIR"; then mv "$PREVIOUS_DIR" "$APP_DIR"; exit 1; fi
MOVED=1
systemctl start "$SERVICE"
for attempt in {1..15}; do
  if bash "$APP_DIR/scripts/healthcheck.sh"; then
    STOPPED=0
    trap - EXIT
    printf 'Deployment passed. Previous code retained at %s\n' "$PREVIOUS_DIR"
    exit 0
  fi
  sleep 2
done
exit 1
