#!/bin/bash
# ------------------------------------------------------------------------------
# start_cv.sh
# Single-command launcher for Computer Vision Pothole Detection on Raspberry Pi 4B
# with Zebronics Zeb-Crystal Clear Web Camera.
#
# Usage:
#   ./start_cv.sh             # Launch headless with Web Stream (port 8080)
#   ./start_cv.sh --show      # Launch with GUI display window on connected monitor
#   ./start_cv.sh --test      # Run camera diagnostic benchmark test
#   ./start_cv.sh --setup     # Install CV dependencies (OpenCV, etc.)
# ------------------------------------------------------------------------------

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
STREAM_PORT=8080

# Colors
B="\033[1m"; G="\033[92m"; Y="\033[93m"; R="\033[91m"; C="\033[96m"; X="\033[0m"
info()  { echo -e "${G}${B}[OK]${X} $*"; }
warn()  { echo -e "${Y}${B}[WARN]${X} $*"; }
error() { echo -e "${R}${B}[ERROR]${X} $*"; exit 1; }
head()  { echo -e "\n${C}${B}=== $* ===${X}"; }

clear 2>/dev/null || true
echo -e "${C}${B}"
echo "  +---------------------------------------------------+"
echo "  |   Zebronics Zeb-Crystal Clear - CV Pothole Detection |"
echo "  |   Raspberry Pi 4B Real-Time Vision System         |"
echo "  +---------------------------------------------------+"
echo -e "${X}"

# Parse flags
ACTION="stream"
EXTRA_ARGS=()

for arg in "$@"; do
    case "$arg" in
        --show)
            ACTION="show"
            EXTRA_ARGS+=(--show)
            ;;
        --test)
            ACTION="test"
            ;;
        --setup)
            ACTION="setup"
            ;;
        *)
            EXTRA_ARGS+=("$arg")
            ;;
    esac
done

# Step 1: Detect or activate virtual environment
head "1. Python Environment"

if [ -d "$PROJECT_DIR/.venv" ]; then
    VENV_DIR="$PROJECT_DIR/.venv"
elif [ -d "$PROJECT_DIR/venv" ]; then
    VENV_DIR="$PROJECT_DIR/venv"
else
    VENV_DIR="$PROJECT_DIR/.venv"
fi

if [ -f "$VENV_DIR/bin/activate" ]; then
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
    info "Activated virtual environment: $VENV_DIR"
    PY="$VENV_DIR/bin/python"
    PIP="$VENV_DIR/bin/pip"
else
    PY="python3"
    PIP="pip3"
    warn "Running with system python3"
fi

# Step 2: Install dependencies if requested or missing
do_setup() {
    head "Installing Computer Vision Dependencies"
    info "Updating package lists..."
    sudo apt-get update -y || true

    info "Installing system OpenCV and V4L2 video utilities..."
    sudo apt-get install -y python3-opencv v4l-utils libv4l-dev || true

    info "Installing Python dependencies..."
    "$PIP" install -r "$PROJECT_DIR/cv_detection/cv_requirements.txt" || true

    # Add user to video group
    if ! id -nG "$USER" 2>/dev/null | grep -qw video; then
        info "Adding $USER to 'video' group for UVC camera access..."
        sudo usermod -aG video "$USER"
    fi
    info "Setup completed."
}

if [ "$ACTION" = "setup" ]; then
    do_setup
    exit 0
fi

# Verify OpenCV
if ! "$PY" -c "import cv2" >/dev/null 2>&1; then
    warn "OpenCV not found. Running automatic setup..."
    do_setup
fi

# Step 3: Check USB Camera Hardware
head "2. Checking Zebronics USB Camera"
if command -v v4l2-ctl >/dev/null 2>&1; then
    DEVICES=$(v4l2-ctl --list-devices 2>/dev/null || true)
    if [ -n "$DEVICES" ]; then
        echo "$DEVICES"
        info "Video devices detected."
    else
        warn "No video devices reported by v4l2-ctl. Ensure camera is plugged into a USB 3.0 / USB 2.0 port."
    fi
else
    if ls /dev/video* >/dev/null 2>&1; then
        info "Found camera device nodes: $(ls /dev/video*)"
    else
        warn "No /dev/video* devices found. Ensure webcam is securely connected."
    fi
fi

# Step 4: Run Mode
cd "$PROJECT_DIR"

if [ "$ACTION" = "test" ]; then
    head "3. Running Camera Diagnostics Benchmark"
    "$PY" -m cv_detection.test_camera
    exit 0
fi

HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

head "3. Starting CV Pothole Detection"
echo -e "  ${G}${B}Live Web Stream will be available at:${X}"
echo -e "  ${C}${B}  > http://${HOST_IP}:${STREAM_PORT}${X}  (Network)"
echo -e "  ${C}${B}  > http://localhost:${STREAM_PORT}${X} (Local)"
echo ""
echo -e "  ${Y}Press Ctrl+C to stop.${X}"
echo ""

if [ "$ACTION" = "show" ]; then
    "$PY" -m cv_detection.run_cv --show --stream --port "$STREAM_PORT" "${EXTRA_ARGS[@]}"
else
    # Default: headless with web streaming
    "$PY" -m cv_detection.run_cv --headless --stream --port "$STREAM_PORT" "${EXTRA_ARGS[@]}"
fi
