import React, { useRef, useEffect, useState, useCallback } from "react";
import { Play, Pause, Plus, Bike, AlertTriangle, CheckCircle2, Lock, RefreshCw, Keyboard, X, Compass, Gauge, ShieldAlert, Activity } from "lucide-react";

/**
 * RoadSimulation2D
 * ================
 * Dedicated 2D simulation with realistic vehicle physics for a motorbike
 * driving forward (from left to right).
 * Features a front-mounted TF02-Pro LiDAR positioned above headlights
 * with a FIXED 5.0 METER (500 cm) distance ray from sensor to road.
 * Sensor readings register from right to left (oncoming road ahead -> front wheel -> rear wheel).
 * Displays rich multi-unit metrics: cm, meters, feet, inches, km/h, m/s, mph.
 */
export default function RoadSimulation2D({
  telemetry,
  connected,
  isSimulated,
  settings,
  resetTrigger,
  onResetSimulation,
  onSimulatedAnomaly,
  onSpeedChange,
}) {
  const canvasRef = useRef(null);

  // Hardware sync availability: only permitted when real physical sensor is detected
  const isHardwareAvailable = Boolean(connected && !isSimulated);

  // Simulation mode: "generator" (autonomous procedural road) or "hardware" (synced to live LiDAR)
  const [simMode, setSimMode] = useState("generator");
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeedKmph, setSimSpeedKmph] = useState(30);
  const [autoSpawn, setAutoSpawn] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Road surface presets: "asphalt" | "mud" | "dirt" | "cobble"
  const ROAD_PRESETS = [
    { id: "asphalt", label: "Asphalt", desc: "Highway Blacktop", dot: "bg-zinc-800 border-yellow-400" },
    { id: "mud", label: "Mud Road", desc: "Wet Soft Ruts", dot: "bg-amber-900 border-amber-600" },
    { id: "dirt", label: "Dirt Road", desc: "Gravel Washboard", dot: "bg-amber-600 border-amber-400" },
    { id: "cobble", label: "Cobblestone", desc: "Stone Pavers", dot: "bg-zinc-400 border-zinc-500" },
  ];

  const [roadPreset, setRoadPreset] = useState(() => {
    try {
      const saved = localStorage.getItem("pothole_road_preset");
      return ["asphalt", "mud", "dirt", "cobble"].includes(saved) ? saved : "asphalt";
    } catch {
      return "asphalt";
    }
  });

  const handlePresetChange = useCallback((preset) => {
    setRoadPreset(preset);
    try {
      localStorage.setItem("pothole_road_preset", preset);
    } catch {}
  }, []);

  const cycleRoadPreset = useCallback(() => {
    const list = ["asphalt", "mud", "dirt", "cobble"];
    setRoadPreset((curr) => {
      const nextIdx = (list.indexOf(curr) + 1) % list.length;
      const nextPreset = list[nextIdx];
      try {
        localStorage.setItem("pothole_road_preset", nextPreset);
      } catch {}
      return nextPreset;
    });
  }, []);

  // Automatically switch mode based on hardware availability
  useEffect(() => {
    if (isHardwareAvailable) {
      setSimMode("hardware");
    } else {
      setSimMode("generator");
    }
  }, [isHardwareAvailable]);

  // Live Comprehensive HUD telemetry metrics (multi-unit)
  const [hudStats, setHudStats] = useState({
    speedKmph: 30,
    speedMps: 8.33,
    speedMph: 18.64,
    slantDistanceCm: 500.0,
    slantDistanceM: 5.0,
    slantDistanceFt: 16.4,
    verticalDepthCm: 85.0,
    verticalDepthM: 0.85,
    verticalDepthIn: 33.46,
    deviationCm: 0.0,
    deviationMm: 0.0,
    deviationIn: 0.0,
    earlyWarningLeadCm: 492.7,
    earlyWarningLeadM: 4.93,
    earlyWarningLeadFt: 16.16,
    timeToImpactMs: 592,
    surfaceType: "Nominal Asphalt",
    isAlert: false,
    severity: "None",
    detectedCount: 0,
  });

  // Recent detections log for this simulation run
  const [sessionDetections, setSessionDetections] = useState([]);

  // Animation and physics state refs
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(performance.now());
  const distanceTraveledRef = useRef(0);
  const detectedCountRef = useRef(0);

  // Road terrain anomalies queue (worldX coordinates)
  const anomaliesRef = useRef([
    { id: 1, worldX: 950, type: "pothole", depthCm: 6.2, widthCm: 45, detected: false },
    { id: 2, worldX: 1800, type: "deep_pothole", depthCm: 12.0, widthCm: 65, detected: false },
    { id: 3, worldX: 2700, type: "bump", depthCm: -5.8, widthCm: 50, detected: false },
  ]);

  // Rolling terrain elevation buffer for hardware mode
  // Stores objects: { worldX, devCm } registered from RIGHT (laser hit point) to LEFT (wheels)
  const hardwareTerrainBufferRef = useRef([]);

  // Vehicle suspension dynamics
  const vehicleStateRef = useRef({
    pitch: 0,
    wheelRot: 0,
  });

  // Keep speed in sync with settings
  useEffect(() => {
    if (settings && settings.speed_kmph) {
      setSimSpeedKmph(settings.speed_kmph);
    }
  }, [settings?.speed_kmph]);

  // Push incoming live hardware telemetry into terrain buffer
  // Data is registered at the forward lookahead laser hit point (on the RIGHT)
  // and flows toward the LEFT through the bike as distanceTraveled increases.
  useEffect(() => {
    if (simMode === "hardware" && isHardwareAvailable && telemetry) {
      const dev = typeof telemetry.deviation_cm === "number" ? telemetry.deviation_cm : 0;
      const canvas = canvasRef.current;
      const width = canvas ? canvas.width / (window.devicePixelRatio || 1) : 1000;

      // Fixed 5-meter slant ray geometry
      const bikeScreenX = Math.max(80, width * 0.15);
      const lidarOriginX = bikeScreenX + 47;
      const nominalLeadDistanceCm = 492.7; // 500cm hypotenuse with ~85cm height
      const pixelsPerCm = 1.2; // 120 px = 1 meter
      const hitScreenX = lidarOriginX + nominalLeadDistanceCm * pixelsPerCm;

      const spawnWorldX = distanceTraveledRef.current + hitScreenX;

      hardwareTerrainBufferRef.current.push({
        worldX: spawnWorldX,
        devCm: dev,
      });

      // Keep buffer clean (last 400 points)
      if (hardwareTerrainBufferRef.current.length > 400) {
        hardwareTerrainBufferRef.current.shift();
      }
    }
  }, [simMode, isHardwareAvailable, telemetry]);

  // Manual anomaly spawner
  const spawnAnomaly = useCallback((type) => {
    const canvas = canvasRef.current;
    const viewWidth = canvas ? canvas.width / (window.devicePixelRatio || 1) : 1000;
    // Spawn ahead on the right side of the road
    const worldX = distanceTraveledRef.current + viewWidth + 150;

    let depthCm = 5.0;
    let widthCm = 45;

    if (type === "deep_pothole") {
      depthCm = 10.0 + Math.random() * 4.5;
      widthCm = 55 + Math.random() * 25;
    } else if (type === "pothole") {
      depthCm = 4.5 + Math.random() * 3.0;
      widthCm = 40 + Math.random() * 15;
    } else if (type === "bump") {
      depthCm = -(4.5 + Math.random() * 3.5);
      widthCm = 45 + Math.random() * 15;
    }

    anomaliesRef.current.push({
      id: Date.now() + Math.random(),
      worldX,
      type,
      depthCm: Math.round(depthCm * 10) / 10,
      widthCm: Math.round(widthCm),
      detected: false,
    });
  }, []);

  // Complete reset of simulation distance, anomaly queue, and session detections
  const handleReset = useCallback(() => {
    distanceTraveledRef.current = 0;
    detectedCountRef.current = 0;
    setSessionDetections([]);
    hardwareTerrainBufferRef.current = [];
    anomaliesRef.current = [
      { id: 1, worldX: 950, type: "pothole", depthCm: 6.2, widthCm: 45, detected: false },
      { id: 2, worldX: 1800, type: "deep_pothole", depthCm: 12.0, widthCm: 65, detected: false },
      { id: 3, worldX: 2700, type: "bump", depthCm: -5.8, widthCm: 50, detected: false },
    ];
    const nominalSurface =
      roadPreset === "mud"
        ? "Nominal Mud Track"
        : roadPreset === "dirt"
        ? "Nominal Dirt Road"
        : roadPreset === "cobble"
        ? "Nominal Cobblestone"
        : "Nominal Asphalt";

    setHudStats((prev) => ({
      ...prev,
      detectedCount: 0,
      deviationCm: 0.0,
      deviationMm: 0.0,
      deviationIn: 0.0,
      surfaceType: nominalSurface,
      isAlert: false,
      severity: "None",
    }));
  }, [roadPreset]);

  // Sync with global Reset button trigger
  useEffect(() => {
    if (resetTrigger && resetTrigger > 0) {
      handleReset();
    }
  }, [resetTrigger, handleReset]);

  // Global Keyboard Shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        setIsRunning((prev) => !prev);
        return;
      }

      if (e.key === "r" || e.key === "R") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handleReset();
          if (onResetSimulation) onResetSimulation();
          return;
        }
      }

      if (e.key === "1") {
        e.preventDefault();
        spawnAnomaly("pothole");
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        spawnAnomaly("deep_pothole");
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        spawnAnomaly("bump");
        return;
      }

      if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") {
        e.preventDefault();
        setSimSpeedKmph((curr) => {
          const next = Math.min(100, curr + 5);
          if (onSpeedChange) onSpeedChange(next);
          return next;
        });
        return;
      }
      if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") {
        e.preventDefault();
        setSimSpeedKmph((curr) => {
          const next = Math.max(5, curr - 5);
          if (onSpeedChange) onSpeedChange(next);
          return next;
        });
        return;
      }

      if (e.key === "h" || e.key === "H") {
        if (simMode === "generator") {
          e.preventDefault();
          setAutoSpawn((prev) => !prev);
          return;
        }
      }

      if (e.key === "p" || e.key === "P") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          cycleRoadPreset();
          return;
        }
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [simMode, handleReset, onResetSimulation, spawnAnomaly, cycleRoadPreset, onSpeedChange]);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const render = (now) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      // High-DPI scaling
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Real-world physical unit constants
      const speedMps = (simSpeedKmph * 1000) / 3600;
      const speedMph = simSpeedKmph * 0.621371;
      const pixelsPerMeter = 120; // 120 pixels on canvas = 1.0 meter
      const pixelsPerCm = pixelsPerMeter / 100; // 1.2 pixels = 1 cm

      if (isRunning) {
        const dx = speedMps * pixelsPerMeter * dt;
        distanceTraveledRef.current += dx;
        vehicleStateRef.current.wheelRot += (dx / 18) % (Math.PI * 2);

        // Procedural generator: spawn random potholes periodically
        if (simMode === "generator" && autoSpawn) {
          const spawnIntervalPx = 800;
          const lastAnomaly = anomaliesRef.current[anomaliesRef.current.length - 1];
          const nextSpawnThreshold = lastAnomaly
            ? lastAnomaly.worldX + spawnIntervalPx + Math.random() * 500
            : distanceTraveledRef.current + width + 250;

          if (distanceTraveledRef.current + width + 100 > nextSpawnThreshold) {
            const rand = Math.random();
            let newType = "pothole";
            if (rand < 0.45) newType = "pothole";
            else if (rand < 0.80) newType = "deep_pothole";
            else newType = "bump";
            spawnAnomaly(newType);
          }
        }
      }

      // Cleanup anomalies that scrolled off-screen to the left
      anomaliesRef.current = anomaliesRef.current.filter(
        (a) => a.worldX > distanceTraveledRef.current - 600
      );

      // Road geometry level on canvas
      const baselineY = height * 0.72;
      const nominalSensorHeightCm = 85.0; // Sensor height above road (0.85 m / 33.5 in)

      // FIXED 5.0 METER LIDAR RAY CONSTANTS
      const FIXED_SLANT_DIST_CM = 500.0; // 5.0 meters (500 cm / 16.4 ft)
      // Fixed inclination angle: sin(theta) = 85cm / 500cm = 0.170 -> theta ~ 9.79 deg
      const FIXED_BEAM_ANGLE_RAD = Math.asin(Math.min(0.95, nominalSensorHeightCm / FIXED_SLANT_DIST_CM));

      // Terrain elevation function: registers from RIGHT (oncoming ahead) to LEFT (bike)
      const getTerrainElevationAtScreenX = (screenX) => {
        const worldX = distanceTraveledRef.current + screenX;

        if (simMode === "hardware") {
          const buf = hardwareTerrainBufferRef.current;
          if (buf.length > 0) {
            const newestWorldX = buf[buf.length - 1].worldX;
            // Undiscovered road ahead of the laser scan is flat
            if (worldX > newestWorldX + 5) {
              return 0;
            }

            // Find closest buffered reading (queried from right to left)
            let matchDev = buf[buf.length - 1].devCm;
            for (let i = buf.length - 1; i >= 0; i--) {
              if (buf[i].worldX <= worldX) {
                matchDev = buf[i].devCm;
                break;
              }
            }
            return matchDev * pixelsPerCm;
          }
          return 0;
        }

        // Procedural baseline micro-texture based on road preset
        let baselineTexturePx = 0;
        if (roadPreset === "dirt") {
          baselineTexturePx = (Math.sin(worldX * 0.05) * 0.5 + Math.sin(worldX * 0.012) * 1.0) * pixelsPerCm;
        } else if (roadPreset === "mud") {
          baselineTexturePx = (Math.sin(worldX * 0.015) * 1.5 + Math.cos(worldX * 0.007) * 1.2) * pixelsPerCm;
        } else if (roadPreset === "cobble") {
          baselineTexturePx = (Math.sin(worldX * 0.10) * 0.4 + Math.cos(worldX * 0.02) * 0.6) * pixelsPerCm;
        }

        // Generator mode: smooth cosine depression/elevation
        let totalElevationPx = baselineTexturePx;
        for (const anom of anomaliesRef.current) {
          const distToCenter = worldX - anom.worldX;
          const halfWidthPx = (anom.widthCm * pixelsPerCm) / 2;

          if (Math.abs(distToCenter) < halfWidthPx) {
            const normDist = distToCenter / halfWidthPx;
            const factor = Math.cos(normDist * (Math.PI / 2));
            const anomalyDepthPx = anom.depthCm * pixelsPerCm;
            totalElevationPx += anomalyDepthPx * factor;
          }
        }
        return totalElevationPx;
      };

      // 1. DRAW CAD TECHNICAL BLUEPRINT BACKGROUND
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, width, height);

      // Coordinate grid
      ctx.strokeStyle = "#18181b";
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Top distance ruler in meters
      ctx.fillStyle = "#71717a";
      ctx.font = "9px monospace";
      const markerIntervalPx = 120;
      const startMarker = Math.floor(distanceTraveledRef.current / markerIntervalPx) * markerIntervalPx;
      for (let mx = startMarker; mx < distanceTraveledRef.current + width + markerIntervalPx; mx += markerIntervalPx) {
        const sx = mx - distanceTraveledRef.current;
        if (sx >= 0 && sx <= width) {
          ctx.beginPath();
          ctx.moveTo(sx, 16);
          ctx.lineTo(sx, 24);
          ctx.strokeStyle = "#3f3f46";
          ctx.stroke();
          ctx.fillText(`${(mx / pixelsPerMeter).toFixed(1)}m`, sx + 3, 24);
        }
      }

      // 2. DRAW ROAD TERRAIN CROSS-SECTION
      const step = 4;
      const surfacePoints = [];
      for (let sx = 0; sx <= width + step; sx += step) {
        const elev = getTerrainElevationAtScreenX(sx);
        surfacePoints.push({ x: sx, y: baselineY + elev });
      }

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, surfacePoints[0].y);
      for (const p of surfacePoints) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.clip();

      // Road sub-base hatching
      ctx.fillStyle = "#121215";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "#27272a";
      ctx.lineWidth = 1;
      for (let x = -height; x < width + height; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, baselineY - 20);
        ctx.lineTo(x + height, height);
        ctx.stroke();
      }
      ctx.restore();

      // Primary road surface boundary line
      ctx.strokeStyle =
        roadPreset === "mud"
          ? "#d97706"
          : roadPreset === "dirt"
          ? "#b45309"
          : roadPreset === "cobble"
          ? "#a1a1aa"
          : "#e4e4e7";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
      for (let i = 1; i < surfacePoints.length; i++) {
        ctx.lineTo(surfacePoints[i].x, surfacePoints[i].y);
      }
      ctx.stroke();

      // Flat road nominal baseline reference (dashed yellow)
      ctx.strokeStyle = "rgba(234, 179, 8, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, baselineY);
      ctx.lineTo(width, baselineY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 3. MOTORBIKE POSITION & SUSPENSION DYNAMICS
      // Bike placed on left side facing forward to the right (Wheelbase 110px, wheel radius 18px)
      const bikeScreenX = Math.max(90, width * 0.15);
      const wheelRadius = 18;
      const rearAxleX = bikeScreenX - 55;
      const frontAxleX = bikeScreenX + 55;

      const rearGroundY = baselineY + getTerrainElevationAtScreenX(rearAxleX);
      const frontGroundY = baselineY + getTerrainElevationAtScreenX(frontAxleX);

      const rearAxleY = rearGroundY - wheelRadius;
      const frontAxleY = frontGroundY - wheelRadius;

      // Chassis pitch angle from road slope
      const targetPitch = Math.atan2(frontGroundY - rearGroundY, frontAxleX - rearAxleX);
      vehicleStateRef.current.pitch += (targetPitch - vehicleStateRef.current.pitch) * 0.2;
      const pitch = vehicleStateRef.current.pitch;

      const chassisMidX = (rearAxleX + frontAxleX) / 2;
      const chassisMidY = (rearAxleY + frontAxleY) / 2;

      // Draw Detailed Motorbike Wheel (Procedural Alloy + Treads + Brake Caliper)
      const drawMotorbikeWheel = (wx, wy) => {
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(vehicleStateRef.current.wheelRot);

        // Outer Tire Rim
        ctx.beginPath();
        ctx.arc(0, 0, wheelRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Inner Rim Circle
        ctx.beginPath();
        ctx.arc(0, 0, wheelRadius - 4.5, 0, Math.PI * 2);
        ctx.strokeStyle = "#71717a";
        ctx.lineWidth = 1;
        ctx.stroke();

        // 16 Tire Tread Teeth along outer circumference
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.2;
        const numTreads = 16;
        for (let i = 0; i < numTreads; i++) {
          const a = (i * 2 * Math.PI) / numTreads;
          const r1 = wheelRadius - 2;
          const r2 = wheelRadius + 1.5;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
          ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
          ctx.stroke();
        }

        // 6-Spoke Alloy Wheel Pattern
        ctx.strokeStyle = "#e4e4e7";
        ctx.lineWidth = 1.5;
        const numSpokes = 6;
        for (let i = 0; i < numSpokes; i++) {
          const a = (i * 2 * Math.PI) / numSpokes;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(a) * (wheelRadius - 4.5), Math.sin(a) * (wheelRadius - 4.5));
          ctx.stroke();
        }

        // Disc Brake Caliper
        ctx.beginPath();
        ctx.arc(0, 0, wheelRadius - 8, 0, Math.PI * 2);
        ctx.strokeStyle = "#52525b";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Center Axle Hub
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        ctx.restore();
      };

      drawMotorbikeWheel(rearAxleX, rearAxleY);
      drawMotorbikeWheel(frontAxleX, frontAxleY);

      // 4. DRAW MOTORBIKE CHASSIS & FRONT-MOUNTED TF02-PRO SENSOR
      ctx.save();
      ctx.translate(chassisMidX, chassisMidY);
      ctx.rotate(pitch);

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.8;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // 1. Rear Swingarm (from pivot at -18,2 back to rear axle at -55,12)
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(-55, 12);
      ctx.lineTo(-55, 6);
      ctx.lineTo(-18, -2);
      ctx.closePath();
      ctx.stroke();

      // Rear Monoshock Suspension Coil Spring
      ctx.strokeStyle = "#d4d4d8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-32, 6);
      ctx.lineTo(-14, -14);
      ctx.stroke();

      // 2. Engine Block & Transmission (Center)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-18, -4);
      ctx.lineTo(16, -4);
      ctx.lineTo(16, 12);
      ctx.lineTo(-18, 12);
      ctx.closePath();
      ctx.stroke();

      // Engine Cylinder Cooling Fins
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(10, 0);
      ctx.moveTo(-12, 4);
      ctx.lineTo(10, 4);
      ctx.moveTo(-12, 8);
      ctx.lineTo(10, 8);
      ctx.stroke();

      // 3. Compact Upswept Exhaust System (Exhaust pipe to rear left)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, 4);
      ctx.lineTo(4, 15);
      ctx.lineTo(-16, 15);
      ctx.lineTo(-46, 6); // Upswept muffler
      ctx.lineTo(-58, 4);
      ctx.stroke();

      // Muffler Heat Shield
      ctx.strokeStyle = "#a1a1aa";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-22, 12);
      ctx.lineTo(-48, 6);
      ctx.stroke();

      // 4. Trellis Frame & Footpeg
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(12, -22); // Diagonal brace
      ctx.moveTo(0, 12);
      ctx.lineTo(34, -28); // Lower spar to headstock
      ctx.stroke();

      // Rider Footpeg
      ctx.beginPath();
      ctx.moveTo(-8, 12);
      ctx.lineTo(-8, 18);
      ctx.lineTo(-2, 18);
      ctx.stroke();

      // 5. Sculpted Fuel Tank (Facing Right)
      ctx.beginPath();
      ctx.moveTo(34, -28); // Headstock joint
      ctx.lineTo(10, -34); // Tank peak
      ctx.lineTo(-8, -20); // Tank rear / seat junction
      ctx.lineTo(4, -14);  // Knee recess lower edge
      ctx.closePath();
      ctx.stroke();

      // 6. Stepped Sport Rider & Pillion Seat
      ctx.beginPath();
      ctx.moveTo(-8, -20); // Front seat nose
      ctx.lineTo(-30, -20); // Rider saddle dip
      ctx.lineTo(-38, -28); // Pillion step rise
      ctx.lineTo(-58, -28); // Tail end
      ctx.lineTo(-52, -18); // Lower undertray
      ctx.lineTo(-8, -16);
      ctx.closePath();
      ctx.stroke();

      // Rear Tail Light & License Tidy (Facing Left)
      ctx.strokeStyle = "#ef4444"; // Red tail marker
      ctx.beginPath();
      ctx.moveTo(-58, -28);
      ctx.lineTo(-64, -26);
      ctx.lineTo(-58, -22);
      ctx.stroke();

      // 7. Front Telescopic Fork Assembly (Angling down-right to front axle)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(34, -28); // Triple clamp
      ctx.lineTo(55, 12);  // Front axle
      ctx.stroke();

      // Front Mudguard / Fender
      ctx.beginPath();
      ctx.arc(55, 12, wheelRadius + 4, -Math.PI * 0.75, -Math.PI * 0.15);
      ctx.stroke();

      // 8. Handlebars with Levers & Rear-View Mirror
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(34, -28);
      ctx.lineTo(32, -42); // Handlebar riser
      ctx.lineTo(26, -44); // Grip
      ctx.lineTo(32, -44); // Brake lever
      ctx.stroke();

      // Mirror stalk angling up-back
      ctx.beginPath();
      ctx.moveTo(32, -42);
      ctx.lineTo(26, -54);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(24, -56, 3, 0, Math.PI * 2);
      ctx.stroke();

      // 9. Aerodynamic Front Headlight Fairing / Cowl (Facing Right)
      ctx.beginPath();
      ctx.moveTo(34, -28);
      ctx.lineTo(48, -26); // Headlight nose
      ctx.lineTo(48, -18);
      ctx.lineTo(36, -14);
      ctx.closePath();
      ctx.stroke();

      // Headlight Lens (Facing Forward to the Right)
      ctx.strokeStyle = "#fef08a";
      ctx.beginPath();
      ctx.moveTo(48, -26);
      ctx.lineTo(48, -18);
      ctx.stroke();

      // Upper Cowl Brow & Sensor Mounting Shelf (Positioned ABOVE Headlights)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(34, -28);
      ctx.lineTo(42, -34); // Rising cowl brow line above headlight
      ctx.lineTo(49, -34); // Sensor platform shelf
      ctx.stroke();

      // Strut bracket connecting cowl brow to headlight housing
      ctx.strokeStyle = "#71717a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(48, -34);
      ctx.lineTo(48, -26);
      ctx.stroke();

      // 10. TF02-Pro LiDAR Sensor Unit (Mounted ABOVE headlights, facing forward-down to RIGHT)
      const sensorLocalX = 47;
      const sensorLocalY = -34;

      ctx.save();
      ctx.translate(sensorLocalX, sensorLocalY);
      ctx.rotate(FIXED_BEAM_ANGLE_RAD);

      // LiDAR Mounting Swivel Collar
      ctx.strokeStyle = "#71717a";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.stroke();

      // LiDAR Outer Casing
      ctx.fillStyle = "#09090b";
      ctx.fillRect(-4, -4, 12, 8);
      ctx.strokeStyle = "#f97316"; // Fiery red-amber housing accent
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-4, -4, 12, 8);

      // Optical Emitter Lens (Facing right-down)
      ctx.fillStyle = "#ef4444"; // Vivid red lens
      ctx.beginPath();
      ctx.arc(8, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();

      // Lens amber glow halo
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(8, 0, 3.2, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
      ctx.restore(); // Exit motorbike transform

      // 5. FIXED 5.0 METER LIDAR LASER BEAM RAYCAST
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const sensorLocalOffsetX = 47;
      const sensorLocalOffsetY = -34;

      const lidarOriginX = chassisMidX + sensorLocalOffsetX * cosP - sensorLocalOffsetY * sinP;
      const lidarOriginY = chassisMidY + sensorLocalOffsetX * sinP + sensorLocalOffsetY * cosP;

      const effectiveBeamAngleRad = FIXED_BEAM_ANGLE_RAD + pitch;
      const cosBeam = Math.cos(effectiveBeamAngleRad);
      const sinBeam = Math.sin(effectiveBeamAngleRad);

      // Ray intersection with oncoming road terrain ahead to the right
      let rayT = (baselineY - lidarOriginY) / Math.max(sinBeam, 0.05);
      let hitX = lidarOriginX + rayT * cosBeam;
      let hitY = baselineY + getTerrainElevationAtScreenX(hitX);

      // Multi-pass crater boundary refinement
      for (let iter = 0; iter < 4; iter++) {
        const terrainAtX = baselineY + getTerrainElevationAtScreenX(hitX);
        const errorY = terrainAtX - (lidarOriginY + rayT * sinBeam);
        rayT += errorY / Math.max(sinBeam, 0.05);
        hitX = lidarOriginX + rayT * cosBeam;
        hitY = baselineY + getTerrainElevationAtScreenX(hitX);
      }

      // Real physical distance calculations
      const measuredSlantPx = Math.hypot(hitX - lidarOriginX, hitY - lidarOriginY);
      const measuredSlantCm = measuredSlantPx / pixelsPerCm;
      const measuredSlantM = measuredSlantCm / 100;
      const measuredSlantFt = measuredSlantCm / 30.48;

      const verticalHeightCm = (hitY - lidarOriginY) / pixelsPerCm;
      const verticalHeightM = verticalHeightCm / 100;
      const verticalHeightIn = verticalHeightCm / 2.54;

      const deltaVerticalCm = (hitY - baselineY) / pixelsPerCm;
      const deltaVerticalMm = deltaVerticalCm * 10;
      const deltaVerticalIn = deltaVerticalCm / 2.54;

      const leadDistanceCm = Math.max(0, (hitX - frontAxleX) / pixelsPerCm);
      const leadDistanceM = leadDistanceCm / 100;
      const leadDistanceFt = leadDistanceCm / 30.48;

      const timeToImpactMs = speedMps > 0 ? Math.round((leadDistanceM / speedMps) * 1000) : 9999;

      // Anomaly thresholds
      const potThresh = settings?.pot_thresh || 4.5;
      const deepThresh = settings?.deep_thresh || 8.0;
      const bumpThresh = settings?.bump_thresh || 4.5;

      const isPothole = deltaVerticalCm > potThresh;
      const isDeep = deltaVerticalCm > deepThresh;
      const isBump = deltaVerticalCm < -bumpThresh;
      const isAlert = isPothole || isBump;

      // Surface Classification
      let nominalTitle = "Nominal Asphalt";
      if (roadPreset === "mud") nominalTitle = "Nominal Mud Track";
      else if (roadPreset === "dirt") nominalTitle = "Nominal Dirt Road";
      else if (roadPreset === "cobble") nominalTitle = "Nominal Cobblestone";

      let activeClass = nominalTitle;
      let severityLabel = "None";
      if (isDeep) {
        severityLabel = "Critical";
        activeClass = roadPreset === "mud" ? "Deep Mud Rut" : roadPreset === "dirt" ? "Severe Washout" : roadPreset === "cobble" ? "Sunken Paver Pit" : "Deep Pothole";
      } else if (isPothole) {
        severityLabel = "Moderate";
        activeClass = roadPreset === "mud" ? "Mud Pothole" : roadPreset === "dirt" ? "Gravel Depression" : roadPreset === "cobble" ? "Loose Paver Hole" : "Shallow Pothole";
      } else if (isBump) {
        severityLabel = "Caution";
        activeClass = roadPreset === "mud" ? "Mud Ridge" : roadPreset === "dirt" ? "Gravel Mound" : roadPreset === "cobble" ? "Raised Paver Stone" : "Speed Bump";
      }

      // Generator mode anomaly confirmation
      if (simMode === "generator") {
        for (const anom of anomaliesRef.current) {
          const worldHitX = distanceTraveledRef.current + hitX;
          const halfWidthPx = (anom.widthCm * pixelsPerCm) / 2;
          if (Math.abs(worldHitX - anom.worldX) < halfWidthPx) {
            if (!anom.detected) {
              anom.detected = true;
              detectedCountRef.current += 1;

              const isDeepAnom = anom.type === "deep_pothole";
              const isPotholeAnom = anom.type === "pothole";
              let detectedTypeName = "Speed Bump";
              if (isDeepAnom) {
                detectedTypeName = roadPreset === "mud" ? "Deep Mud Rut" : roadPreset === "dirt" ? "Severe Washout" : roadPreset === "cobble" ? "Sunken Paver Pit" : "Deep Pothole";
              } else if (isPotholeAnom) {
                detectedTypeName = roadPreset === "mud" ? "Mud Pothole" : roadPreset === "dirt" ? "Gravel Depression" : roadPreset === "cobble" ? "Loose Paver Hole" : "Shallow Pothole";
              } else {
                detectedTypeName = roadPreset === "mud" ? "Mud Ridge" : roadPreset === "dirt" ? "Gravel Mound" : roadPreset === "cobble" ? "Raised Paver Stone" : "Speed Bump";
              }

              const detectedObj = {
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                type: detectedTypeName,
                deviation_cm: `${anom.depthCm > 0 ? "+" : ""}${anom.depthCm.toFixed(1)} cm (${(anom.depthCm / 2.54).toFixed(1)} in)`,
                depth_cm: Math.abs(anom.depthCm),
                depth_in: Math.round((Math.abs(anom.depthCm) / 2.54) * 10) / 10,
                length_cm: anom.widthCm,
                length_ft: Math.round((anom.widthCm / 30.48) * 10) / 10,
                width_cm: Math.round(anom.widthCm * 0.8),
                severity: Math.abs(anom.depthCm) >= 8.0 ? "Critical" : "Moderate",
                confidence: "98%",
                slant_range_cm: Math.round(measuredSlantCm * 10) / 10,
                slant_range_m: Math.round(measuredSlantM * 100) / 100,
                slant_range_ft: Math.round(measuredSlantFt * 10) / 10,
                lead_dist_m: Math.round(leadDistanceM * 100) / 100,
                lead_dist_ft: Math.round(leadDistanceFt * 10) / 10,
              };

              setSessionDetections((prev) => [detectedObj, ...prev.slice(0, 24)]);

              if (onSimulatedAnomaly) {
                onSimulatedAnomaly(detectedObj);
              }
            }
          }
        }
      }

      // Update state for HUD display
      setHudStats({
        speedKmph: simSpeedKmph,
        speedMps: Math.round(speedMps * 100) / 100,
        speedMph: Math.round(speedMph * 10) / 10,
        slantDistanceCm: Math.round(measuredSlantCm * 10) / 10,
        slantDistanceM: Math.round(measuredSlantM * 100) / 100,
        slantDistanceFt: Math.round(measuredSlantFt * 10) / 10,
        verticalDepthCm: Math.round(verticalHeightCm * 10) / 10,
        verticalDepthM: Math.round(verticalHeightM * 100) / 100,
        verticalDepthIn: Math.round(verticalHeightIn * 10) / 10,
        deviationCm: Math.round(deltaVerticalCm * 10) / 10,
        deviationMm: Math.round(deltaVerticalMm),
        deviationIn: Math.round(deltaVerticalIn * 100) / 100,
        earlyWarningLeadCm: Math.round(leadDistanceCm),
        earlyWarningLeadM: Math.round(leadDistanceM * 100) / 100,
        earlyWarningLeadFt: Math.round(leadDistanceFt * 10) / 10,
        timeToImpactMs,
        surfaceType: activeClass,
        isAlert,
        severity: severityLabel,
        detectedCount: simMode === "generator" ? detectedCountRef.current : (telemetry?.pothole_count || 0) + (telemetry?.bump_count || 0),
      });

      // 6. DRAW LASER BEAM (FIERY RED-AMBER MIXED)
      ctx.save();
      // Outer glow
      ctx.strokeStyle = isDeep ? "rgba(239, 68, 68, 0.4)" : isAlert ? "rgba(245, 158, 11, 0.4)" : "rgba(249, 115, 22, 0.3)";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(lidarOriginX, lidarOriginY);
      ctx.lineTo(hitX, hitY);
      ctx.stroke();

      // Inner intense core beam
      ctx.strokeStyle = isDeep ? "#ef4444" : isAlert ? "#f59e0b" : "#ffedd5";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(lidarOriginX, lidarOriginY);
      ctx.lineTo(hitX, hitY);
      ctx.stroke();

      // Laser impact spot on ground
      ctx.fillStyle = isDeep ? "#ef4444" : isAlert ? "#f59e0b" : "#f97316";
      ctx.beginPath();
      ctx.arc(hitX, hitY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Impact halo rings
      ctx.strokeStyle = isDeep ? "rgba(239, 68, 68, 0.6)" : "rgba(249, 115, 22, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hitX, hitY, 7, 0, Math.PI * 2);
      ctx.stroke();

      // Mid-beam telemetry label
      const midX = (lidarOriginX + hitX) / 2;
      const midY = (lidarOriginY + hitY) / 2;
      ctx.fillStyle = "#f97316";
      ctx.font = "bold 9px monospace";
      ctx.fillText(`5.0m Ray (R: ${measuredSlantM.toFixed(2)}m / ${measuredSlantFt.toFixed(1)}ft)`, midX + 12, midY - 6);

      ctx.restore();

      ctx.restore(); // Restore high-DPI scaling
      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRunning, simSpeedKmph, simMode, autoSpawn, settings, spawnAnomaly, onSimulatedAnomaly, isHardwareAvailable, roadPreset]);

  return (
    <div className="space-y-4">
      {/* Simulation Master Control Bar */}
      <div className="bg-white border border-zinc-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        {/* Left: Play / Reset / Presets */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              isRunning
                ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-xs"
                : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-xs"
            }`}
          >
            {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isRunning ? "Pause (Space)" : "Resume (Space)"}</span>
          </button>

          <button
            onClick={handleReset}
            title="Reset Simulation Distance and Anomaly Log (Key R)"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-300 transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <div className="h-5 w-px bg-zinc-200 mx-1"></div>

          {/* Road Surface Selector */}
          <div className="flex items-center space-x-1">
            <span className="text-[10px] uppercase font-mono text-zinc-400 mr-1 hidden sm:inline">Terrain:</span>
            {ROAD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handlePresetChange(preset.id)}
                title={`${preset.label} - ${preset.desc} (Key P to cycle)`}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition flex items-center space-x-1.5 ${
                  roadPreset === preset.id
                    ? "bg-zinc-900 text-white border-zinc-900 font-semibold shadow-xs"
                    : "bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${preset.dot}`}></span>
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Manual Hazard Spawners */}
        <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
          {simMode === "generator" && (
            <div className="flex items-center space-x-1">
              <button
                onClick={() => spawnAnomaly("pothole")}
                title="Spawn shallow pothole (Key 1)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-md hover:bg-amber-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Pothole</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-amber-200 rounded text-amber-800">1</kbd>
              </button>

              <button
                onClick={() => spawnAnomaly("deep_pothole")}
                title="Spawn deep hazardous pothole (Key 2)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-red-50 text-red-800 border border-red-200 rounded-md hover:bg-red-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Deep Pothole</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-red-200 rounded text-red-800">2</kbd>
              </button>

              <button
                onClick={() => spawnAnomaly("bump")}
                title="Spawn speed bump (Key 3)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 rounded-md hover:bg-blue-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Speed Bump</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-blue-200 rounded text-blue-800">3</kbd>
              </button>
            </div>
          )}

          <button
            onClick={() => setShowShortcutsModal(true)}
            title="Keyboard Shortcuts (?)"
            className="p-1.5 text-zinc-500 hover:text-zinc-900 rounded-md hover:bg-zinc-100 border border-zinc-200 transition"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Fixed 5-Meter LiDAR Telemetry Header Bar */}
      <div className="bg-white border border-zinc-200 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 shadow-xs font-mono">
        {/* 1. Fixed Range */}
        <div className="border-r border-zinc-100 pr-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">LiDAR Beam Spec</span>
          <span className="text-xs font-bold text-zinc-900 block">5.0m Fixed Slant</span>
          <span className="text-[10px] text-zinc-500">500 cm / 16.4 ft</span>
        </div>

        {/* 2. Measured Slant Distance */}
        <div className="border-r border-zinc-100 pr-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">Measured Slant (R)</span>
          <span className="text-xs font-bold text-orange-600 block">{hudStats.slantDistanceCm} cm</span>
          <span className="text-[10px] text-zinc-500">{hudStats.slantDistanceM} m | {hudStats.slantDistanceFt} ft</span>
        </div>

        {/* 3. Surface Deviation */}
        <div className="border-r border-zinc-100 pr-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">Surface Dev (Δd)</span>
          <span className={`text-xs font-bold block ${hudStats.deviationCm > 4.5 ? "text-rose-600" : hudStats.deviationCm < -4.5 ? "text-blue-600" : "text-zinc-900"}`}>
            {hudStats.deviationCm > 0 ? `+${hudStats.deviationCm}` : hudStats.deviationCm} cm
          </span>
          <span className="text-[10px] text-zinc-500">{hudStats.deviationMm} mm | {hudStats.deviationIn} in</span>
        </div>

        {/* 4. Lookahead Distance */}
        <div className="border-r border-zinc-100 pr-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">Tire Lead Distance</span>
          <span className="text-xs font-bold text-emerald-700 block">{hudStats.earlyWarningLeadM} m</span>
          <span className="text-[10px] text-zinc-500">{hudStats.earlyWarningLeadCm} cm | {hudStats.earlyWarningLeadFt} ft</span>
        </div>

        {/* 5. Warning Reaction Window */}
        <div className="border-r border-zinc-100 pr-2">
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">Time to Impact</span>
          <span className="text-xs font-bold text-indigo-700 block">{hudStats.timeToImpactMs} ms</span>
          <span className="text-[10px] text-zinc-500">{(hudStats.timeToImpactMs / 1000).toFixed(2)} s reaction</span>
        </div>

        {/* 6. Current Speed */}
        <div>
          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block">Vehicle Speed</span>
          <span className="text-xs font-bold text-zinc-900 block">{hudStats.speedKmph} km/h</span>
          <span className="text-[10px] text-zinc-500">{hudStats.speedMps} m/s | {hudStats.speedMph} mph</span>
        </div>
      </div>

      {/* Main 2D Canvas Viewport */}
      <div className="relative w-full h-[420px] bg-black border border-zinc-800 rounded-lg overflow-hidden shadow-sm">
        <canvas ref={canvasRef} className="w-full h-full block cursor-crosshair" />

        {/* Top Left Live HUD Badges */}
        <div className="absolute top-3 left-3 flex items-center space-x-2 pointer-events-none">
          <div
            className={`px-3 py-1.5 rounded-md border text-xs font-mono font-semibold flex items-center space-x-2 shadow-md ${
              hudStats.isAlert
                ? hudStats.surfaceType.includes("Deep")
                  ? "bg-red-600 text-white border-red-700 animate-pulse"
                  : "bg-amber-500 text-white border-amber-600"
                : "bg-zinc-900/95 text-zinc-100 border-zinc-700"
            }`}
          >
            {hudStats.isAlert ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span>{hudStats.surfaceType}</span>
          </div>

          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-md text-xs font-mono shadow-md hidden sm:block">
            Slant R: <span className="font-bold text-white">{hudStats.slantDistanceCm} cm</span>
            <span className="mx-2 text-zinc-600">|</span>
            Lead: <span className="font-bold text-emerald-400">{hudStats.earlyWarningLeadM} m ({hudStats.earlyWarningLeadFt} ft)</span>
          </div>
        </div>

        {/* Top Right Early Warning and Session Counts */}
        <div className="absolute top-3 right-3 flex items-center space-x-2 pointer-events-none">
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-md text-xs font-mono shadow-md">
            Speed: <span className="font-semibold text-white">{hudStats.speedKmph} km/h</span>
          </div>
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-md text-xs font-mono shadow-md">
            Anomalies: <span className="font-semibold text-rose-400">{hudStats.detectedCount}</span>
          </div>
        </div>

        {/* Bottom Left Speed Slider */}
        <div className="absolute bottom-3 left-3 bg-zinc-900/95 border border-zinc-700 px-3 py-1.5 rounded-md flex items-center space-x-2.5 text-xs font-mono text-zinc-300 shadow-md">
          <span className="text-zinc-400">Speed (W/S):</span>
          <input
            type="range"
            min="10"
            max="100"
            step="5"
            value={simSpeedKmph}
            onChange={(e) => setSimSpeedKmph(Number(e.target.value))}
            onMouseUp={(e) => {
              if (onSpeedChange) onSpeedChange(Number(e.target.value));
            }}
            onTouchEnd={(e) => {
              if (onSpeedChange) onSpeedChange(Number(e.target.value));
            }}
            className="w-24 accent-white cursor-pointer h-1.5"
          />
          <span className="font-bold text-white w-16">{simSpeedKmph} km/h</span>
        </div>

        {/* Bottom Right Auto Spawn Toggle */}
        {simMode === "generator" && (
          <div className="absolute bottom-3 right-3 bg-zinc-900/95 border border-zinc-700 px-3 py-1.5 rounded-md flex items-center space-x-2 text-xs font-mono text-zinc-300 shadow-md">
            <span className="text-zinc-400">Hazards (H):</span>
            <button
              onClick={() => setAutoSpawn(!autoSpawn)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                autoSpawn ? "bg-emerald-600 text-white" : "bg-zinc-700 text-zinc-300"
              }`}
            >
              {autoSpawn ? "AUTO SPAWN ON" : "MANUAL ONLY"}
            </button>
          </div>
        )}
      </div>

      {/* Simulation Session Detections Table */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
            2D Simulation Road Anomaly Log (5m Laser Field)
          </h3>
          <span className="text-[10px] text-zinc-500 font-mono">
            {sessionDetections.length} Events Recorded
          </span>
        </div>

        <div className="overflow-x-auto max-h-56 overflow-y-auto border border-zinc-100 rounded">
          <table className="min-w-full text-xs text-left font-mono">
            <thead className="bg-zinc-50 text-zinc-500 text-[10px] uppercase border-b border-zinc-200 sticky top-0">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Anomaly Classification</th>
                <th className="px-3 py-2">Depth / Height</th>
                <th className="px-3 py-2">Length & Width</th>
                <th className="px-3 py-2">Measured Slant (R)</th>
                <th className="px-3 py-2">Lead Lead Ahead</th>
                <th className="px-3 py-2">Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-zinc-700">
              {sessionDetections.length > 0 ? (
                sessionDetections.map((d) => (
                  <tr key={d.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-1.5 text-zinc-500">{d.time}</td>
                    <td className="px-3 py-1.5 font-semibold">
                      <span className={d.type.includes("Deep") ? "text-red-600" : d.type.includes("Pothole") ? "text-amber-600" : "text-blue-600"}>
                        {d.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-bold text-zinc-900">
                      {d.depth_cm} cm <span className="text-zinc-400 font-normal">({d.depth_in} in)</span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-600">
                      {d.length_cm} × {d.width_cm} cm <span className="text-zinc-400">({d.length_ft} ft)</span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-800 font-medium">
                      {d.slant_range_cm} cm <span className="text-zinc-400">({d.slant_range_m}m / {d.slant_range_ft}ft)</span>
                    </td>
                    <td className="px-3 py-1.5 text-emerald-700 font-medium">
                      {d.lead_dist_m} m <span className="text-zinc-400">({d.lead_dist_ft} ft)</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          d.severity === "Critical" ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                        }`}
                      >
                        {d.severity}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-zinc-400">
                    No simulation detections yet. Drive forward or press key 1 / 2 / 3 to spawn anomalies ahead on the road.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Keyboard Shortcuts Modal */}
      {showShortcutsModal && (
        <div
          onClick={() => setShowShortcutsModal(false)}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-zinc-200 rounded-lg max-w-md w-full p-4 shadow-xl space-y-3 font-mono"
          >
            <div className="flex items-center justify-between border-b border-zinc-200 pb-2">
              <div className="flex items-center space-x-2">
                <Keyboard className="w-4 h-4 text-zinc-700" />
                <h3 className="text-xs font-bold text-zinc-900 uppercase tracking-wider">
                  Simulation Keyboard Controls
                </h3>
              </div>
              <button onClick={() => setShowShortcutsModal(false)} className="text-zinc-400 hover:text-zinc-700 transition">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold w-fit">Space</kbd>
                <span className="text-zinc-600 text-right">Pause / Resume</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold w-fit">R</kbd>
                <span className="text-zinc-600 text-right">Reset Sim & Data</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">1</kbd>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">2</kbd>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">3</kbd>
                </div>
                <span className="text-zinc-600 text-right">Spawn Pothole / Deep / Bump</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">W</kbd>
                  <span className="text-[10px] text-zinc-400">/</span>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">↑</kbd>
                </div>
                <span className="text-zinc-600 text-right">Speed Up (+5 km/h)</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">S</kbd>
                  <span className="text-[10px] text-zinc-400">/</span>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">↓</kbd>
                </div>
                <span className="text-zinc-600 text-right">Speed Down (-5 km/h)</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold w-fit">H</kbd>
                <span className="text-zinc-600 text-right">Toggle Road Hazards</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold w-fit">P</kbd>
                <span className="text-zinc-600 text-right">Cycle Road Preset</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 items-center">
                <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold w-fit">?</kbd>
                <span className="text-zinc-600 text-right">Toggle Shortcuts Modal</span>
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-100 flex justify-end">
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="px-3 py-1 bg-zinc-900 text-white rounded text-xs hover:bg-zinc-800 transition"
              >
                Close (Esc)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
