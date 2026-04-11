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

# Returns ALL pids holding the listening socket on the given port (in
# $_PORT_PIDS). Critical for `flask run --debug`: Werkzeug spawns a reloader
# child that inherits the listen socket, so killing only the parent leaves
# the orphan squatting on the port and the next bind() fails with EADDRINUSE.
_port_pids() {
    if [ "$_LSOF_CACHE_VALID" != "true" ]; then
        _refresh_port_cache
    fi
    _PORT_PIDS=$(echo "$_LSOF_CACHE" | grep ":$1 " | awk '{print $2}' | sort -u)
}

_invalidate_cache() { _LSOF_CACHE_VALID=false; }

# ── Subcommand parsing ──
START_FLASK=false
START_NEXT=false
ACTION="start"
QUIET=false
LOGS_FILTER=""  # empty = both, "flask" or "next" = single service

usage() {
    cat <<'EOF'
Network Inspector — dev orchestrator

USAGE:
    ./start.sh [COMMAND] [OPTIONS]

COMMANDS:
    (none)              Start both Flask and Next.js (kills any existing instances first)
    restart             Alias for the no-arg default
    backend             Start/restart only Flask (port 5050)
    frontend            Start/restart only Next.js (port 3666)
    stop                Stop both services
    status              Show running state and health-check the services
    logs                Tail both logs interleaved (Ctrl+C stops tail; services keep running)
    logs flask          Tail only the Flask log
    logs next           Tail only the Next.js log
    -h, --help          Show this help

OPTIONS:
    -q, --quiet         Skip the 10-second startup log tail (services still start)

ENVIRONMENT (read from .env at repo root):
    FLASK_RUN_PORT      Flask port (default: 5050)
    NEXT_PORT           Next.js port (default: 3666)
    FLASK_BACKEND_URL   Where Next.js rewrites /api/* (default: http://127.0.0.1:5050)
    NETINSPECT_SKIP_EE_INIT=1   Skip Earth Engine init (default in .env.example)

BEHAVIOR:
    Services run in the BACKGROUND after this script exits. Output is piped to
    _log/syslog-{flask,next}.log with line-level timestamps. Use `./start.sh logs`
    to see live output, `./start.sh status` to check health, `./start.sh stop` to
    terminate.

    Code edits are picked up automatically (Flask --debug + Next.js dev hot reload).
    Just save and refresh — no need to re-run this script.

EXAMPLES:
    ./start.sh                  # first time today
    ./start.sh status           # what's running?
    ./start.sh logs flask       # watch backend logs only
    ./start.sh restart          # cold restart everything
    ./start.sh backend          # restart only Flask after a Python change
    ./start.sh stop             # done for the day

See README.md for the full project picture.
EOF
}

# Parse all args (positional + flags). Flags can appear anywhere.
# Subcommand is the first non-flag positional. Logs takes an optional second
# positional for per-service filtering.
_first_positional=""
_second_positional=""
for arg in "$@"; do
    case "$arg" in
        -q|--quiet)  QUIET=true ;;
        -h|--help)   usage; exit 0 ;;
        -*)
            echo -e "${RED}Unknown flag: $arg${NC}" >&2
            echo "Run './start.sh --help' for usage." >&2
            exit 1
            ;;
        *)
            if [ -z "$_first_positional" ]; then
                _first_positional="$arg"
            elif [ -z "$_second_positional" ]; then
                _second_positional="$arg"
            else
                echo -e "${RED}Too many arguments: $arg${NC}" >&2
                echo "Run './start.sh --help' for usage." >&2
                exit 1
            fi
            ;;
    esac
done

if [ -z "$_first_positional" ]; then
    # No subcommand → start both
    START_FLASK=true
    START_NEXT=true
else
    case "$_first_positional" in
        start|restart)  START_FLASK=true; START_NEXT=true ;;
        backend)        START_FLASK=true ;;
        frontend)       START_NEXT=true ;;
        stop)           ACTION="stop" ;;
        status)         ACTION="status" ;;
        logs)
            ACTION="logs"
            if [ -n "$_second_positional" ]; then
                case "$_second_positional" in
                    flask|next) LOGS_FILTER="$_second_positional" ;;
                    *)
                        echo -e "${RED}Unknown log target: $_second_positional${NC}" >&2
                        echo "Valid: flask, next (or omit to tail both)" >&2
                        exit 1
                        ;;
                esac
            fi
            ;;
        *)
            echo -e "${RED}Unknown command: $_first_positional${NC}" >&2
            echo "Run './start.sh --help' for usage." >&2
            exit 1
            ;;
    esac
fi

# ── Subcommand: status ──
# Shows port-binding state AND a real health check via /api/healthz. Port-binding
# alone is not proof of life — we hit zombie reloader children that bound to the
# port but couldn't import their own module. The health column catches that.
show_status() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  Network Inspector — service status${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    _refresh_port_cache
    local running=0
    local stopped=0
    local unhealthy=0
    for entry in "${ALL_SERVICES[@]}"; do
        IFS='|' read -r name port color url <<< "$entry"
        local trimmed_name=$(echo "$name" | tr -d ' ')
        _port_pid "$port"
        if [ -n "$_PORT_PID" ]; then
            local health="?"
            local health_label=""
            # Health-check by service. Flask: hit /api/healthz directly.
            # Next.js: hit / via the rewrite path (proves the rewrite + frontend
            # are both alive). Short timeout so a hung process doesn't block status.
            case "$trimmed_name" in
                flask)
                    if curl -fsS -m 2 "http://127.0.0.1:${port}/api/healthz" >/dev/null 2>&1; then
                        health="${GREEN}healthy${NC}"
                    else
                        health="${RED}unresponsive${NC}"
                        unhealthy=$((unhealthy + 1))
                    fi
                    ;;
                next)
                    if curl -fsS -m 2 -o /dev/null "http://127.0.0.1:${port}/" 2>/dev/null; then
                        health="${GREEN}healthy${NC}"
                    else
                        health="${RED}unresponsive${NC}"
                        unhealthy=$((unhealthy + 1))
                    fi
                    ;;
            esac
            echo -e "  ${color}● ${name}${NC}  ${CYAN}${url}${NC}  pid ${_PORT_PID}  [${health}]"
            running=$((running + 1))
        else
            echo -e "  ${RED}○ ${name}${NC}  stopped"
            stopped=$((stopped + 1))
        fi
    done
    echo ""
    if [ $unhealthy -gt 0 ]; then
        echo -e "  ${GREEN}${running} running${NC}, ${YELLOW}${unhealthy} unresponsive${NC}, ${RED}${stopped} stopped${NC}"
        echo -e "  ${YELLOW}Hint: an unresponsive service is bound to its port but not serving requests.${NC}"
        echo -e "  ${YELLOW}      Try: ./start.sh stop && ./start.sh${NC}"
    else
        echo -e "  ${GREEN}${running} running${NC}, ${RED}${stopped} stopped${NC}"
    fi
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
        _port_pids "$port"
        if [ -n "$_PORT_PIDS" ]; then
            local pid_list=$(echo $_PORT_PIDS | tr '\n' ' ')
            echo -e "  ${YELLOW}Stopping $name on :$port (pids ${pid_list})${NC}"
            # Unquoted on purpose: $_PORT_PIDS may contain multiple pids
            # (parent + Werkzeug reloader child for `flask --debug`).
            kill -9 $_PORT_PIDS 2>/dev/null || true
            stopped=$((stopped + 1))
        else
            echo -e "  $name: not running"
        fi
    done
    if [ $stopped -gt 0 ]; then
        # Give the kernel a beat to release the listening sockets after the
        # orphaned reloader child dies.
        sleep 2
        _invalidate_cache
        _refresh_port_cache
        local still_up=0
        for entry in "${ALL_SERVICES[@]}"; do
            IFS='|' read -r name port _ _ <<< "$entry"
            _port_pids "$port"
            if [ -n "$_PORT_PIDS" ]; then
                local pid_list=$(echo $_PORT_PIDS | tr '\n' ' ')
                echo -e "  ${RED}$name still running on :$port (pids ${pid_list})${NC}"
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
# LOGS_FILTER (set by the parser) controls which log file(s) to tail.
# Empty   → both, interleaved (tail -F headers separate them with ==> file <==)
# "flask" → only the Flask log
# "next"  → only the Next.js log
show_logs() {
    echo ""
    case "$LOGS_FILTER" in
        flask)
            touch "$FLASK_LOG"
            if [ ! -s "$FLASK_LOG" ]; then
                echo -e "${YELLOW}Note: $FLASK_LOG is empty. Did you start the service yet?${NC}"
                echo -e "${YELLOW}      Run: ./start.sh backend${NC}"
                echo ""
            fi
            echo -e "${CYAN}Tailing flask log (Ctrl+C stops tail; service keeps running):${NC}"
            echo -e "  ${FLASK_COLOR}$FLASK_LOG${NC}"
            echo ""
            tail -F "$FLASK_LOG"
            ;;
        next)
            touch "$NEXT_LOG"
            if [ ! -s "$NEXT_LOG" ]; then
                echo -e "${YELLOW}Note: $NEXT_LOG is empty. Did you start the service yet?${NC}"
                echo -e "${YELLOW}      Run: ./start.sh frontend${NC}"
                echo ""
            fi
            echo -e "${CYAN}Tailing next log (Ctrl+C stops tail; service keeps running):${NC}"
            echo -e "  ${NEXT_COLOR}$NEXT_LOG${NC}"
            echo ""
            tail -F "$NEXT_LOG"
            ;;
        *)
            touch "$FLASK_LOG" "$NEXT_LOG"
            local has_content=false
            [ -s "$FLASK_LOG" ] && has_content=true
            [ -s "$NEXT_LOG" ] && has_content=true
            if [ "$has_content" = "false" ]; then
                echo -e "${YELLOW}Note: both log files are empty. Did you start the services yet?${NC}"
                echo -e "${YELLOW}      Run: ./start.sh${NC}"
                echo ""
            fi
            echo -e "${CYAN}Tailing both logs (Ctrl+C stops tail; services keep running):${NC}"
            echo -e "  ${FLASK_COLOR}flask:${NC} $FLASK_LOG"
            echo -e "  ${NEXT_COLOR}next: ${NC} $NEXT_LOG"
            echo ""
            echo -e "  ${YELLOW}Tip: ./start.sh logs flask  (or 'next') tails just one${NC}"
            echo ""
            # tail -F follows by name across log rotations / re-creates.
            # Separators between files are auto-printed by tail when both are
            # given as args, helping the user disambiguate the streams.
            tail -F "$FLASK_LOG" "$NEXT_LOG"
            ;;
    esac
}

case "$ACTION" in
    stop)   stop_all; exit 0 ;;
    status) show_status; exit 0 ;;
    logs)   show_logs; exit 0 ;;
esac

# ── Start path ──

# Pre-flight: venv must exist
if [ ! -d ".venv" ]; then
    echo -e "${RED}❌ Python venv not found at .venv/${NC}" >&2
    echo "" >&2
    echo "   The project isn't set up yet. Fix:" >&2
    echo "" >&2
    echo -e "     ${CYAN}./setup.sh${NC}" >&2
    echo "" >&2
    echo "   (creates .venv, installs Python + Node deps, copies .env)" >&2
    exit 1
fi
# Pre-flight: frontend deps must exist (only if we're starting Next.js)
if [ "$START_NEXT" = "true" ] && [ ! -d "frontend/node_modules" ]; then
    echo -e "${RED}❌ Next.js dependencies not found at frontend/node_modules/${NC}" >&2
    echo "" >&2
    echo "   Fix:" >&2
    echo "" >&2
    echo -e "     ${CYAN}cd frontend && npm install${NC}" >&2
    echo "" >&2
    echo -e "   (or just run ${CYAN}./setup.sh${NC} to do everything)" >&2
    exit 1
fi
# Pre-flight: .env warning (non-fatal — script falls back to defaults).
# A missing .env means the user hasn't run setup.sh, OR they're running on
# a fresh checkout. The script can still boot with hardcoded defaults, but
# the user should know that's what's happening.
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠  .env not found. Using defaults: FLASK_RUN_PORT=${FLASK_PORT}, NEXT_PORT=${NEXT_PORT}${NC}"
    echo -e "${YELLOW}   To customize: cp .env.example .env  (or run ./setup.sh)${NC}"
    echo ""
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
    _port_pids "$port"
    if [ -n "$_PORT_PIDS" ]; then
        pid_list=$(echo $_PORT_PIDS | tr '\n' ' ')
        echo -e "  ${YELLOW}Killing existing $name on :$port (pids ${pid_list})${NC}"
        # Unquoted: $_PORT_PIDS may contain multiple pids (parent + Werkzeug
        # reloader child for `flask --debug`). Killing only the parent leaves
        # the orphaned child squatting on the listen socket.
        kill -9 $_PORT_PIDS 2>/dev/null || true
        KILLED_ANY=true
    fi
done
if [ "$KILLED_ANY" = "true" ]; then
    # Two seconds, not one — the orphaned reloader child needs a beat to
    # actually die after kill -9 propagates and release the listening socket
    # back to the kernel, otherwise the next bind() races and EADDRINUSE.
    sleep 2
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
# Skipped if --quiet was passed. Power users / CI runs benefit from skipping
# this; first-time users want the safety net of seeing what's happening.
if [ "$QUIET" != "true" ]; then
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
fi

# ── Wait for services to bind to their ports ──
echo ""
echo "Waiting for services to be ready..."
_max_wait=20
_waited=0
_timed_out=true
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
    if [ "$_all_up" = "true" ]; then
        _timed_out=false
        break
    fi
    sleep 1
    _waited=$((_waited + 1))
    _invalidate_cache
done

if [ "$_timed_out" = "true" ]; then
    echo -e "${YELLOW}⚠  TIMED OUT after ${_max_wait}s waiting for one or more services to bind to their ports.${NC}"
    echo -e "${YELLOW}   Continuing to status check — failure dump (if any) will follow.${NC}"
fi

# ── Health-check Flask /api/healthz once it's bound, interpret EE readiness ──
# F3: We do NOT print raw {"status":"degraded","error":"..."} JSON because that
# scares first-time users. Instead, parse it and print a one-line interpretation.
# Note: /api/healthz/ready returns 503 when EE is unavailable BUT the body is
# still the JSON we want. Use `curl -sS` (no -f) so we capture the body on 5xx.
EE_STATUS=""
if [ "$START_FLASK" = "true" ]; then
    if curl -fsS -m 2 "http://127.0.0.1:${FLASK_PORT}/api/healthz" >/dev/null 2>&1; then
        _ready_raw=$(curl -sS -m 2 "http://127.0.0.1:${FLASK_PORT}/api/healthz/ready" 2>/dev/null || echo "")
        # Flask jsonify pretty-prints with `"status": "ok"` (space after colon),
        # so the regex must allow optional whitespace between : and the value.
        if echo "$_ready_raw" | grep -qE '"status":[[:space:]]*"ok"'; then
            EE_STATUS="ok"
        elif echo "$_ready_raw" | grep -qE '"status":[[:space:]]*"degraded"'; then
            EE_STATUS="degraded"
        else
            EE_STATUS="unknown"
        fi
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

# Scan a service log for known failure patterns and print actionable hints.
# Hints are categorized by what the academic-collaborator persona is most likely
# to hit: missing deps, port collisions, EE auth, file watcher limits, .env typos.
# Each hint says PROBLEM + EXACT FIX so the user doesn't have to guess.
suggest_fix_for_log() {
    local log_file="$1"
    local service="$2"
    [ ! -f "$log_file" ] && return 0
    [ ! -s "$log_file" ] && return 0

    local tail_content
    tail_content=$(tail -n 50 "$log_file" 2>/dev/null)
    local hints=""

    # Generic: port collision (matches Werkzeug, Node, anything)
    if echo "$tail_content" | grep -qiE "address already in use|EADDRINUSE|port .* is in use"; then
        hints="${hints}    • Port already in use. Try: ./start.sh stop && ./start.sh\n"
    fi

    case "$service" in
        flask)
            if echo "$tail_content" | grep -qE "ModuleNotFoundError|ImportError"; then
                hints="${hints}    • A Python import failed. Try: source .venv/bin/activate && pip install -r requirements.txt\n"
            fi
            if echo "$tail_content" | grep -qiE "EEException|earthengine.*not authenticated|EE auth"; then
                hints="${hints}    • Earth Engine init failed. Set NETINSPECT_SKIP_EE_INIT=1 in .env (or run \`earthengine authenticate\` once)\n"
            fi
            if echo "$tail_content" | grep -qiE "permission denied"; then
                hints="${hints}    • Permission denied. If FLASK_RUN_PORT is < 1024 it requires root — pick a port > 1024 in .env\n"
            fi
            if echo "$tail_content" | grep -qE "FileNotFoundError.*data/|Could not find file"; then
                hints="${hints}    • Data file missing. The Geofabrik shapefile + parquet are committed to data/. Run: git status data/\n"
            fi
            if echo "$tail_content" | grep -qiE "flask: command not found|No module named flask"; then
                hints="${hints}    • Flask not installed in this venv. Try: rm -rf .venv && ./setup.sh\n"
            fi
            ;;
        next)
            if echo "$tail_content" | grep -qE "Cannot find module|MODULE_NOT_FOUND"; then
                hints="${hints}    • A Node module is missing. Try: cd frontend && npm install\n"
            fi
            if echo "$tail_content" | grep -qiE "next: command not found|next: not found"; then
                hints="${hints}    • next.js binary missing. Try: cd frontend && rm -rf node_modules && npm install\n"
            fi
            if echo "$tail_content" | grep -q "ENOSPC"; then
                hints="${hints}    • File watcher limit hit (Linux). Try: sudo sysctl fs.inotify.max_user_watches=524288\n"
            fi
            if echo "$tail_content" | grep -qiE "error parsing.*\.env|invalid env"; then
                hints="${hints}    • .env file syntax error. Check the top-level .env for unbalanced quotes or stray characters.\n"
            fi
            if echo "$tail_content" | grep -qE "EACCES.*\.next|cannot create.*\.next"; then
                hints="${hints}    • Next.js can't write to .next/. Try: cd frontend && rm -rf .next\n"
            fi
            ;;
    esac

    if [ -n "$hints" ]; then
        echo ""
        echo -e "${YELLOW}Common causes for this failure:${NC}"
        printf "$hints"
    fi
}

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
        suggest_fix_for_log "$log_file" "$service"
    done
    echo ""
    echo -e "${RED}Fix the errors above and re-run ./start.sh.${NC}"
    exit 1
fi

case "$EE_STATUS" in
    ok)
        echo -e "  ${GREEN}Earth Engine: authenticated and reachable.${NC}"
        ;;
    degraded)
        echo -e "  ${YELLOW}Earth Engine: not configured (this is normal for fresh checkouts).${NC}"
        echo -e "  ${YELLOW}              Read endpoints work without it. The export endpoint needs it.${NC}"
        echo -e "  ${YELLOW}              To enable: \`earthengine authenticate\` then unset NETINSPECT_SKIP_EE_INIT in .env${NC}"
        ;;
    unknown)
        echo -e "  ${YELLOW}Earth Engine: status unknown (couldn't reach /api/healthz/ready).${NC}"
        ;;
esac
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
