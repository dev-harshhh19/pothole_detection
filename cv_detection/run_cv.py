"""
run_cv.py
=========
Master command-line runner for Computer Vision Pothole Detection
optimized for Raspberry Pi and the Zebronics Zeb-Crystal Clear Web Camera.

Modes:
  1. Standalone Live Window:
     python -m cv_detection.run_cv --show

  2. Headless Background Service on Pi:
     python -m cv_detection.run_cv --headless --stream

  3. Video File Offline Benchmark:
     python -m cv_detection.run_cv --video test_road.mp4 --show
"""

import argparse
import logging
import signal
import sys
import time
from pathlib import Path

try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

from .config import AppConfig, CameraConfig, DetectionConfig
from .camera_driver import CameraStreamThread
from .pothole_detector import PotholeDetector
from .tracker import CentroidTracker
from .visualizer import HUDVisualizer
from .logger import PotholeLogger

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cv.main")


def main():
    parser = argparse.ArgumentParser(
        description="Zebronics Web Camera Pothole Detection on Raspberry Pi",
    )
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default: 0)")
    parser.add_argument("--video", type=str, default=None, help="Path to test video file")
    parser.add_argument("--width", type=int, default=640, help="Camera width (default: 640)")
    parser.add_argument("--height", type=int, default=480, help="Camera height (default: 480)")
    parser.add_argument("--fps", type=int, default=30, help="Target FPS (default: 30)")
    parser.add_argument("--show", action="store_true", help="Show live OpenCV display window")
    parser.add_argument("--headless", action="store_true", help="Run without GUI window (recommended for Pi background)")
    parser.add_argument("--stream", action="store_true", help="Start web streaming server on port 8080")
    parser.add_argument("--port", type=int, default=8080, help="Web stream server port (default: 8080)")
    parser.add_argument("--save-video", type=str, default=None, help="Save annotated output video to path")
    parser.add_argument("--no-snapshots", action="store_true", help="Disable saving snapshot crops of detections")
    parser.add_argument("--config", type=str, default=None, help="Path to JSON config file")

    args = parser.parse_args()

    if not HAS_OPENCV:
        logger.error(
            "OpenCV is required. Install it using:\n"
            "  pip install opencv-python\n"
            "or on Raspberry Pi:\n"
            "  sudo apt-get install python3-opencv"
        )
        sys.exit(1)

    # 1. Load Configuration
    if args.config:
        cfg = AppConfig.load_json(Path(args.config))
    else:
        cfg = AppConfig()

    cfg.camera.device_index = args.camera
    cfg.camera.width = args.width
    cfg.camera.height = args.height
    cfg.camera.fps = args.fps
    cfg.stream_port = args.port

    source = args.video if args.video else args.camera

    # 2. Initialize Subsystems
    logger.info("Initializing Zebronics Zeb-Crystal Clear Camera Driver...")
    camera_thread = CameraStreamThread(config=cfg.camera, source=source)
    if not camera_thread.start():
        logger.error("Failed to start camera feed. Please check hardware connection.")
        sys.exit(1)

    logger.info("Initializing Pothole Detection & Tracking Engine...")
    detector = PotholeDetector(config=cfg.detection)
    tracker = CentroidTracker(
        max_disappeared=cfg.detection.max_disappeared_frames,
        min_hits_to_alert=cfg.detection.min_hits_to_alert,
        alert_cooldown_s=cfg.detection.alert_cooldown_seconds,
    )
    visualizer = HUDVisualizer(config=cfg.detection)
    pothole_logger = PotholeLogger(
        log_csv_path=cfg.log_file,
        snapshots_dir=cfg.snapshots_dir,
        save_crops=not args.no_snapshots,
    )

    # 3. Optional Video Writer
    video_writer = None
    if args.save_video:
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        video_writer = cv2.VideoWriter(
            args.save_video,
            fourcc,
            cfg.camera.fps,
            (cfg.camera.width, cfg.camera.height),
        )
        logger.info(f"Recording output video to: {args.save_video}")

    # 4. Optional Web Streaming Server (in background thread)
    if args.stream:
        try:
            import uvicorn
            from .stream_server import create_app
            app = create_app(cfg, camera_thread, detector, tracker, visualizer, pothole_logger)

            import threading
            stream_thread = threading.Thread(
                target=lambda: uvicorn.run(
                    app,
                    host=cfg.stream_host,
                    port=cfg.stream_port,
                    log_level="warning",
                ),
                daemon=True,
                name="StreamServerThread",
            )
            stream_thread.start()
            logger.info(
                f"[STREAM READY] View live video feed at: http://localhost:{cfg.stream_port} "
                f"or http://<PI_IP>:{cfg.stream_port}"
            )
        except ImportError:
            logger.warning("uvicorn is not installed. Web stream disabled. (pip install uvicorn)")

    # 5. Signal Handler for Clean Exit
    running = True

    def sig_handler(sig, frame):
        nonlocal running
        logger.info("Termination signal received. Shutting down gracefully...")
        running = False

    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    logger.info("Pothole Detection Pipeline Running. Press Ctrl+C to stop.")

    show_window = args.show and not args.headless

    # Main processing loop
    last_frame_id = -1
    fps_timer = time.time()
    frames_processed = 0

    try:
        while running:
            valid, frame, ts, fid = camera_thread.get_latest_frame()
            if not valid or frame is None or fid == last_frame_id:
                time.sleep(0.005)
                continue

            last_frame_id = fid

            # Run detection
            candidates = detector.detect(frame, ts)

            # Update temporal tracker
            active_detections, new_alerts = tracker.update(candidates)

            # Process confirmed alerts
            for alert in new_alerts:
                visualizer.register_alert(alert)
                pothole_logger.log_detection(alert, full_frame=frame)

            # Overlay HUD
            annotated = visualizer.render(
                frame,
                active_detections,
                fps=camera_thread.measured_fps,
                camera_name="Zebronics Zeb-Crystal Clear",
            )

            # Record if enabled
            if video_writer:
                video_writer.write(annotated)

            # Display GUI window if enabled
            if show_window:
                cv2.imshow("Zebronics Pothole Detection", annotated)
                key = cv2.waitKey(1) & 0xFF
                if key == 27 or key == ord("q"):  # ESC or 'q'
                    break

            frames_processed += 1
            if time.time() - fps_timer >= 5.0:
                logger.info(
                    f"Performance: {camera_thread.measured_fps:.1f} FPS | "
                    f"Active Tracks: {len(active_detections)} | "
                    f"Total Confirmed Potholes: {visualizer.total_potholes_count}"
                )
                fps_timer = time.time()

    finally:
        logger.info("Cleaning up resources...")
        camera_thread.stop()
        if video_writer:
            video_writer.release()
        if show_window:
            cv2.destroyAllWindows()
        logger.info(
            f"Session ended. Total confirmed potholes detected: {visualizer.total_potholes_count}. "
            f"Logs saved to {cfg.log_file}"
        )


if __name__ == "__main__":
    main()
