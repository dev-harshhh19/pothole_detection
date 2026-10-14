"""
logger.py
=========
Detection event logging, telemetry records, and snapshot saving.
Maintains CSV log entries compatible with the existing telemetry datasets.
"""

import csv
import logging
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from .pothole_detector import PotholeDetection

logger = logging.getLogger("cv.logger")


class PotholeLogger:
    """Logs confirmed pothole detection events to disk with optional snapshot images."""

    def __init__(
        self,
        log_csv_path: Path = Path("cv_output/pothole_cv_log.csv"),
        snapshots_dir: Path = Path("cv_output/snapshots"),
        save_crops: bool = True,
        save_full_frames: bool = False,
    ):
        self.log_csv_path = Path(log_csv_path)
        self.snapshots_dir = Path(snapshots_dir)
        self.save_crops = save_crops
        self.save_full_frames = save_full_frames

        self._lock = threading.Lock()
        self._init_storage()

    def _init_storage(self):
        """Prepare CSV headers and snapshot directory."""
        self.snapshots_dir.mkdir(parents=True, exist_ok=True)
        self.log_csv_path.parent.mkdir(parents=True, exist_ok=True)

        if not self.log_csv_path.exists():
            with open(self.log_csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow([
                    "Timestamp",
                    "Time_ISO",
                    "ID",
                    "Severity",
                    "Confidence",
                    "Distance_m",
                    "Diameter_cm",
                    "Area_px",
                    "BBox_X",
                    "BBox_Y",
                    "BBox_W",
                    "BBox_H",
                    "Snapshot_File",
                ])

    def log_detection(self, detection: PotholeDetection, full_frame: Optional[np.ndarray] = None):
        """Record detection event and save snapshot images."""
        now = time.time()
        time_iso = datetime.fromtimestamp(now).strftime("%Y-%m-%d %H:%M:%S")
        ts_slug = datetime.fromtimestamp(now).strftime("%Y%m%d_%H%M%S_%f")[:19]

        snapshot_name = ""

        # 1. Save crop snapshot
        if HAS_OPENCV and self.save_crops and detection.crop is not None:
            snapshot_name = f"pothole_{detection.id}_{ts_slug}.jpg"
            snap_path = self.snapshots_dir / snapshot_name
            try:
                cv2.imwrite(str(snap_path), detection.crop)
            except Exception as e:
                logger.warning(f"Could not save snapshot crop: {e}")

        # 2. Save full frame
        if HAS_OPENCV and self.save_full_frames and full_frame is not None:
            full_snap_name = f"full_{detection.id}_{ts_slug}.jpg"
            full_snap_path = self.snapshots_dir / full_snap_name
            try:
                cv2.imwrite(str(full_snap_path), full_frame)
            except Exception as e:
                logger.warning(f"Could not save full frame snapshot: {e}")

        # 3. Append to CSV
        x, y, w, h = detection.bbox
        row = [
            f"{now:.3f}",
            time_iso,
            detection.id,
            detection.severity,
            f"{detection.confidence:.2f}",
            f"{detection.distance_m:.2f}",
            f"{detection.diameter_cm:.1f}",
            f"{detection.area_px:.1f}",
            x,
            y,
            w,
            h,
            snapshot_name,
        ]

        with self._lock:
            with open(self.log_csv_path, "a", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(row)

        logger.info(
            f"[CV ALERT] #{detection.id} {detection.severity} | "
            f"Dist: {detection.distance_m}m | Diam: {detection.diameter_cm}cm | "
            f"Saved: {snapshot_name}"
        )
