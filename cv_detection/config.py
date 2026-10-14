"""
config.py
=========
Configuration parameters for the Zebronics Zeb-Crystal Clear Web Camera
and the real-time Computer Vision Pothole Detection system on Raspberry Pi.
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple, List, Optional
import json


@dataclass
class CameraConfig:
    """Settings tailored for Zebronics Zeb-Crystal Clear USB webcam."""
    # Video device index (0 = default UVC camera /dev/video0)
    device_index: int = 0
    
    # Capture resolution (640x480 optimal for 30 FPS on Pi 4B CPU)
    # Zebronics Zeb-Crystal also supports 1280x720 (720p HD)
    width: int = 640
    height: int = 480
    fps: int = 30
    
    # FourCC codec: 'MJPG' uses webcam hardware compression, dramatically
    # reducing USB bandwidth and CPU bottleneck on Raspberry Pi.
    fourcc: str = "MJPG"
    
    # V4L2 backend preferred on Linux / Raspberry Pi OS
    use_v4l2: bool = True
    
    # Buffer size: 1 ensures zero-latency real-time processing (no queue lag)
    buffer_size: int = 1
    
    # Auto reconnection parameters
    auto_reconnect: bool = True
    reconnect_interval_s: float = 2.0
    max_reconnect_attempts: int = 10
    
    # Optional camera adjustments (None = camera hardware auto defaults)
    brightness: Optional[int] = None
    contrast: Optional[int] = None
    exposure: Optional[int] = None


@dataclass
class DetectionConfig:
    """Parameters for computer vision pothole detection algorithms."""
    # Region of Interest (Trapezoid road polygon relative coords [0.0 - 1.0])
    # [Top-Left, Top-Right, Bottom-Right, Bottom-Left]
    roi_polygon_normalized: List[Tuple[float, float]] = field(
        default_factory=lambda: [
            (0.20, 0.45),  # Top-left of oncoming road
            (0.80, 0.45),  # Top-right of oncoming road
            (0.98, 0.95),  # Bottom-right near vehicle front
            (0.02, 0.95),  # Bottom-left near vehicle front
        ]
    )
    
    # Preprocessing
    enable_clahe: bool = True
    clahe_clip_limit: float = 2.5
    clahe_grid_size: Tuple[int, int] = (8, 8)
    gaussian_blur_kernel: int = 7  # Must be odd
    
    # Dark depression / Shadow thresholding
    # Potholes appear as localized depressions with lower reflectance/shadows
    dark_thresh_block_size: int = 31  # Must be odd
    dark_thresh_c: int = 5
    
    # Canny edge detection for pothole rim gradient
    canny_thresh1: int = 35
    canny_thresh2: int = 110
    
    # Morphological operations
    morph_kernel_size: int = 5
    
    # Geometric contour filtering (filters out noise, gravel, and lane markings)
    min_area_px: int = 450         # Rejects tiny pebble shadows / noise
    max_area_px: int = 45000       # Rejects massive road segments / lighting shifts
    min_aspect_ratio: float = 0.35 # Rejects ultra-narrow vertical artifacts
    max_aspect_ratio: float = 2.80 # Rejects elongated horizontal lane markings / stripes
    min_solidity: float = 0.45     # Pothole craters have compact convex shapes
    min_circularity: float = 0.20  # Rejects straight lines / road boundaries
    
    # Severity bands based on contour pixel area (at 640x480)
    severity_minor_area: int = 1500
    severity_moderate_area: int = 5000
    
    # Tracking & Confirmation
    min_hits_to_alert: int = 2     # Must be tracked across at least 2 frames
    max_disappeared_frames: int = 4 # Drop track after 4 lost frames
    alert_cooldown_seconds: float = 1.5 # Avoid repeated alerts for the same pothole
    
    # Camera Mounting Geometry for Ground Distance Estimation
    camera_height_cm: float = 85.0       # Height of camera mount on bike/vehicle
    camera_pitch_angle_deg: float = 20.0 # Downward tilt angle relative to horizon
    camera_fov_vertical_deg: float = 55.0 # Vertical FOV of Zebronics Zeb-Crystal
    
    # Deep Learning / ONNX Model (Optional: used if model file exists)
    model_path: Optional[str] = "models/pothole_yolov8n.onnx"
    confidence_threshold: float = 0.40
    nms_iou_threshold: float = 0.45


@dataclass
class AppConfig:
    """Master application configuration."""
    camera: CameraConfig = field(default_factory=CameraConfig)
    detection: DetectionConfig = field(default_factory=DetectionConfig)
    
    # Output directories
    output_dir: Path = Path("cv_output")
    snapshots_dir: Path = Path("cv_output/snapshots")
    log_file: Path = Path("cv_output/pothole_cv_log.csv")
    
    # Web streaming server settings
    stream_host: str = "0.0.0.0"
    stream_port: int = 8080
    stream_quality: int = 75  # JPEG compression quality (1-100)
    
    def save_json(self, file_path: Path):
        """Export configuration to JSON file."""
        file_path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "camera": self.camera.__dict__,
            "detection": {
                k: v for k, v in self.detection.__dict__.items()
                if not k.startswith("_")
            },
            "stream_host": self.stream_host,
            "stream_port": self.stream_port,
            "stream_quality": self.stream_quality,
        }
        with open(file_path, "w") as f:
            json.dump(data, f, indent=4)

    @classmethod
    def load_json(cls, file_path: Path) -> "AppConfig":
        """Load configuration from JSON file."""
        if not file_path.exists():
            return cls()
        with open(file_path, "r") as f:
            data = json.load(f)
        cfg = cls()
        if "camera" in data:
            cfg.camera = CameraConfig(**data["camera"])
        if "detection" in data:
            cfg.detection = DetectionConfig(**data["detection"])
        if "stream_host" in data:
            cfg.stream_host = data["stream_host"]
        if "stream_port" in data:
            cfg.stream_port = data["stream_port"]
        if "stream_quality" in data:
            cfg.stream_quality = data["stream_quality"]
        return cfg
