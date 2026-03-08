#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
export PORT="${PORT:-8081}"

cd "$ROOT_DIR"
exec "$PYTHON_BIN" dashboard/server.py
