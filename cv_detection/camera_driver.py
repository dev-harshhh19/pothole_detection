"""
camera_driver.py
================
Optimized camera driver for the Zebronics Zeb-Crystal Clear Web Camera
and standard UVC USB webcams on Raspberry Pi (Linux V4L2) and PC.

Key optimizations:
- V4L2 backend with hardware MJPG decompression to prevent USB 2.0 bottlenecks.
- Buffer size 1 to ensure zero-latency frame processing.
- Threaded grabber loop for consistent, non-blocking 30 FPS throughput.
- Auto-reconnect on USB vibration/disconnect during motorcycle rides.
"""

import logging
import platform
import threading
import time
from pathlib import Path
from typing import Optional, Tuple, Union

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from .config import CameraConfig

logger = logging.getLogger("cv.camera")


def list_camera_devices() -> list:
    """Scan available video capture devices."""
    devices = []
    if not HAS_OPENCV:
        logger.warning("OpenCV is not installed. Cannot probe camera devices.")
        return devices

    is_linux = platform.system() == "Linux"
    if is_linux:
        video_nodes = sorted(list(Path("/dev").glob("video*")))
        for node in video_nodes:
            idx = node.name.replace("video", "")
            if idx.isdigit():
                idx_int = int(idx)
                cap = cv2.VideoCapture(idx_int, cv2.CAP_V4L2)
                if cap.isOpened():
                    devices.append(idx_int)
                    cap.release()
    else:
        # Windows / macOS index probe (check 0 to 4)
        for i in range(5):
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                devices.append(i)
                cap.release()
    return devices


class ZebronicsCamera:
    """Direct hardware controller for Zebronics Zeb-Crystal Clear USB Webcam."""

    def __init__(self, config: Optional[CameraConfig] = None, source: Optional[Union[int, str]] = None):
        if not HAS_OPENCV:
            raise RuntimeError(
                "OpenCV (cv2) is required for ZebronicsCamera. "
                "Install it with: pip install opencv-python or sudo apt-get install python3-opencv"
            )

        self.config = config or CameraConfig()
        self.source = source if source is not None else self.config.device_index
        self.cap: Optional[cv2.VideoCapture] = None
        self.is_video_file = isinstance(self.source, str) and Path(self.source).exists()
        self.actual_width = 0
        self.actual_height = 0
        self.actual_fps = 0.0

    def open(self) -> bool:
        """Open and configure the camera hardware."""
        is_linux = platform.system() == "Linux"

        if self.is_video_file:
            logger.info(f"Opening video file source: {self.source}")
            self.cap = cv2.VideoCapture(str(self.source))
        else:
            # USB Webcam configuration
            backend = cv2.CAP_V4L2 if (is_linux and self.config.use_v4l2) else cv2.CAP_ANY
            logger.info(
                f"Opening Zebronics webcam index={self.source} "
                f"with backend={'V4L2' if backend == cv2.CAP_V4L2 else 'DEFAULT'}"
            )
            self.cap = cv2.VideoCapture(int(self.source), backend)

        if not self.cap.isOpened():
            logger.error(f"Failed to open video source: {self.source}")
            return False

        if not self.is_video_file:
            # 1. FourCC Codec: MJPG is essential for Zebronics on Raspberry Pi USB 2.0
            if self.config.fourcc:
                fourcc_code = cv2.VideoWriter_fourcc(*self.config.fourcc)
                self.cap.set(cv2.CAP_PROP_FOURCC, fourcc_code)

            # 2. Frame Resolution
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)

            # 3. Framerate
            self.cap.set(cv2.CAP_PROP_FPS, self.config.fps)

            # 4. Zero buffer lag (prevents reading outdated frames)
            try:
                self.cap.set(cv2.CAP_PROP_BUFFERSIZE, self.config.buffer_size)
            except Exception:
                pass

            # 5. Optional hardware attributes
            if self.config.brightness is not None:
                self.cap.set(cv2.CAP_PROP_BRIGHTNESS, self.config.brightness)
            if self.config.contrast is not None:
                self.cap.set(cv2.CAP_PROP_CONTRAST, self.config.contrast)
            if self.config.exposure is not None:
                self.cap.set(cv2.CAP_PROP_EXPOSURE, self.config.exposure)

        # Read back actual configured parameters
        self.actual_width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.actual_height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.actual_fps = float(self.cap.get(cv2.CAP_PROP_FPS))

        logger.info(
            f"Zebronics camera initialized: {self.actual_width}x{self.actual_height} "
            f"@ {self.actual_fps:.1f} FPS"
        )
        return True

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:
        """Read a single frame from the camera."""
        if self.cap is None or not self.cap.isOpened():
            return False, None

        ret, frame = self.cap.read()
        if not ret and self.is_video_file:
            # Auto-loop video file for testing
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = self.cap.read()

        return ret, frame

    def release(self):
        """Release camera resources."""
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            logger.info("Zebronics camera released.")


