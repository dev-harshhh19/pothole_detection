"""
visualizer.py
=============
HUD and graphical overlay engine for real-time video stream.
Renders detection bounding boxes, severity badges, distance markers,
and camera telemetry with clean anti-aliasing.
"""

from typing import List, Optional
import time

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from .pothole_detector import PotholeDetection
from .config import DetectionConfig

# Color Palette (BGR)
COLOR_MINOR = (0, 220, 255)       # Yellow
COLOR_MODERATE = (0, 140, 255)    # Orange
COLOR_SEVERE = (30, 30, 255)      # Red / Crimson
COLOR_ROI = (0, 200, 100)         # Soft Emerald Green
COLOR_BG_DARK = (20, 20, 25)      # Dark HUD Background
COLOR_TEXT_WHITE = (255, 255, 255)
COLOR_TEXT_DIM = (180, 180, 180)


class HUDVisualizer:
    """Renders overlays, bounding boxes, and telemetry on the video frame."""

    def __init__(self, config: Optional[DetectionConfig] = None):
        self.config = config or DetectionConfig()
        self.total_potholes_count = 0
        self.last_alert_time = 0.0
        self.last_alert_severity = ""

    def register_alert(self, detection: PotholeDetection):
        """Update HUD alert state."""
        self.total_potholes_count += 1
        self.last_alert_time = time.time()
        self.last_alert_severity = detection.severity

    def render(
        self,
        frame_bgr: np.ndarray,
        detections: List[PotholeDetection],
        fps: float,
        camera_name: str = "Zebronics Zeb-Crystal Clear",
        show_roi: bool = True,
    ) -> np.ndarray:
        """Draw detection overlays and HUD on the frame."""
        if not HAS_OPENCV or frame_bgr is None:
            return frame_bgr

        annotated = frame_bgr.copy()
        h, w = annotated.shape[:2]

        # 1. Draw Road ROI Boundary
        if show_roi:
            roi_pts = np.array(
                [
                    [int(px * w), int(py * h)]
                    for px, py in self.config.roi_polygon_normalized
                ],
                dtype=np.int32,
            )
            # Semi-transparent polygon overlay
            overlay = annotated.copy()
            cv2.polylines(overlay, [roi_pts], isClosed=True, color=COLOR_ROI, thickness=1, lineType=cv2.LINE_AA)
            cv2.addWeighted(overlay, 0.7, annotated, 0.3, 0, annotated)

        # 2. Draw Detections
        for det in detections:
            x, y, bw, bh = det.bbox

            if det.severity == "Severe / Dangerous":
                box_color = COLOR_SEVERE
            elif det.severity == "Moderate":
                box_color = COLOR_MODERATE
            else:
                box_color = COLOR_MINOR

            # Draw contour rim
            if det.contour is not None:
                cv2.drawContours(annotated, [det.contour], -1, box_color, 2, cv2.LINE_AA)

            # Draw bounding box
            cv2.rectangle(annotated, (x, y), (x + bw, y + bh), box_color, 2, cv2.LINE_AA)

            # Draw badge header
            label = f"#{det.id} {det.severity} | {det.distance_m}m | {det.diameter_cm}cm"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 0.42
            thickness = 1
            (text_w, text_h), baseline = cv2.getTextSize(label, font, font_scale, thickness)

            badge_y = max(text_h + 8, y - 6)
            cv2.rectangle(
                annotated,
                (x, badge_y - text_h - 4),
                (x + text_w + 8, badge_y + 2),
                box_color,
                cv2.FILLED,
            )
            cv2.putText(
                annotated,
                label,
                (x + 4, badge_y - 2),
                font,
                font_scale,
                (0, 0, 0),
                thickness,
                cv2.LINE_AA,
            )

        # 3. Top Telemetry Bar
        self._draw_hud_bar(annotated, w, h, fps, camera_name)

        return annotated

    def _draw_hud_bar(self, frame: np.ndarray, width: int, height: int, fps: float, camera_name: str):
        """Render upper status banner with system diagnostics."""
        bar_height = 42

        # Translucent dark bar across top
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 0), (width, bar_height), COLOR_BG_DARK, cv2.FILLED)
        cv2.addWeighted(overlay, 0.85, frame, 0.15, 0, frame)

        # Bottom accent divider line
        cv2.line(frame, (0, bar_height), (width, bar_height), (50, 50, 60), 1)

        font = cv2.FONT_HERSHEY_SIMPLEX

        # Left: Device & FPS
        dev_text = f"{camera_name} ({width}x{height})"
        cv2.putText(frame, dev_text, (10, 18), font, 0.42, COLOR_TEXT_WHITE, 1, cv2.LINE_AA)

        fps_text = f"STREAM: {fps:.1f} FPS"
        fps_color = (0, 255, 120) if fps >= 20.0 else (0, 180, 255)
        cv2.putText(frame, fps_text, (10, 34), font, 0.38, fps_color, 1, cv2.LINE_AA)

        # Right: Total Detections & Alert Status
        count_text = f"POTHOLES: {self.total_potholes_count}"
        (cw, _), _ = cv2.getTextSize(count_text, font, 0.45, 1)
        cv2.putText(frame, count_text, (width - cw - 12, 18), font, 0.45, COLOR_TEXT_WHITE, 1, cv2.LINE_AA)

        # Flash alert status for 2.0s after detection
        now = time.time()
        is_alerting = (now - self.last_alert_time) < 2.0
        if is_alerting:
            status_text = f"ALERT: {self.last_alert_severity.upper()}"
            status_color = COLOR_SEVERE
        else:
            status_text = "ROAD SCANNING ACTIVE"
            status_color = (120, 200, 120)

        (sw, _), _ = cv2.getTextSize(status_text, font, 0.38, 1)
        cv2.putText(frame, status_text, (width - sw - 12, 34), font, 0.38, status_color, 1, cv2.LINE_AA)
