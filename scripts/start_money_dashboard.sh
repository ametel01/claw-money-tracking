#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PORT="${PORT:-8081}"

cd "$ROOT_DIR"
exec bun run start
