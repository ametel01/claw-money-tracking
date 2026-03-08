#!/bin/zsh
set -euo pipefail

WORKDIR="/Users/brunoclaw/.openclaw/workspace"
PYTHON_BIN="/opt/homebrew/bin/python3"

cd "$WORKDIR"
exec "$PYTHON_BIN" dashboard/server.py
