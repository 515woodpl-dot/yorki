#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
APP_BASE_PATH="${APP_BASE_PATH:-/task}"
for route in /login /api/health /Yorki.png; do
  status="$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' "${BASE_URL}${APP_BASE_PATH}${route}")"
  [[ "$status" == 200 ]] || { echo "[health] FAIL ${route}: ${status}"; exit 1; }
done
for route in /dashboard /admin/users; do
  headers="$(curl --max-time 15 -sS -D - -o /dev/null "${BASE_URL}${APP_BASE_PATH}${route}")"
  printf '%s' "$headers" | grep -Eqi '^HTTP/[^ ]+ 30[2378]' || { echo "[health] FAIL: anonymous access to ${route} was not redirected"; exit 1; }
  printf '%s' "$headers" | grep -Eqi '^location: (/task)?/login' || { echo "[health] FAIL: ${route} did not redirect to login"; exit 1; }
done
echo '[health] Public endpoints and anonymous access checks passed.'
