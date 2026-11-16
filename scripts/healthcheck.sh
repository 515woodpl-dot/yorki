#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
APP_BASE_PATH="${APP_BASE_PATH:-/task}"

fail() {
  echo "[health] FAIL: $1"
  exit 1
}

# check_url URL [allowed status codes...]   (default: 200)
check_url() {
  local url="$1"; shift
  local allowed=("${@:-200}")
  local status
  status="$(curl -s -o /dev/null -w "%{http_code}" "$url" || true)"
  for code in "${allowed[@]}"; do
    if [[ "$status" == "$code" ]]; then
      echo "[health] OK ${url} (${status})"
      return 0
    fi
  done
  fail "${url} returned ${status}"
}

check_url "${BASE_URL}${APP_BASE_PATH}/login"
# Logged out, the dashboard redirects to /login — that is healthy.
check_url "${BASE_URL}${APP_BASE_PATH}/dashboard" 200 302 307
check_url "${BASE_URL}${APP_BASE_PATH}/Yorki.png"

# Database: opens the DB and runs PRAGMA integrity_check.
health_json="$(curl -s "${BASE_URL}${APP_BASE_PATH}/api/health" || true)"
if [[ "${health_json}" != *'"status":"ok"'* ]]; then
  fail "/api/health reported: ${health_json:-no response}"
fi
echo "[health] OK database (${health_json})"

css_path="$(curl -s "${BASE_URL}${APP_BASE_PATH}/login" | grep -o "${APP_BASE_PATH}/_next/static/css/[^\"]*\\.css" | head -1 || true)"
if [[ -z "${css_path}" ]]; then
  fail "Unable to detect CSS path from login HTML"
fi
check_url "${BASE_URL}${css_path}"

echo "[health] All checks passed."
