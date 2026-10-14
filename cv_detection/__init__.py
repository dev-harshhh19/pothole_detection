"""
cv_detection
============
Real-time Computer Vision Pothole Detection system optimized for
Raspberry Pi 4B and the Zebronics Zeb-Crystal Clear Web Camera.
"""

from .config import CameraConfig, DetectionConfig
from .camera_driver import ZebronicsCamera, CameraStreamThread
from .pothole_detector import PotholeDetector, PotholeDetection
from .tracker import CentroidTracker
from .visualizer import HUDVisualizer
from .logger import PotholeLogger

__version__ = "1.0.0"
__all__ = [
    "CameraConfig",
    "DetectionConfig",
    "ZebronicsCamera",
    "CameraStreamThread",
    "PotholeDetector",
    "PotholeDetection",
    "CentroidTracker",
    "HUDVisualizer",
    "PotholeLogger",
]
