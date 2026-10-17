#!/usr/bin/env bash
# Start, stop and inspect the TSUMUGI backend and frontend together.
# Usage: scripts/tsumugi.sh start [--dev] | stop | restart [--dev] | status | logs
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${FRONTEND_PORT:-3000}
RUN="$ROOT/.runtime"
PIDS="$RUN/pids"
LOGS="$RUN/logs"
mkdir -p "$PIDS" "$LOGS"

listener() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
pid_of() { [ -f "$PIDS/$1.pid" ] && cat "$PIDS/$1.pid"; }

kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

# Only stop processes that belong to this project, never an unrelated app on the same port.
ours() { [ "$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$ROOT" ]; }

wait_for() {
  local url=$1 seconds=$2 name=$3 pid=$4 i=0
  while [ $i -lt $((seconds * 2)) ]; do
    curl -fs -o /dev/null "$url" && return 0
    if ! alive "$pid"; then echo "✗ $name exited. Last log lines:"; tail -n 20 "$LOGS/$name.log"; return 1; fi
    sleep 0.5; i=$((i + 1))
  done
  echo "✗ $name did not respond within ${seconds}s. See $LOGS/$name.log"; return 1
}

start() {
  local mode=prod
  [ "${1:-}" = "--dev" ] && mode=dev
  [ -x .venv/bin/uvicorn ] || { echo "✗ .venv is missing. Run: python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt"; exit 1; }
  [ -d node_modules ] || { echo "✗ node_modules is missing. Run: npm install"; exit 1; }
  [ -f .env ] || echo "! .env not found; model and Neo4j calls will fail."
  for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
    local pid
    pid=$(listener "$port")
    if [ -n "$pid" ]; then echo "✗ Port $port is in use (PID $pid: $(ps -o command= -p "$pid" | cut -c1-80))."; echo "  Run 'npm run down' first, or set BACKEND_PORT / FRONTEND_PORT."; exit 1; fi
  done

  echo "→ Backend on http://127.0.0.1:$BACKEND_PORT"
  nohup .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port "$BACKEND_PORT" >"$LOGS/backend.log" 2>&1 &
  echo $! >"$PIDS/backend.pid"
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/health" 20 backend "$(pid_of backend)" || { stop >/dev/null; exit 1; }

  export TSUMUGI_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
  if [ "$mode" = prod ]; then
    echo "→ Building frontend (production)…"
    if ! node_modules/.bin/next build >"$LOGS/build.log" 2>&1; then echo "✗ Build failed:"; tail -n 30 "$LOGS/build.log"; stop >/dev/null; exit 1; fi
    nohup node_modules/.bin/next start --hostname 127.0.0.1 --port "$FRONTEND_PORT" >"$LOGS/frontend.log" 2>&1 &
  else
    nohup node_modules/.bin/next dev --hostname 127.0.0.1 --port "$FRONTEND_PORT" >"$LOGS/frontend.log" 2>&1 &
  fi
  echo $! >"$PIDS/frontend.pid"
  echo "→ Frontend ($mode) on http://127.0.0.1:$FRONTEND_PORT"
  wait_for "http://127.0.0.1:$FRONTEND_PORT/" 90 frontend "$(pid_of frontend)" || { stop >/dev/null; exit 1; }

  echo
  status
  echo
  echo "Open http://127.0.0.1:$FRONTEND_PORT  ·  Logs: .runtime/logs  ·  Stop: npm run down"
}

stop() {
  local name pid port stopped=0
  for name in frontend backend; do
    pid=$(pid_of "$name")
    if alive "$pid"; then kill_tree "$pid"; echo "■ Stopped $name (PID $pid)"; stopped=1; fi
    rm -f "$PIDS/$name.pid"
  done
  # Also stop this project's servers started outside the script (e.g. npm run dev).
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    pid=$(listener "$port")
    if [ -n "$pid" ]; then
      if ours "$pid"; then kill_tree "$pid"; echo "■ Stopped process on port $port (PID $pid)"; stopped=1
      else echo "! Port $port is used by another app (PID $pid); left running."; fi
    fi
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(listener "$BACKEND_PORT")$(listener "$FRONTEND_PORT")" ] && break
    sleep 0.5
  done
  [ $stopped = 0 ] && echo "Nothing to stop."
  return 0
}

status() {
  local health
  if [ -n "$(listener "$BACKEND_PORT")" ]; then
    health=$(curl -fs "http://127.0.0.1:$BACKEND_PORT/api/health")
    case "$health" in *'"configured":true'*) echo "● backend   http://127.0.0.1:$BACKEND_PORT  ready (ai& key configured)";; *) echo "● backend   http://127.0.0.1:$BACKEND_PORT  ${health:-not responding}";; esac
  else echo "○ backend   stopped"; fi
  if [ -n "$(listener "$FRONTEND_PORT")" ]; then echo "● frontend  http://127.0.0.1:$FRONTEND_PORT"
  else echo "○ frontend  stopped"; fi
}

case "${1:-}" in
  start) start "${2:-}" ;;
  stop) stop ;;
  restart) stop; start "${2:-}" ;;
  status) status ;;
  logs) tail -n 40 -f "$LOGS/backend.log" "$LOGS/frontend.log" ;;
  *) echo "Usage: $0 start [--dev] | stop | restart [--dev] | status | logs"; exit 1 ;;
esac
