#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
#  Pothole Detection System — Raspberry Pi 4B
#  Single-command launcher: starts everything in one terminal session.
#
#  Usage:
#    ./start.sh           → Setup (if needed) + realtime detector + dashboard
#    ./start.sh --dl      → Use the Deep Learning dashboard instead of ML
#    ./start.sh --setup   → Force re-run setup only
# ──────────────────────────────────────────────────────────────────────────────

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV="$PROJECT_DIR/venv"
PY="$VENV/bin/python"
ST="$VENV/bin/streamlit"
LIDAR_PORT="${LIDAR_PORT:-/dev/ttyUSB0}"

# ── Parse args ────────────────────────────────────────────────────────────────
USE_DL=false
FORCE_SETUP=false
for arg in "$@"; do
    case $arg in
        --dl)      USE_DL=true ;;
        --setup)   FORCE_SETUP=true ;;
    esac
done

# ── Colours ───────────────────────────────────────────────────────────────────
B="\033[1m"; G="\033[92m"; Y="\033[93m"; R="\033[91m"; C="\033[96m"; X="\033[0m"
info()  { echo -e "${G}${B}[✔]${X} $*"; }
warn()  { echo -e "${Y}${B}[!]${X} $*"; }
error() { echo -e "${R}${B}[✘]${X} $*"; exit 1; }
head()  { echo -e "\n${C}${B}━━━ $* ━━━${X}"; }

# ── Banner ────────────────────────────────────────────────────────────────────
clear
echo -e "${C}${B}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   🕳️  Pothole Detection System           ║"
echo "  ║       Raspberry Pi 4B  —  TF02-Pro       ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${X}"

# ── Setup ─────────────────────────────────────────────────────────────────────
do_setup() {
    head "Setup"

    info "Creating Python virtual environment …"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --upgrade pip --quiet

    info "Installing root requirements …"
    "$VENV/bin/pip" install -r "$PROJECT_DIR/requirements.txt" --quiet

    info "Installing DL_Model requirements …"
    "$VENV/bin/pip" install -r "$PROJECT_DIR/DL_Model/requirements.txt" --quiet

    if ! groups "$USER" | grep -qw dialout; then
        warn "Adding $USER to 'dialout' group for serial port access …"
        sudo usermod -aG dialout "$USER"
        warn "Group change applied. A re-login is needed for it to persist,"
        warn "but this session will proceed via 'sg dialout'."
    fi

    info "Setup complete."
}

# Run setup if venv missing or forced
if [ ! -f "$PY" ] || [ "$FORCE_SETUP" = true ]; then
    do_setup
fi

# ── Train models if missing ───────────────────────────────────────────────────
head "Checking Models"

if [ ! -f "$PROJECT_DIR/pothole_model.pkl" ]; then
    warn "ML model not found — training now …"
    cd "$PROJECT_DIR"
    "$PY" model_train.py
    info "ML model trained."
else
    info "ML model found."
fi

DL_MODEL="$PROJECT_DIR/DL_Model/models/pothole_dl_model.keras"
if [ ! -f "$DL_MODEL" ] && [ "$USE_DL" = true ]; then
    warn "DL model not found — training now (may take a few minutes) …"
    export CUDA_VISIBLE_DEVICES=-1
    cd "$PROJECT_DIR/DL_Model"
    "$PY" train.py
    info "DL model trained."
elif [ -f "$DL_MODEL" ]; then
    info "DL model found."
fi

# ── Network info ──────────────────────────────────────────────────────────────
PI_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
DASH_PORT=8501
[ "$USE_DL" = true ] && DASH_PORT=8502
DASH_SCRIPT="dashboard.py"
DASH_CWD="$PROJECT_DIR"
[ "$USE_DL" = true ] && DASH_SCRIPT="dashboard_dl.py" && DASH_CWD="$PROJECT_DIR/DL_Model"

# ── Trap: clean up on Ctrl+C ──────────────────────────────────────────────────
PIDS=()
cleanup() {
    echo ""
    warn "Shutting down …"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    info "All processes stopped. Goodbye!"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Start realtime detector in background ─────────────────────────────────────
head "Starting Real-Time LiDAR Detector"

if [ -e "$LIDAR_PORT" ]; then
    info "LiDAR found at $LIDAR_PORT"
    export CUDA_VISIBLE_DEVICES=-1
    cd "$PROJECT_DIR/DL_Model"
    "$PY" realtime_detector.py \
        --port "$LIDAR_PORT" \
        --baud 115200 \
        --no-plot \
        2>&1 | sed "s/^/  ${Y}[LiDAR]${X} /" &
    PIDS+=($!)
    info "Realtime detector running (PID $!)  — logs prefixed [LiDAR]"
else
    warn "LiDAR port $LIDAR_PORT not found — skipping realtime detector."
    warn "(Connect TF02-Pro and restart, or set: export LIDAR_PORT=/dev/ttyUSB1)"
fi

# ── Start Streamlit dashboard ─────────────────────────────────────────────────
head "Starting Dashboard"

sleep 1   # brief pause so detector logs settle before streamlit output
cd "$DASH_CWD"

echo ""
echo -e "  ${G}${B}Dashboard will be available at:${X}"
echo -e "  ${C}${B}  ➜  http://${PI_IP}:${DASH_PORT}${X}   (network)"
echo -e "  ${C}${B}  ➜  http://localhost:${DASH_PORT}${X}  (local)"
echo ""
echo -e "  ${Y}Press  Ctrl+C  to stop everything.${X}"
echo ""

export CUDA_VISIBLE_DEVICES=-1
"$ST" run "$DASH_SCRIPT" \
    --server.port="$DASH_PORT" \
    --server.address=0.0.0.0 \
    --server.headless=true \
    --server.enableCORS=false \
    --server.enableXsrfProtection=false \
    --browser.gatherUsageStats=false &
PIDS+=($!)

# ── Wait (keep terminal alive, Ctrl+C triggers cleanup) ───────────────────────
wait
