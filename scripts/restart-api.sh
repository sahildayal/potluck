#!/usr/bin/env bash
# Restart the API cleanly.
#
# Exists because a stale listener on the port does not stop the old server — it
# stops the NEW one, which dies with EADDRINUSE while the old build keeps
# serving. That failure looks exactly like "my code change did nothing", and it
# cost real debugging time twice before this script existed.
set -euo pipefail

PORT="${API_PORT:-8787}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${API_LOG:-/tmp/potluck-api.log}"

kill_port() {
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "
      \$c = Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue
      if (\$c) { \$c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue } }
    " >/dev/null 2>&1 || true
  else
    lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
}

kill_port
sleep 1

set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a

: >"$LOG"
(cd "$ROOT/apps/api" && npx tsx src/server.ts >>"$LOG" 2>&1 &)

for _ in $(seq 1 30); do
  if curl -sf -m 2 "http://localhost:$PORT/health" >/dev/null 2>&1; then
    echo "api up on :$PORT (log: $LOG)"
    exit 0
  fi
  sleep 1
done

echo "api failed to start; last 30 lines of $LOG:" >&2
tail -30 "$LOG" >&2
exit 1
