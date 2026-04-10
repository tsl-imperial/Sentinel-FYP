#!/bin/bash
# Network Inspector — frontend-only dev server.
# Assumes Flask is already running on FLASK_BACKEND_URL (default 127.0.0.1:5000).
# For the full stack, use the top-level ./start.sh instead.
set -e
cd "$(dirname "$0")"

PORT="${PORT:-${NEXT_PORT:-3000}}"

echo ""
echo "  Network Inspector — frontend"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  http://127.0.0.1:${PORT}"
echo ""

npx next dev -p "$PORT"
