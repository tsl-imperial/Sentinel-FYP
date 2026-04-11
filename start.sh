#!/bin/bash
# Network Inspector — dev orchestrator.
#
# Boots Flask backend (port 5050) and Next.js frontend (port 3666) in the
# BACKGROUND, pipes their output to _log/syslog-{flask,next}.log, and exits.
# Re-running the script kills the old instances and starts fresh.
#
# Code edits are picked up automatically without restarting the script:
#   - Flask --debug enables Werkzeug's reloader (~50ms slower per request)
#   - Next.js dev has hot reload built-in
#
# Usage:
#   ./start.sh                  Start both services (kills any existing
#                                instances on the configured ports first).
#                                Default. This is what you want most of the time.
#   ./start.sh backend          Start/restart only Flask
#   ./start.sh frontend         Start/restart only Next.js
#   ./start.sh stop             Kill both services
#   ./start.sh status           Show running state
#   ./start.sh logs             Tail both logs in this terminal
#                                (Ctrl+C stops the tail; services keep running)
#   ./start.sh -h | --help      Show this help
#
# Structured after the nefos run-services.sh pattern.
#
# bash 3.2 compatible (macOS default). No `wait -n`, no associative arrays,
# no `${var^^}` style transformations. See CLAUDE.md "start.sh is bash 3.2
# compatible".

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Read ports from .env ──
# Don't shell-source .env (python-dotenv and Next.js's dotenv both load it
# inside their own processes, and triple-loading via `set -a; . ./.env`
# breaks on values with spaces or quotes). Just grep out the two port
# values we need for orchestration.
FLASK_PORT=$(grep -E '^FLASK_RUN_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
FLASK_PORT="${FLASK_PORT:-5050}"
NEXT_PORT=$(grep -E '^NEXT_PORT=' .env 2>/dev/null | cut -d= -f2 | tr -d ' "' || true)
NEXT_PORT="${NEXT_PORT:-3666}"

LOG_DIR="$SCRIPT_DIR/_log"
FLASK_LOG="$LOG_DIR/syslog-flask.log"
NEXT_LOG="$LOG_DIR/syslog-next.log"
mkdir -p "$LOG_DIR"

# ── Colors ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'
FLASK_COLOR='\033[0;36m'    # cyan
NEXT_COLOR='\033[0;33m'     # yellow

# ── Service registry: name|port|color|url ──
ALL_SERVICES=(
    "flask|${FLASK_PORT}|${FLASK_COLOR}|http://127.0.0.1:${FLASK_PORT}"
    "next |${NEXT_PORT}|${NEXT_COLOR}|http://127.0.0.1:${NEXT_PORT}"
)

# ── lsof helpers (cached so a single status pass = 1 lsof call) ──
_LSOF_CACHE=""
_LSOF_CACHE_VALID=false

_refresh_port_cache() {
    _LSOF_CACHE=$(lsof -i TCP -sTCP:LISTEN -P -n 2>/dev/null | grep -E ":(${FLASK_PORT}|${NEXT_PORT}) " || true)
    _LSOF_CACHE_VALID=true
}

_port_pid() {
    if [ "$_LSOF_CACHE_VALID" != "true" ]; then
        _refresh_port_cache
    fi
    _PORT_PID=$(echo "$_LSOF_CACHE" | grep ":$1 " | awk '{print $2}' | head -1)
}

_invalidate_cache() { _LSOF_CACHE_VALID=false; }

# ── Subcommand parsing ──
START_FLASK=false
START_NEXT=false
ACTION="start"

show_help() {
    sed -n 's/^# \{0,1\}//p' "$0" | sed -n '2,28p'
}

if [ $# -eq 0 ]; then
    START_FLASK=true
    START_NEXT=true
else
    case "$1" in
        backend)    START_FLASK=true ;;
        frontend)   START_NEXT=true ;;
        stop)       ACTION="stop" ;;
        status)     ACTION="status" ;;
        logs)       ACTION="logs" ;;
        --help|-h)  show_help; exit 0 ;;
        *)
            echo -e "${RED}Unknown command: $1${NC}"
            echo "Run './start.sh --help' for usage."
            exit 1
            ;;
    esac
fi

# ── Subcommand: status ──
show_status() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  Network Inspector — service status${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    _refresh_port_cache
    local running=0
    local stopped=0
    for entry in "${ALL_SERVICES[@]}"; do
        IFS='|' read -r name port color url <<< "$entry"
        _port_pid "$port"
        if [ -n "$_PORT_PID" ]; then
            echo -e "  ${color}● ${name}${NC}  ${CYAN}${url}${NC}  (pid ${_PORT_PID})"
            running=$((running + 1))
        else
            echo -e "  ${RED}○ ${name}${NC}  stopped"
            stopped=$((stopped + 1))
        fi
    done
    echo ""
    echo -e "  ${GREEN}${running} running${NC}, ${RED}${stopped} stopped${NC}"
    echo ""
}

