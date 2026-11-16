#!/usr/bin/env bash
set -euo pipefail
# Compatibility entrypoint. Must run from a fresh sibling checkout.
exec bash "$(dirname "$0")/deploy-staged.sh" "$@"
