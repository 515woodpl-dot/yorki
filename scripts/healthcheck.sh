#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
APP_BASE_PATH="${APP_BASE_PATH:-/task}"

fail() {
  echo "[health] FAIL: $1"
  exit 1
}

check_url() {
  local url="$1"
  local status
  status="$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)"
  if [[ "$status" != "200" ]]; then
    fail "${url} returned ${status}"
  fi
  echo "[health] OK ${url}"
}

check_url "${BASE_URL}${APP_BASE_PATH}/login"
check_url "${BASE_URL}${APP_BASE_PATH}/dashboard"
check_url "${BASE_URL}${APP_BASE_PATH}/Yorki.png"

css_path="$(curl -s "${BASE_URL}${APP_BASE_PATH}/login" | grep -o "${APP_BASE_PATH}/_next/static/css/[^\"]*\\.css" | head -1 || true)"
if [[ -z "${css_path}" ]]; then
  fail "Unable to detect CSS path from login HTML"
fi
check_url "${BASE_URL}${css_path}"

echo "[health] All checks passed."
