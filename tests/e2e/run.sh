#!/usr/bin/env bash
# Multi-user browser tests: 3 real sessions (2 admins + 1 staff) against a
# throwaway database. Never touches your real data.
#
#   npm run build            # production build first (basePath /task)
#   ./tests/e2e/run.sh
#
# Needs Playwright with Chromium available (npm i -g playwright && npx playwright install chromium).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
PORT=3100
# The server runs in its own process group so we can stop next-server too
# (it renames itself, so killing just the npx wrapper leaves it on the port).
stop() {
  if [[ -n "${PID:-}" ]]; then
    kill -TERM -- "-$PID" 2>/dev/null || true
    for _ in $(seq 1 20); do kill -0 -- "-$PID" 2>/dev/null || break; sleep 0.25; done
    PID=""
  fi
}
cleanup() { stop; rm -rf "$TMP"; }
trap cleanup EXIT

start() {
  stop
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/task/login"; then
    echo "Port ${PORT} is already in use — stop that server first." >&2; exit 1
  fi
  rm -rf "$TMP/db" && mkdir -p "$TMP/db"
  (cd "$ROOT" && YORKI_DB_DIR="$TMP/db" NODE_ENV=production setsid npx next start -p "$PORT" > "$TMP/server.log" 2>&1) &
  sleep 0.5
  PID="$(pgrep -n -f "next start -p ${PORT}" || true)"
  PID="$(ps -o pgid= -p "$PID" | tr -d ' ')"
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:${PORT}/task/api/health" >/dev/null && break; sleep 1; done
  NODE_PATH="$ROOT/node_modules" node "$ROOT/tests/e2e/seed-test-db.js" "$TMP/db/yorki.db" >/dev/null
}

PLAYWRIGHT_PATH="$(npm root -g)"
start; echo "== collaboration";            NODE_PATH="$PLAYWRIGHT_PATH" node "$ROOT/tests/e2e/collaboration.js"
start; echo "== mentions & notifications"; SP="$TMP" NODE_PATH="$PLAYWRIGHT_PATH" node "$ROOT/tests/e2e/notifications.js"
echo "== healthcheck"; BASE_URL="http://127.0.0.1:${PORT}" "$ROOT/scripts/healthcheck.sh"
