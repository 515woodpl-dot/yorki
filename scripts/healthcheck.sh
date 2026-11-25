#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
APP_BASE_PATH="${APP_BASE_PATH:-/task}"
# Follow the canonical base path in both forms to catch slash redirect loops.
# Set PROXY_BASE_URL to the public HTTPS origin to also check Nginx's root route.
redirect_base="${PROXY_BASE_URL:-$BASE_URL}"
redirect_base="${redirect_base%/}"
redirect_routes=("$APP_BASE_PATH" "${APP_BASE_PATH}/")
if [[ -n "${PROXY_BASE_URL:-}" ]]; then
  redirect_routes=("/" "${redirect_routes[@]}")
fi
for route in "${redirect_routes[@]}"; do
  result="$(curl --proto '=http,https' --proto-redir '=http,https' --max-time 20 \
    --max-redirs 5 -sS -L -o /dev/null -w '%{http_code} %{url_effective}' \
    "${redirect_base}${route}")" || { echo "[health] FAIL: redirect chain for ${route}"; exit 1; }
  [[ "$result" == "200 ${redirect_base}${APP_BASE_PATH}/login" ]] || {
    echo "[health] FAIL: ${route} expected login, got ${result}"; exit 1;
  }
done
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