class CameraStreamThread:
    """
    Background worker thread that continually fetches frames from Zebronics camera.
    Provides non-blocking access to the most recent frame and automatically
    reconnects if the USB cable is disturbed.
    """

    def __init__(self, config: Optional[CameraConfig] = None, source: Optional[Union[int, str]] = None):
        self.camera = ZebronicsCamera(config=config, source=source)
        self.running = False
        self.thread: Optional[threading.Thread] = None

        self._lock = threading.Lock()
        self._latest_frame: Optional[np.ndarray] = None
        self._frame_timestamp: float = 0.0
        self._frame_id: int = 0

        # Performance metrics
        self.measured_fps: float = 0.0
        self._fps_counter: int = 0
        self._fps_start_time: float = time.time()
        self.connected: bool = False

    def start(self) -> bool:
        """Start the background camera reading thread."""
        if not self.camera.open():
            logger.error("Could not open camera. Cannot start stream thread.")
            return False

        self.running = True
        self.connected = True
        self.thread = threading.Thread(target=self._worker_loop, daemon=True, name="ZebronicsCameraThread")
        self.thread.start()
        logger.info("Camera stream thread started.")
        return True

    def stop(self):
        """Stop worker thread and release hardware."""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.5)
        self.camera.release()
        self.connected = False
        logger.info("Camera stream thread stopped.")

    def get_latest_frame(self) -> Tuple[bool, Optional[np.ndarray], float, int]:
        """
        Get the latest frame without blocking.
        Returns:
            (is_valid, frame_bgr, timestamp, frame_id)
        """
        with self._lock:
            if self._latest_frame is None:
                return False, None, 0.0, 0
            return True, self._latest_frame.copy(), self._frame_timestamp, self._frame_id

    def _worker_loop(self):
        """Continuous grab loop."""
        reconnect_attempts = 0

        while self.running:
            success, frame = self.camera.read()

            if success and frame is not None:
                now = time.time()
                with self._lock:
                    self._latest_frame = frame
                    self._frame_timestamp = now
                    self._frame_id += 1

                # Update FPS estimation
                self._fps_counter += 1
                elapsed = now - self._fps_start_time
                if elapsed >= 1.0:
                    self.measured_fps = self._fps_counter / elapsed
                    self._fps_counter = 0
                    self._fps_start_time = now
                    reconnect_attempts = 0
                    self.connected = True
            else:
                self.connected = False
                if not self.camera.config.auto_reconnect or self.camera.is_video_file:
                    logger.warning("Camera read failed. Exiting stream loop.")
                    break

                # Reconnect logic for USB webcam
                reconnect_attempts += 1
                if reconnect_attempts > self.camera.config.max_reconnect_attempts:
                    logger.error("Max camera reconnection attempts exceeded. Stopping stream.")
                    break

                logger.warning(
                    f"Camera stream disconnected! Retrying reconnect ({reconnect_attempts}/"
                    f"{self.camera.config.max_reconnect_attempts}) in "
                    f"{self.camera.config.reconnect_interval_s}s..."
                )
                self.camera.release()
                time.sleep(self.camera.config.reconnect_interval_s)
                self.camera.open()

            # Small yield to prevent thread starvation
            time.sleep(0.001)

        self.connected = False