# ── Subcommand: stop ──
stop_all() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  Network Inspector — stopping services${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    _refresh_port_cache
    local stopped=0
    for entry in "${ALL_SERVICES[@]}"; do
        IFS='|' read -r name port _ _ <<< "$entry"
        _port_pid "$port"
        if [ -n "$_PORT_PID" ]; then
            echo -e "  ${YELLOW}Stopping $name on :$port (pid $_PORT_PID)${NC}"
            kill -9 "$_PORT_PID" 2>/dev/null || true
            stopped=$((stopped + 1))
        else
            echo -e "  $name: not running"
        fi
    done
    if [ $stopped -gt 0 ]; then
        sleep 1
        # Verify
        _invalidate_cache
        _refresh_port_cache
        local still_up=0
        for entry in "${ALL_SERVICES[@]}"; do
            IFS='|' read -r name port _ _ <<< "$entry"
            _port_pid "$port"
            if [ -n "$_PORT_PID" ]; then
                echo -e "  ${RED}$name still running on :$port${NC}"
                still_up=$((still_up + 1))
            fi
        done
        if [ $still_up -eq 0 ]; then
            echo -e "${GREEN}Done.${NC}"
        else
            echo -e "${RED}Warning: $still_up service(s) may still be running.${NC}"
        fi
    fi
    echo ""
}

# ── Subcommand: logs ──
show_logs() {
    echo ""
    echo -e "${CYAN}Tailing logs (Ctrl+C stops tail; services keep running):${NC}"
    echo -e "  ${FLASK_COLOR}flask:${NC} $FLASK_LOG"
    echo -e "  ${NEXT_COLOR}next: ${NC} $NEXT_LOG"
    echo ""
    touch "$FLASK_LOG" "$NEXT_LOG"
    # tail -F follows by name across log rotations / re-creates
    tail -F "$FLASK_LOG" "$NEXT_LOG"
}

case "$ACTION" in
    stop)   stop_all; exit 0 ;;
    status) show_status; exit 0 ;;
    logs)   show_logs; exit 0 ;;
esac

# ── Start path ──

# Pre-flight: venv must exist
if [ ! -d ".venv" ]; then
    echo -e "${RED}ERROR: .venv missing. Run ./setup.sh first.${NC}"
    exit 1
