# Computer Vision Pothole Detection (Zebronics Zeb-Crystal Clear & Raspberry Pi 4B)

High-performance, real-time Computer Vision system for road pothole detection, specifically optimized for the **Zebronics Zeb-Crystal Clear Web Camera** and the **Raspberry Pi 4B** platform.

---

## 📸 Hardware Overview: Zebronics Zeb-Crystal Clear

- **Interface:** USB 2.0 / UVC plug-and-play.
- **Sensor:** 720p HD / 480p VGA, 3P optical lens.
- **V4L2 Codec:** Configured with hardware **MJPG** (`cv2.VideoWriter_fourcc(*'MJPG')`) to eliminate USB bus bottlenecks and deliver a steady **30 FPS** on Raspberry Pi CPU.
- **Recommended Mounting on Motorcycle / Vehicle:**
  - Mount near handlebars or front fork assembly at **~80–90 cm** height above the road.
  - Tilt downward at approximately **15° to 25°** pitch angle towards the road surface ahead (configured in `config.py`).

---

## 🧠 Vision Architecture & Algorithms

1. **V4L2 Zero-Latency Capture (`camera_driver.py`)**:
   - Decoupled daemon capture thread with `BUFFERSIZE = 1` preventing frame lag.
   - Auto-reconnect protection against vehicle vibration and cable disturbances.

2. **Road Surface ROI Extraction**:
   - Dynamic perspective polygon masking out sky, horizon, buildings, and bike handlebars.

3. **Illumination Normalization & Texture Suppression**:
   - **CLAHE (Contrast Limited Adaptive Histogram Equalization)** to balance intense sunlight against shadowed road depressions.
   - Gaussian filtering to smooth asphalt grain while preserving sharp crater boundaries.

4. **Multi-Feature Depression Detection (`pothole_detector.py`)**:
   - Potholes produce localized dark shadow pockets and distinct perimeter gradient edges.
   - Uses adaptive shadow thresholding combined with Canny edge rims and morphological closing to reconstruct crater bodies.

5. **Physics-Based Geometric Filtering**:
   - **Area Thresholding:** Rejects tiny pebbles (< 450 px) and massive lighting shifts.
   - **Aspect Ratio Filtering ($0.35 \le AR \le 2.8$):** Discards elongated lane dividers, zebra crossings, and tar stripes.
   - **Solidity & Circularity Checks:** Distinguishes compact pothole craters from spindly road cracks or tree shadows.

6. **Centroid & IoU Temporal Tracking (`tracker.py`)**:
   - Requires an object to persist across multiple consecutive frames before triggering an alert, eliminating camera vibration artifacts and single-frame false alarms.
   - Assigns persistent IDs (`#1`, `#2`, etc.) and enforces an alert cooldown.

7. **Ground Distance & Size Estimation**:
   - Uses trigonometric projection based on camera mounting height and tilt angle to compute the ground distance in meters ahead of the front tire.
   - Classifies severity: **Minor**, **Moderate**, or **Severe / Dangerous**.

8. **Live Web Streaming & Logging (`stream_server.py` & `logger.py`)**:
   - Built-in FastAPI MJPEG live video feed accessible on the local network at `http://<PI_IP>:8080`.
   - Automatic CSV logging and snapshot image crops saved to `cv_output/snapshots/`.

---

## 🚀 Quick Start on Raspberry Pi

### 1. One-Time Setup
Install OpenCV, V4L2 tools, and dependencies:
```bash
cd ~/pothole_detection
chmod +x start_cv.sh
./start_cv.sh --setup
```

### 2. Camera Diagnostic & Benchmark Test
Verify your Zebronics webcam connection, resolution, and capture FPS:
```bash
./start_cv.sh --test
```
*(This verifies the camera, benchmarks 50 frames, and saves a test snapshot to `test_zebronics.jpg`)*

### 3. Run Headless with Web Stream (Default)
Ideal for riding or running in the background on the Pi without a monitor:
```bash
./start_cv.sh
```
Open your browser on any phone, laptop, or dashboard on the same network:
`http://10.102.135.22:8080`

### 4. Run with Desktop GUI Window
If your Raspberry Pi is connected to an HDMI monitor or TV:
```bash
./start_cv.sh --show
```

---

## 🛠️ CLI Options (`run_cv.py`)

You can also run the Python module directly with custom flags:

```bash
# Run on specific camera index (e.g., /dev/video0)
python -m cv_detection.run_cv --camera 0 --show

# Run on a recorded test video file
python -m cv_detection.run_cv --video road_test.mp4 --show

# Run in HD 720p (1280x720) mode
python -m cv_detection.run_cv --width 1280 --height 720 --show

# Save annotated video with detections to file
python -m cv_detection.run_cv --save-video output.mp4
```

---

## 📂 Output Structure

All detections and logs are written automatically to `cv_output/`:
```
cv_output/
├── pothole_cv_log.csv       # Detection log with Timestamp, ID, Severity, Distance, Diameter
└── snapshots/               # Cropped snapshot images of each detected pothole
    ├── pothole_1_20261014_154022.jpg
    └── pothole_2_20261014_154025.jpg
```
