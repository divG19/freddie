#!/usr/bin/env bash
set -euo pipefail

ROOT="$(dirname "$(dirname "$(realpath "$0")")")"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "$FRONTEND_PID" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  if [[ -n "$BACKEND_PID" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -x "$ROOT/.venv/bin/python" || ! -f "$ROOT/.next/BUILD_ID" ]]; then
  printf '%s\n' 'Install Python/npm dependencies and run npm run build before starting the demo.' >&2
  exit 1
fi

"$ROOT/.venv/bin/python" -m uvicorn backend.main:app --app-dir "$ROOT" --host 127.0.0.1 --port 8000 --workers 1 &
BACKEND_PID=$!
node "$ROOT/node_modules/next/dist/bin/next" start "$ROOT" --hostname 0.0.0.0 --port 3000 &
FRONTEND_PID=$!

set +e
wait -n "$BACKEND_PID" "$FRONTEND_PID"
STATUS=$?
set -e
exit "$STATUS"
