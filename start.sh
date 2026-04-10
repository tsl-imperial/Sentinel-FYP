#!/bin/bash
# Network Inspector — dev orchestrator.
# Boots Flask backend + Next.js frontend in parallel and surfaces failures loudly.
set -e
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "ERROR: .venv missing. Run ./setup.sh first."
  exit 1
fi

# NOTE: do NOT shell-source .env here. python-dotenv loads it in app.py and
# Next.js (via dotenv in next.config.js) loads it from the top-level. Triple-
# loading via `set -a; . ./.env; set +a` breaks on values with spaces or quotes.

# shellcheck disable=SC1091
source .venv/bin/activate

# Read just the two ports we need from .env without sourcing the rest.
# Defaults are deliberate: 5050 (not 5000 which macOS AirPlay Receiver hogs)
# and 3666 (which mirrors the metis house style).
FLASK_PORT=$(grep -E '^FLASK_RUN_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
FLASK_PORT="${FLASK_PORT:-5050}"
NEXT_PORT=$(grep -E '^NEXT_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
NEXT_PORT="${NEXT_PORT:-3666}"

echo ""
echo "  Network Inspector — dev"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Flask:    http://127.0.0.1:${FLASK_PORT}"
echo "  Next.js:  http://127.0.0.1:${NEXT_PORT}"
echo ""

# Run both processes in their own process group so trap-kill -$$ takes them all out.
set -m

# Start Flask in background
NETINSPECT_DEV=1 FLASK_APP=application.web.app flask run --port "$FLASK_PORT" &
FLASK_PID=$!

# Cleanup trap kills the entire process group (Flask AND Next.js, including npx grandchildren).
cleanup() {
  echo ''
  echo 'Stopping...'
  kill -- -$$ 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# Poll /api/healthz for up to 10 seconds before starting Next.js.
# Surfaces missing GEE creds, port conflicts, dotenv parse errors loudly.
echo "→ Waiting for Flask /api/healthz..."
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${FLASK_PORT}/api/healthz" >/dev/null 2>&1; then
    echo "  Flask is up."
    break
  fi
  if ! kill -0 "$FLASK_PID" 2>/dev/null; then
    echo "  ERROR: Flask died during startup. Check the log above."
    exit 1
  fi
  sleep 0.5
done

if ! curl -fsS "http://127.0.0.1:${FLASK_PORT}/api/healthz" >/dev/null 2>&1; then
  echo "  ERROR: Flask did not respond within 10s. Killing and bailing."
  cleanup
fi

# Surface readiness state without blocking
READY_BODY=$(curl -fsS "http://127.0.0.1:${FLASK_PORT}/api/healthz/ready" 2>/dev/null || echo '{"status":"unknown"}')
echo "  Readiness: $READY_BODY"

echo ""
echo "  Open http://127.0.0.1:${NEXT_PORT} in your browser."
echo "  Ctrl+C stops both processes."
echo ""

# Start Next.js in background, then poll until either child dies.
# macOS bash 3.2 doesn't have `wait -n`, so we use a 1-second `kill -0` poll loop.
# Same semantics: react to either process crashing, not just to Ctrl+C.
cd application/web/server
npx next dev -p "$NEXT_PORT" &
NEXT_PID=$!

while kill -0 "$FLASK_PID" 2>/dev/null && kill -0 "$NEXT_PID" 2>/dev/null; do
  sleep 1
done

echo ''
if ! kill -0 "$FLASK_PID" 2>/dev/null; then
  echo "Flask exited. Stopping Next.js."
else
  echo "Next.js exited. Stopping Flask."
fi
cleanup
