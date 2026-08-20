#!/usr/bin/env bash
# Start (or restart) the whole dev stack cleanly.
#
# Both servers have now bitten us the same way: a stale listener does not stop
# the old process, it stops the new one. The API dies with EADDRINUSE while the
# old build keeps serving; Vite is worse, because it silently moves to the next
# free port and the browser goes on showing the previous build. Both look
# exactly like "my change did nothing".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-8787}"
WEB_PORT="${WEB_PORT:-5173}"
API_LOG="${API_LOG:-/tmp/potluck-api.log}"
WEB_LOG="${WEB_LOG:-/tmp/potluck-web.log}"

kill_port() {
  local port="$1"
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "
      \$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
      if (\$c) { \$c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue } }
    " >/dev/null 2>&1 || true
  else
    lsof -ti tcp:"$port" 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  fi
}

wait_for() {
  local url="$1" name="$2" log="$3"
  for _ in $(seq 1 40); do
    if curl -sf -m 2 "$url" >/dev/null 2>&1; then
      echo "  $name up  ($url)"
      return 0
    fi
    sleep 1
  done
  echo "  $name FAILED to start; last 25 lines of $log:" >&2
  tail -25 "$log" >&2
  return 1
}

echo "stopping anything on :$API_PORT and :$WEB_PORT"
kill_port "$API_PORT"
kill_port "$WEB_PORT"
# Vite hops to the next port when its own is taken, so clear that too rather
# than leaving a second stale server behind.
kill_port "$((WEB_PORT + 1))"
sleep 1

set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a

: >"$API_LOG"
: >"$WEB_LOG"

(cd "$ROOT/apps/api" && npx tsx src/server.ts >>"$API_LOG" 2>&1 &)
# --strictPort makes Vite fail loudly instead of quietly serving the old build
# from a different port.
(cd "$ROOT/apps/web" && npx vite --port "$WEB_PORT" --strictPort >>"$WEB_LOG" 2>&1 &)

wait_for "http://localhost:$API_PORT/health" "api" "$API_LOG"
wait_for "http://localhost:$WEB_PORT/" "web" "$WEB_LOG"
