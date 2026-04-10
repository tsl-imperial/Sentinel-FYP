#!/bin/bash
# Network Inspector — bootstrap.
# Idempotent. Run once after a fresh clone.
set -e
cd "$(dirname "$0")"

echo ""
echo "  Network Inspector — setup"
echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 0. Tool version checks
# Find a Python >= 3.11. macOS ships /usr/bin/python3 as 3.9, so prefer Homebrew
# versions explicitly when present.
PYTHON_BIN=""
for cand in python3.13 python3.12 python3.11 python3; do
  if command -v "$cand" >/dev/null 2>&1; then
    ver=$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
    major=$(echo "$ver" | cut -d. -f1)
    minor=$(echo "$ver" | cut -d. -f2)
    if [ "$major" -ge 3 ] && [ "$minor" -ge 11 ]; then
      PYTHON_BIN="$cand"
      break
    fi
  fi
done
if [ -z "$PYTHON_BIN" ]; then
  echo "  ERROR: Python 3.11+ not found."
  echo "         macOS system python3 is 3.9 (too old). Install via:"
  echo "           brew install python@3.13"
  exit 1
fi
echo "→ Using $PYTHON_BIN ($($PYTHON_BIN --version))"

if ! command -v node >/dev/null 2>&1; then
  echo "  ERROR: node not found. Install Node 20.9+ via nvm or your package manager."
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 9 ]; }; then
  echo "  ERROR: Node 20.9+ required (you have $NODE_VER)."
  echo "         Next.js 16 won't run on older Node. Use nvm: nvm install 20"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "  ERROR: npm not found (should ship with node)."
  exit 1
fi

# 1. Python venv
if [ ! -d ".venv" ]; then
  echo "→ Creating Python venv at .venv with $PYTHON_BIN"
  "$PYTHON_BIN" -m venv .venv
fi
echo "→ Activating venv and installing Python deps"
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt

# 2. Node deps for the Next.js app
echo "→ Installing Node deps in application/web/server"
cd application/web/server
npm install
cd ../../..

# 3. Env file
if [ ! -f ".env" ]; then
  echo "→ Copying .env.example → .env (edit to taste)"
  cp .env.example .env
fi

echo ""
echo "  Setup complete."
echo "  Run:  ./start.sh"
echo ""