fi
# Pre-flight: frontend deps must exist (only if we're starting Next.js)
if [ "$START_NEXT" = "true" ] && [ ! -d "frontend/node_modules" ]; then
    echo -e "${RED}ERROR: frontend/node_modules missing. Run ./setup.sh first.${NC}"
    exit 1
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Network Inspector — dev${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
[ "$START_FLASK" = "true" ] && echo -e "  Flask:    http://127.0.0.1:${FLASK_PORT}"
[ "$START_NEXT"  = "true" ] && echo -e "  Next.js:  http://127.0.0.1:${NEXT_PORT}"
echo ""

# Kill any existing process(es) on the ports we're about to use. Only the
# ports for the services we requested — `./start.sh frontend` MUST NOT kill
# the running backend.
echo "Checking for existing services..."
_refresh_port_cache
KILLED_ANY=false
for entry in "${ALL_SERVICES[@]}"; do
    IFS='|' read -r name port _ _ <<< "$entry"
    name=$(echo "$name" | tr -d ' ')  # strip alignment padding
    if [ "$name" = "flask" ] && [ "$START_FLASK" != "true" ]; then continue; fi
    if [ "$name" = "next"  ] && [ "$START_NEXT"  != "true" ]; then continue; fi
    _port_pid "$port"
    if [ -n "$_PORT_PID" ]; then
        echo -e "  ${YELLOW}Killing existing $name on :$port (pid $_PORT_PID)${NC}"
        kill -9 "$_PORT_PID" 2>/dev/null || true
        KILLED_ANY=true
    fi
done
if [ "$KILLED_ANY" = "true" ]; then
    sleep 1
fi
_invalidate_cache

# Activate venv (Flask needs it; Next.js doesn't but harmless)
# shellcheck disable=SC1091
source .venv/bin/activate

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Pipe each line through a timestamp prefix on its way to the log file.
add_timestamps() {
    while IFS= read -r line; do
        echo "$(date '+%H:%M:%S') $line"
    done
}

# ── Start Flask ──
if [ "$START_FLASK" = "true" ]; then
    {
        echo ""
        echo "========== Session started: $TIMESTAMP =========="
    } >> "$FLASK_LOG"
    # --debug enables Werkzeug auto-reload so backend edits to backend/app.py
    # or backend/local_data.py are picked up without restarting the script.
    # Trade-off: ~50ms slower per request and a "Detected change, reloading"
    # banner per save. Worth it during active development.
    NETINSPECT_DEV=1 FLASK_APP=backend.app flask run --port "$FLASK_PORT" --debug \
        </dev/null 2>&1 | add_timestamps >> "$FLASK_LOG" &
    disown 2>/dev/null || true
fi

# ── Start Next.js ──
if [ "$START_NEXT" = "true" ]; then
    {
        echo ""
        echo "========== Session started: $TIMESTAMP =========="
    } >> "$NEXT_LOG"
    (cd frontend && npx next dev -p "$NEXT_PORT") \
        </dev/null 2>&1 | add_timestamps >> "$NEXT_LOG" &
    disown 2>/dev/null || true
fi

# ── Tail startup logs for ~10 seconds so the user sees errors immediately ──
echo ""
echo -e "${GREEN}Showing startup logs for 10 seconds (Ctrl+C to skip; services keep running)...${NC}"
echo -e "────────────────────────────────────────────────────────────"
sleep 0.5

tail_with_color() {
    local log_file="$1"
    local color="$2"
    local prefix="$3"
    touch "$log_file"
    tail -n 0 -F "$log_file" 2>/dev/null | while IFS= read -r line; do
        echo -e "${color}[${prefix}]${NC} $line"
    done
}

TAIL_PIDS=()
if [ "$START_FLASK" = "true" ]; then
    tail_with_color "$FLASK_LOG" "$FLASK_COLOR" "flask" &
    TAIL_PIDS+=("$!")
fi
if [ "$START_NEXT" = "true" ]; then
    tail_with_color "$NEXT_LOG" "$NEXT_COLOR" "next " &
    TAIL_PIDS+=("$!")
fi
for pid in "${TAIL_PIDS[@]}"; do
    disown "$pid" 2>/dev/null || true
done

cleanup_tails() {
    for pid in "${TAIL_PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    # Belt-and-braces: kill any tail still attached to our log files
    pkill -f "tail -n 0 -F $LOG_DIR/syslog-" 2>/dev/null || true
}

trap 'cleanup_tails; echo ""; echo -e "${YELLOW}Log tail interrupted. Services continue in background.${NC}"; exit 0' INT

sleep 10
trap - INT
cleanup_tails
sleep 0.2

# ── Wait for services to bind to their ports ──
echo ""
echo "Waiting for services to be ready..."
_max_wait=20
_waited=0
while [ $_waited -lt $_max_wait ]; do
    _all_up=true
    _refresh_port_cache
    if [ "$START_FLASK" = "true" ]; then
        _port_pid "$FLASK_PORT"
        [ -z "$_PORT_PID" ] && _all_up=false
    fi
    if [ "$START_NEXT" = "true" ]; then
        _port_pid "$NEXT_PORT"
        [ -z "$_PORT_PID" ] && _all_up=false
    fi
    if [ "$_all_up" = "true" ]; then break; fi
    sleep 1
    _waited=$((_waited + 1))
    _invalidate_cache
done

# ── Health-check Flask /api/healthz once it's bound ──
READY_BODY=""
if [ "$START_FLASK" = "true" ]; then
    if curl -fsS "http://127.0.0.1:${FLASK_PORT}/api/healthz" >/dev/null 2>&1; then
        READY_BODY=$(curl -fsS "http://127.0.0.1:${FLASK_PORT}/api/healthz/ready" 2>/dev/null || echo '{"status":"unknown"}')
    fi
fi

# ── Final status + failure reporting ──
show_status

FAILED=()
_invalidate_cache
_refresh_port_cache
if [ "$START_FLASK" = "true" ]; then
    _port_pid "$FLASK_PORT"
    [ -z "$_PORT_PID" ] && FAILED+=("flask")
fi
if [ "$START_NEXT" = "true" ]; then
    _port_pid "$NEXT_PORT"
    [ -z "$_PORT_PID" ] && FAILED+=("next")
fi

if [ ${#FAILED[@]} -gt 0 ]; then
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
    echo -e "${RED}  STARTUP FAILURES${NC}"
    echo -e "${RED}════════════════════════════════════════════════════════════${NC}"
    for service in "${FAILED[@]}"; do
        log_file="$LOG_DIR/syslog-${service}.log"
        echo ""
        echo -e "${RED}[$service] failed to bind to its port. Last 30 log lines:${NC}"
        echo -e "${RED}────────────────────────────────────────────────────────────${NC}"
        if [ -f "$log_file" ]; then
            tail -n 30 "$log_file"
        else
            echo "(no log file yet)"
        fi
        echo -e "${RED}────────────────────────────────────────────────────────────${NC}"
    done
    echo ""
    echo -e "${RED}Fix the errors above and re-run ./start.sh.${NC}"
    exit 1
fi

if [ -n "$READY_BODY" ]; then
    echo -e "  Earth Engine readiness: ${READY_BODY}"
fi
if [ "$START_NEXT" = "true" ]; then
    echo -e "  Open ${CYAN}http://127.0.0.1:${NEXT_PORT}${NC} in your browser."
fi
echo ""
echo -e "  Tail logs:    ${CYAN}./start.sh logs${NC}"
echo -e "  Show status:  ${CYAN}./start.sh status${NC}"
echo -e "  Restart all:  ${CYAN}./start.sh${NC}"
echo -e "  Restart one:  ${CYAN}./start.sh backend${NC}  /  ${CYAN}./start.sh frontend${NC}"
echo -e "  Stop:         ${CYAN}./start.sh stop${NC}"
echo ""
