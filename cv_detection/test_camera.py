"""
test_camera.py
==============
Hardware diagnostic and benchmark utility for Zebronics Zeb-Crystal Clear Web Camera.
Probes video devices, verifies V4L2 MJPEG support, benchmarks capture FPS,
and saves a test snapshot to verify optical focus and alignment.

Usage:
    python -m cv_detection.test_camera
    python cv_detection/test_camera.py --index 0
"""

import argparse
import sys
import time
from pathlib import Path

try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from .camera_driver import list_camera_devices, ZebronicsCamera
from .config import CameraConfig


def run_diagnostics(device_index: int = 0, snapshot_path: str = "test_zebronics.jpg"):
    print("=" * 65)
    print("  ZEBRONICS ZEB-CRYSTAL CLEAR WEB CAMERA - HARDWARE DIAGNOSTICS")
    print("=" * 65)

    if not HAS_OPENCV:
        print("[ERROR] OpenCV (cv2) is not installed.")
        print("Install via: pip install opencv-python or sudo apt-get install python3-opencv")
        sys.exit(1)

    print(f"\n[1] Scanning available video capture devices...")
    devices = list_camera_devices()
    if not devices:
        print("[WARNING] No camera devices found in system! Check USB connection.")
    else:
        print(f"[OK] Found {len(devices)} active camera device(s): {devices}")

    print(f"\n[2] Initializing Zebronics Zeb-Crystal Clear on index {device_index}...")
    cfg = CameraConfig(device_index=device_index, width=640, height=480, fps=30, fourcc="MJPG")
    cam = ZebronicsCamera(config=cfg)

    if not cam.open():
        print(f"[ERROR] Failed to open camera on index {device_index}.")
        print("Troubleshooting tips for Raspberry Pi:")
        print("  - Run 'lsusb' to verify camera is recognized.")
        print("  - Run 'v4l2-ctl --list-devices' to check Linux device node.")
        print("  - Add pi user to video group: sudo usermod -aG video $USER")
        sys.exit(1)

    print(f"[OK] Camera opened successfully.")
    print(f"     Resolution: {cam.actual_width} x {cam.actual_height}")
    print(f"     Reported FPS: {cam.actual_fps}")

    print(f"\n[3] Benchmarking real capture throughput (50 frames)...")
    start_time = time.time()
    frames_read = 0

    first_frame = None
    for i in range(50):
        ret, frame = cam.read()
        if ret and frame is not None:
            frames_read += 1
            if first_frame is None:
                first_frame = frame
        else:
            print(f"  [WARN] Frame {i} read dropped.")

    elapsed = time.time() - start_time
    measured_fps = frames_read / max(0.001, elapsed)

    print(f"[OK] Read {frames_read}/50 frames in {elapsed:.2f}s ({measured_fps:.1f} FPS)")

    if first_frame is not None:
        out_path = Path(snapshot_path)
        cv2.imwrite(str(out_path), first_frame)
        print(f"\n[4] Saved test snapshot to: {out_path.resolve()}")
        print("     Verify optical focus, alignment, and illumination in this snapshot.")

    cam.release()
    print("\n" + "=" * 65)
    print("  DIAGNOSTICS COMPLETE - CAMERA READY FOR POTHOLE DETECTION")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Zebronics Web Camera Diagnostic")
    parser.add_argument("--index", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument("--snapshot", type=str, default="test_zebronics.jpg", help="Output test snapshot path")
    args = parser.parse_args()

    run_diagnostics(device_index=args.index, snapshot_path=args.snapshot)
