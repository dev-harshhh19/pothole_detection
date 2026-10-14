"""
stream_server.py
================
FastAPI MJPEG Live Video Stream & Detection API server.
Broadcasts real-time camera feed with detection overlays to any browser
on the local network (e.g. http://<PI_IP>:8080).
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, List

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import AppConfig
from .camera_driver import CameraStreamThread
from .pothole_detector import PotholeDetector, PotholeDetection
from .tracker import CentroidTracker
from .visualizer import HUDVisualizer
from .logger import PotholeLogger

logger = logging.getLogger("cv.stream_server")


def create_app(
    config: AppConfig,
    camera_thread: CameraStreamThread,
    detector: PotholeDetector,
    tracker: CentroidTracker,
    visualizer: HUDVisualizer,
    pothole_logger: PotholeLogger,
) -> FastAPI:
    """Create FastAPI application for CV live video streaming and API."""

    app = FastAPI(title="Zebronics Web Camera Pothole Detection Streamer")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # In-memory history of recent detections
    recent_detections: List[Dict[str, Any]] = []
    connected_websockets: List[WebSocket] = []

    def frame_generator():
        """Generator delivering MJPEG stream to HTTP clients."""
        while True:
            valid, frame, ts, fid = camera_thread.get_latest_frame()
            if not valid or frame is None:
                time.sleep(0.04)
                continue

            # Run detection & tracking
            candidates = detector.detect(frame, ts)
            active, alerts = tracker.update(candidates)

            for alert in alerts:
                visualizer.register_alert(alert)
                pothole_logger.log_detection(alert, full_frame=frame)

                event_dict = {
                    "id": alert.id,
                    "severity": alert.severity,
                    "confidence": alert.confidence,
                    "distance_m": alert.distance_m,
                    "diameter_cm": alert.diameter_cm,
                    "timestamp": alert.timestamp,
                }
                recent_detections.insert(0, event_dict)
                if len(recent_detections) > 50:
                    recent_detections.pop()

            # Render overlay
            annotated = visualizer.render(
                frame,
                active,
                fps=camera_thread.measured_fps,
                camera_name="Zebronics Zeb-Crystal Clear",
            )

            # Compress to JPEG
            ret, jpeg = cv2.imencode(
                ".jpg",
                annotated,
                [int(cv2.IMWRITE_JPEG_QUALITY), config.stream_quality],
            )
            if not ret:
                time.sleep(0.01)
                continue

            frame_bytes = jpeg.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
            time.sleep(0.01)

    @app.get("/", response_class=HTMLResponse)
    async def index_page():
        """Web dashboard displaying the live camera stream."""
        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Zebronics Camera Pothole Detection</title>
            <style>
                body {
                    margin: 0;
                    padding: 20px;
                    background-color: #0d0e12;
                    color: #e4e4e7;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .container {
                    max-width: 900px;
                    width: 100%;
                }
                h1 {
                    font-size: 1.4rem;
                    margin-bottom: 4px;
                    color: #38bdf8;
                }
                p.sub {
                    font-size: 0.85rem;
                    color: #71717a;
                    margin-top: 0;
                    margin-bottom: 16px;
                }
                .viewport {
                    position: relative;
                    width: 100%;
                    background: #000;
                    border: 1px solid #27272a;
                    border-radius: 8px;
                    overflow: hidden;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                }
                .viewport img {
                    width: 100%;
                    height: auto;
                    display: block;
                }
                .stats-bar {
                    margin-top: 12px;
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                    gap: 10px;
                }
                .stat-card {
                    background: #18181b;
                    border: 1px solid #27272a;
                    padding: 10px 14px;
                    border-radius: 6px;
                }
                .stat-title {
                    font-size: 0.75rem;
                    color: #a1a1aa;
                    text-transform: uppercase;
                }
                .stat-val {
                    font-size: 1.2rem;
                    font-weight: bold;
                    color: #fafafa;
                    margin-top: 4px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Zebronics Zeb-Crystal Clear - Pothole Detection</h1>
                <p class="sub">Hardware UVC Stream &bull; Raspberry Pi 4B &bull; Real-time Computer Vision</p>
                <div class="viewport">
                    <img src="/video_feed" alt="Live Camera Feed">
                </div>
                <div class="stats-bar">
                    <div class="stat-card">
                        <div class="stat-title">Stream Source</div>
                        <div class="stat-val" style="font-size: 0.95rem;">Zebronics USB Webcam</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">FPS</div>
                        <div class="stat-val" id="fps-val">30.0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-title">Status</div>
                        <div class="stat-val" style="color: #4ade80;">Active</div>
                    </div>
                </div>
            </div>
            <script>
                async function updateStatus() {
                    try {
                        const res = await fetch('/api/cv/status');
                        const data = await res.json();
                        document.getElementById('fps-val').innerText = data.fps.toFixed(1);
                    } catch(e) {}
                }
                setInterval(updateStatus, 1000);
            </script>
        </body>
        </html>
        """

    @app.get("/video_feed")
    def video_feed():
        """MJPEG video feed endpoint."""
        return StreamingResponse(
            frame_generator(),
            media_type="multipart/x-mixed-replace; boundary=frame",
        )

    @app.get("/api/cv/status")
    def get_status():
        """Return camera and vision engine status."""
        return {
            "connected": camera_thread.connected,
            "fps": round(camera_thread.measured_fps, 1),
            "resolution": f"{camera_thread.camera.actual_width}x{camera_thread.camera.actual_height}",
            "potholes_detected": visualizer.total_potholes_count,
            "time": time.time(),
        }

    @app.get("/api/cv/detections")
    def get_detections():
        """Return recent detection logs."""
        return {
            "total": visualizer.total_potholes_count,
            "recent": recent_detections,
        }

    @app.websocket("/ws/cv")
    async def websocket_endpoint(ws: WebSocket):
        """WebSocket for live detection events."""
        await ws.accept()
        connected_websockets.append(ws)
        try:
            while True:
                await asyncio.sleep(0.5)
                await ws.send_text(
                    json.dumps({
                        "type": "telemetry",
                        "fps": round(camera_thread.measured_fps, 1),
                        "total_potholes": visualizer.total_potholes_count,
                    })
                )
        except WebSocketDisconnect:
            if ws in connected_websockets:
                connected_websockets.remove(ws)

    return app
