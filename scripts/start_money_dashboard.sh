#!/bin/zsh
set -euo pipefail

WORKDIR="/Users/brunoclaw/source/money-dasdboard"
PYTHON_BIN="/opt/homebrew/bin/python3"
export PORT="${PORT:-8081}"

cd "$WORKDIR"
exec "$PYTHON_BIN" dashboard/server.py
