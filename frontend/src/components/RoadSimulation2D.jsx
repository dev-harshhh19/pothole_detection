import React, { useRef, useEffect, useState, useCallback } from "react";
import { Play, Pause, Plus, Bike, AlertTriangle, CheckCircle2, Lock, RefreshCw, Sliders, Keyboard, X } from "lucide-react";

/**
 * RoadSimulation2D
 * ================
 * Dedicated 2D simulation with Hill Climb physics for a modern motorbike
 * facing from left to right (driving forward toward the right).
 * Features a front-mounted TF02-Pro LiDAR positioned above the headlights
 * with adjustable angle (default 43.20 deg) and a fiery red-amber mixed laser beam.
 * Pure procedural vector line-art blueprint styling and hardware-sync protection.
 */
export default function RoadSimulation2D({
  telemetry,
  connected,
  isSimulated,
  settings,
  resetTrigger,
  onResetSimulation,
  onSimulatedAnomaly,
}) {
  const canvasRef = useRef(null);

  // Hardware sync availability: only permitted when real physical sensor is detected
  const isHardwareAvailable = Boolean(connected && !isSimulated);

  // Simulation mode: "generator" (autonomous procedural road) or "hardware" (synced to live LiDAR)
  const [simMode, setSimMode] = useState("generator");
  const [isRunning, setIsRunning] = useState(true);
  const [simSpeedKmph, setSimSpeedKmph] = useState(30);
  const [autoSpawn, setAutoSpawn] = useState(true);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);

  // Adjustable sensor mounting angle (degrees from horizontal pointing forward-downward, min 25 deg, max 50 deg)
  const [sensorAngleDeg, setSensorAngleDeg] = useState(() => {
    try {
      const saved = localStorage.getItem("pothole_sensor_angle");
      const parsed = parseFloat(saved);
      return !isNaN(parsed) && parsed >= 25.0 && parsed <= 50.0 ? parsed : 43.20;
    } catch {
      return 43.20;
    }
  });

  const handleAngleChange = useCallback((newAngle) => {
    const clamped = Math.max(25.0, Math.min(50.0, Math.round(newAngle * 10) / 10));
    setSensorAngleDeg(clamped);
    try {
      localStorage.setItem("pothole_sensor_angle", clamped.toString());
    } catch {
      // ignore storage error
    }
  }, []);

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
    } catch {
      // ignore storage error
    }
  }, []);

  const cycleRoadPreset = useCallback(() => {
    const list = ["asphalt", "mud", "dirt", "cobble"];
    setRoadPreset((curr) => {
      const nextIdx = (list.indexOf(curr) + 1) % list.length;
      const nextPreset = list[nextIdx];
      try {
        localStorage.setItem("pothole_road_preset", nextPreset);
      } catch {
        // ignore storage error
      }
      return nextPreset;
    });
  }, []);

  // Fallback to generator mode if hardware disconnects
  useEffect(() => {
    if (!isHardwareAvailable && simMode === "hardware") {
      setSimMode("generator");
    }
  }, [isHardwareAvailable, simMode]);

  // Live HUD telemetry
  const [hudStats, setHudStats] = useState({
    speedKmph: 30,
    slantDistanceCm: 146.1,
    verticalDepthCm: 100.0,
    deviationCm: 0.0,
    surfaceType: "Nominal Pavement",
    isAlert: false,
    severity: "None",
    detectedCount: 0,
    earlyWarningLeadCm: 70.0,
  });

  // Recent detections log for this simulation run
  const [sessionDetections, setSessionDetections] = useState([]);

  // Animation and physics state refs
  const animFrameRef = useRef(null);
  const lastTimeRef = useRef(performance.now());
  const distanceTraveledRef = useRef(0);
  const detectedCountRef = useRef(0);

  // Road terrain anomalies queue
  const anomaliesRef = useRef([
    { id: 1, worldX: 750, type: "pothole", depthCm: 6.2, widthCm: 45, detected: false },
    { id: 2, worldX: 1400, type: "deep_pothole", depthCm: 12.0, widthCm: 65, detected: false },
    { id: 3, worldX: 2100, type: "bump", depthCm: -5.8, widthCm: 50, detected: false },
  ]);

  // Rolling terrain elevation buffer for hardware mode
  const hardwareTerrainBufferRef = useRef(new Array(160).fill(0));

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

  // Push incoming live telemetry into hardware terrain buffer
  useEffect(() => {
    if (simMode === "hardware" && isHardwareAvailable && telemetry) {
      const dev = telemetry.deviation_cm || 0;
      hardwareTerrainBufferRef.current.push(dev);
      if (hardwareTerrainBufferRef.current.length > 160) {
        hardwareTerrainBufferRef.current.shift();
      }
    }
  }, [simMode, isHardwareAvailable, telemetry]);

  // Manual anomaly spawner
  const spawnAnomaly = useCallback((type) => {
    const canvas = canvasRef.current;
    const viewWidth = canvas ? canvas.width / (window.devicePixelRatio || 1) : 1000;
    const worldX = distanceTraveledRef.current + viewWidth + 120;

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
    anomaliesRef.current = [
      { id: 1, worldX: 750, type: "pothole", depthCm: 6.2, widthCm: 45, detected: false },
      { id: 2, worldX: 1400, type: "deep_pothole", depthCm: 12.0, widthCm: 65, detected: false },
      { id: 3, worldX: 2100, type: "bump", depthCm: -5.8, widthCm: 50, detected: false },
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

  // Global Keyboard Shortcuts listener for 2D Simulation
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore keystrokes when typing inside input fields
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) {
        return;
      }

      // Close modal on Escape
      if (e.key === "Escape") {
        setShowShortcutsModal(false);
        return;
      }

      // Open/close shortcuts cheat sheet with '?' or '/'
      if (e.key === "?" || (e.key === "/" && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
        return;
      }

      // Space to toggle Play / Pause
      if (e.code === "Space") {
        e.preventDefault();
        setIsRunning((prev) => !prev);
        return;
      }

      // 'R' or 'r' to trigger complete reset
      if (e.key === "r" || e.key === "R") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handleReset();
          if (onResetSimulation) onResetSimulation();
          return;
        }
      }

      // '1', '2', '3' to trigger anomaly spawns
      if (simMode === "generator") {
        if (e.key === "1") {
          e.preventDefault();
          spawnAnomaly("deep_pothole");
          return;
        }
        if (e.key === "2") {
          e.preventDefault();
          spawnAnomaly("pothole");
          return;
        }
        if (e.key === "3") {
          e.preventDefault();
          spawnAnomaly("bump");
          return;
        }
      }

      // 'W' or 'w' to speed up (also ArrowUp)
      if (e.key === "w" || e.key === "W" || e.code === "ArrowUp") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setSimSpeedKmph((prev) => Math.min(80, prev + 5));
          return;
        }
      }

      // 'S' or 's' to speed down (also ArrowDown)
      if (e.key === "s" || e.key === "S" || e.code === "ArrowDown") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          setSimSpeedKmph((prev) => Math.max(10, prev - 5));
          return;
        }
      }

      // 'A' or 'a' for angle moveUp (+0.5 deg) (also ']')
      if (e.key === "a" || e.key === "A" || e.key === "]" || e.key === "}") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handleAngleChange(sensorAngleDeg + 0.5);
          return;
        }
      }

      // 'D' or 'd' for angle down (-0.5 deg) (also '[')
      if (e.key === "d" || e.key === "D" || e.key === "[" || e.key === "{") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          handleAngleChange(sensorAngleDeg - 0.5);
          return;
        }
      }

      // 'H' or 'h' to toggle random road hazards auto spawn
      if (e.key === "h" || e.key === "H") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          if (simMode === "generator") {
            setAutoSpawn((prev) => !prev);
          }
          return;
        }
      }

      // 'P' or 'p' to cycle road surface presets
      if (e.key === "p" || e.key === "P") {
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          cycleRoadPreset();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [simMode, handleReset, onResetSimulation, spawnAnomaly, sensorAngleDeg, handleAngleChange, cycleRoadPreset]);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const render = (now) => {
      const dt = Math.min((now - lastTimeRef.current) / 1000, 0.1);
      lastTimeRef.current = now;

      // Handle high-DPI scaling
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

      // Physics units and dimensions
      const speedMps = (simSpeedKmph * 1000) / 3600;
      const pixelsPerMeter = 120; // 120 pixels = 1 meter
      const pixelsPerCm = pixelsPerMeter / 100;

      if (isRunning) {
        const dx = speedMps * pixelsPerMeter * dt;
        distanceTraveledRef.current += dx;
        vehicleStateRef.current.wheelRot += (dx / 18) % (Math.PI * 2);

        // Procedural road generator: spawn random potholes periodically
        if (simMode === "generator" && autoSpawn) {
          const spawnIntervalPx = 700;
          const lastAnomaly = anomaliesRef.current[anomaliesRef.current.length - 1];
          const nextSpawnThreshold = lastAnomaly
            ? lastAnomaly.worldX + spawnIntervalPx + Math.random() * 450
            : distanceTraveledRef.current + width + 200;

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
        (a) => a.worldX > distanceTraveledRef.current - 500
      );

      // Road geometry coordinates
      const baselineY = height * 0.72; // Road elevation level
      const nominalVerticalDepthCm = 65.0; // Front sensor nominal ground clearance

      // Adjustable LiDAR inclination angle: pointing forward-downward toward the right
      const beamAngleDeg = sensorAngleDeg;
      const beamAngleRad = (beamAngleDeg * Math.PI) / 180;
      const sinAngle = Math.sin(beamAngleRad);

      // Terrain elevation function at given screen coordinate X
      const getTerrainElevationAtScreenX = (screenX) => {
        const worldX = distanceTraveledRef.current + screenX;

        if (simMode === "hardware") {
          const buf = hardwareTerrainBufferRef.current;
          if (buf.length > 0) {
            const idx = Math.floor(((width - screenX) / width) * (buf.length - 1));
            const clampedIdx = Math.max(0, Math.min(buf.length - 1, idx));
            const devCm = buf[clampedIdx] || 0;
            return devCm * pixelsPerCm;
          }
          return 0;
        }

        // Procedural baseline micro-elevation based on road preset
        let baselineTexturePx = 0;
        if (roadPreset === "dirt") {
          // Gravel washboard ridges and micro-chatter (max ~1.5cm elevation)
          baselineTexturePx = (Math.sin(worldX * 0.05) * 0.5 + Math.sin(worldX * 0.012) * 1.0) * pixelsPerCm;
        } else if (roadPreset === "mud") {
          // Rolling mud ruts and soft clay waves (max ~2.7cm elevation)
          baselineTexturePx = (Math.sin(worldX * 0.015) * 1.5 + Math.cos(worldX * 0.007) * 1.2) * pixelsPerCm;
        } else if (roadPreset === "cobble") {
          // Paver camber and joint seams (max ~1.0cm elevation)
          baselineTexturePx = (Math.sin(worldX * 0.10) * 0.4 + Math.cos(worldX * 0.02) * 0.6) * pixelsPerCm;
        }

        // Generator mode: smooth cosine depression
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

      // -------------------------------------------------------------
      // 1. DRAW TECHNICAL BLACK BLUEPRINT BACKGROUND
      // -------------------------------------------------------------
      ctx.fillStyle = "#09090b"; // Solid black
      ctx.fillRect(0, 0, width, height);

      // Technical CAD coordinate grid
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

      // Top distance ruler
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

      // -------------------------------------------------------------
      // 2. DRAW ROAD TERRAIN & CROSS-SECTION
      // -------------------------------------------------------------
      const step = 4;
      const surfacePoints = [];
      for (let sx = 0; sx <= width + step; sx += step) {
        const elev = getTerrainElevationAtScreenX(sx);
        surfacePoints.push({ x: sx, y: baselineY + elev });
      }

      // 2A. Clip everything to the road body cross-section
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

      if (roadPreset === "cobble") {
        // --- COBBLESTONE ROAD TEXTURE & PATTERNS ---
        // Bedrock / deep soil base
        ctx.fillStyle = "#121214";
        ctx.fillRect(0, 0, width, height);

        // Crushed sand / gravel bedding layer below pavers
        ctx.fillStyle = "#1f1f23";
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y + 36);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y + 36);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fill();

        // Bedding sand coarse speckles
        ctx.fillStyle = "rgba(113, 113, 122, 0.3)";
        const sandStep = 20;
        const sandStartX = Math.floor(distanceTraveledRef.current / sandStep) * sandStep;
        for (let mx = sandStartX; mx < distanceTraveledRef.current + width + sandStep; mx += sandStep) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          const py = baselineY + elev + 44;
          ctx.fillRect(sx, py + Math.abs((mx * 7) % 30), 2, 2);
          ctx.fillRect(sx + 10, py + Math.abs((mx * 13) % 40), 1.5, 1.5);
        }

        // 3 Staggered Rows of Rectangular/Rounded Cobblestone Pavers
        const paverW = 28;
        const paverH = 14;
        const numRows = 3;
        const paverRowColors = [
          ["#3f3f46", "#52525b", "#333338"],
          ["#2d2d32", "#3b3b40", "#26262a"],
          ["#222226", "#29292e", "#1c1c20"],
        ];

        for (let row = 0; row < numRows; row++) {
          const rowOffsetY = row * paverH;
          const stagger = (row % 2) * (paverW / 2);
          const startX = Math.floor((distanceTraveledRef.current - stagger) / paverW) * paverW + stagger;

          for (let mx = startX; mx < distanceTraveledRef.current + width + paverW; mx += paverW) {
            const sx = mx - distanceTraveledRef.current;
            const elev = getTerrainElevationAtScreenX(sx + paverW / 2);
            const blockTopY = baselineY + elev + rowOffsetY;

            // Pseudo-random shade per paver stone based on mx world coordinate
            const colorIdx = Math.abs(Math.floor((mx / paverW) * 3)) % 3;
            ctx.fillStyle = paverRowColors[row][colorIdx];

            // Draw stone block with mortar margin
            ctx.beginPath();
            if (ctx.roundRect) {
              ctx.roundRect(sx + 1.5, blockTopY + 1.5, paverW - 3, paverH - 3, 2);
            } else {
              ctx.rect(sx + 1.5, blockTopY + 1.5, paverW - 3, paverH - 3);
            }
            ctx.fill();

            // Beveled stone highlight line on top edge of each paver
            if (row === 0) {
              ctx.strokeStyle = "rgba(228, 228, 231, 0.45)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(sx + 3, blockTopY + 2.5);
              ctx.lineTo(sx + paverW - 3, blockTopY + 2.5);
              ctx.stroke();
            }

            // Dark mortar joint between stones
            ctx.strokeStyle = "#121214";
            ctx.lineWidth = 2;
            ctx.strokeRect(sx + 0.5, blockTopY + 0.5, paverW - 1, paverH - 1);
          }
        }
      } else if (roadPreset === "mud") {
        // --- MUD ROAD TEXTURE & PATTERNS ---
        // Deep subterranean peat / dark bedrock
        ctx.fillStyle = "#0c0805";
        ctx.fillRect(0, 0, width, height);

        // Subsoil clay stratum (lower mud layer)
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y + 20);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y + 20);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = "#1e1109";
        ctx.fill();

        // Upper wet clay mud layer
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(width, surfacePoints[surfacePoints.length - 1].y + 24);
        for (let i = surfacePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(surfacePoints[i].x, surfacePoints[i].y + 24);
        }
        ctx.closePath();
        ctx.fillStyle = "#33180c";
        ctx.fill();

        // Undulating organic mud rut flow striations
        const rutOffsets = [6, 12, 18, 26];
        const rutColors = [
          "rgba(146, 64, 14, 0.6)",
          "rgba(120, 53, 15, 0.45)",
          "rgba(90, 40, 15, 0.35)",
          "rgba(41, 24, 15, 0.5)",
        ];
        rutOffsets.forEach((off, idx) => {
          ctx.save();
          ctx.strokeStyle = rutColors[idx];
          ctx.lineWidth = idx === 0 ? 2 : 1.5;
          ctx.beginPath();
          for (let i = 0; i < surfacePoints.length; i++) {
            const p = surfacePoints[i];
            const wave = Math.sin((distanceTraveledRef.current + p.x) * 0.03 + idx) * 2;
            if (i === 0) ctx.moveTo(p.x, p.y + off + wave);
            else ctx.lineTo(p.x, p.y + off + wave);
          }
          ctx.stroke();
          ctx.restore();
        });

        // Embedded muddy river stones & soft clay lumps
        ctx.fillStyle = "rgba(69, 26, 3, 0.65)";
        const mudLumpStep = 36;
        const mudStartX = Math.floor(distanceTraveledRef.current / mudLumpStep) * mudLumpStep;
        for (let mx = mudStartX; mx < distanceTraveledRef.current + width + mudLumpStep; mx += mudLumpStep) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          const py = baselineY + elev + 10;
          ctx.beginPath();
          ctx.ellipse(sx, py + Math.abs((mx * 5) % 18), 5 + Math.abs((mx * 3) % 4), 2.5, 0.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Wet puddle pooling in low spots / craters
        for (const anom of anomaliesRef.current) {
          const sx = anom.worldX - distanceTraveledRef.current;
          const halfW = (anom.widthCm * pixelsPerCm) / 2;
          if (anom.depthCm > 3.0 && sx > -100 && sx < width + 100) {
            const poolY = baselineY + (anom.depthCm * pixelsPerCm * 0.45);
            ctx.save();
            ctx.fillStyle = "rgba(180, 83, 9, 0.35)";
            ctx.fillRect(sx - halfW * 0.8, poolY, halfW * 1.6, anom.depthCm * pixelsPerCm);
            // Puddle water glassy reflection surface
            ctx.strokeStyle = "rgba(251, 191, 36, 0.5)";
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(sx - halfW * 0.7, poolY);
            ctx.lineTo(sx + halfW * 0.7, poolY);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else if (roadPreset === "dirt") {
        // --- DIRT & GRAVEL ROAD TEXTURE & PATTERNS ---
        // Deep packed bedrock
        ctx.fillStyle = "#14110e";
        ctx.fillRect(0, 0, width, height);

        // Compacted hardpack clay layer
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y + 22);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y + 22);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = "#291e14";
        ctx.fill();

        // Upper gravel and sand wear stratum
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(width, surfacePoints[surfacePoints.length - 1].y + 24);
        for (let i = surfacePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(surfacePoints[i].x, surfacePoints[i].y + 24);
        }
        ctx.closePath();
        ctx.fillStyle = "#4a3525";
        ctx.fill();

        // Horizontal compaction striation lines
        ctx.save();
        ctx.strokeStyle = "rgba(161, 98, 7, 0.3)";
        ctx.lineWidth = 1;
        ctx.setLineDash([12, 16]);
        ctx.lineDashOffset = (distanceTraveledRef.current % 28);
        ctx.beginPath();
        for (let i = 0; i < surfacePoints.length; i++) {
          const p = surfacePoints[i];
          if (i === 0) ctx.moveTo(p.x, p.y + 12);
          else ctx.lineTo(p.x, p.y + 12);
        }
        ctx.stroke();
        ctx.restore();

        // High density of distinct gravel pebbles and stone chips
        const pebbleStep = 26;
        const pebbleStartX = Math.floor(distanceTraveledRef.current / pebbleStep) * pebbleStep;
        for (let mx = pebbleStartX; mx < distanceTraveledRef.current + width + pebbleStep; mx += pebbleStep) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          const py = baselineY + elev;

          // Upper fine gravel pebbles
          ctx.fillStyle = (mx % 2 === 0) ? "#a88a6d" : "#785e45";
          ctx.beginPath();
          ctx.arc(sx, py + 5 + Math.abs((mx * 3) % 12), 2 + Math.abs((mx * 2) % 2), 0, Math.PI * 2);
          ctx.fill();

          // Medium sub-surface stones
          ctx.fillStyle = (mx % 3 === 0) ? "#b48c68" : "#57422f";
          ctx.beginPath();
          ctx.arc(sx + 12, py + 16 + Math.abs((mx * 7) % 18), 3 + Math.abs(mx % 3), 0, Math.PI * 2);
          ctx.fill();

          // Stone contour edge
          ctx.strokeStyle = "rgba(20, 16, 12, 0.7)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        // Gritty sand stipple specks along the surface
        ctx.fillStyle = "rgba(254, 215, 170, 0.4)";
        for (let mx = pebbleStartX; mx < distanceTraveledRef.current + width + pebbleStep; mx += 14) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          ctx.fillRect(sx, baselineY + elev + 3, 1.5, 1.5);
          ctx.fillRect(sx + 6, baselineY + elev + 7, 1.5, 1.5);
        }
      } else {
        // --- ASPHALT HIGHWAY TEXTURE & PATTERNS ---
        // Deep subgrade foundation
        ctx.fillStyle = "#111113";
        ctx.fillRect(0, 0, width, height);

        // Crushed aggregate base course layer
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y + 16);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y + 16);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = "#1e1e22";
        ctx.fill();

        // Crushed angular rock aggregate matrix
        ctx.strokeStyle = "rgba(82, 82, 91, 0.4)";
        ctx.lineWidth = 1;
        const stoneStep = 24;
        const stoneStartX = Math.floor(distanceTraveledRef.current / stoneStep) * stoneStep;
        for (let mx = stoneStartX; mx < distanceTraveledRef.current + width + stoneStep; mx += stoneStep) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          const py = baselineY + elev + 22;

          // Angular fractured stone chip polygons
          ctx.fillStyle = (mx % 2 === 0) ? "#2d2d33" : "#383840";
          ctx.beginPath();
          const chipOff = Math.abs((mx * 3) % 16);
          ctx.moveTo(sx, py + chipOff);
          ctx.lineTo(sx + 5, py + chipOff - 3);
          ctx.lineTo(sx + 8, py + chipOff + 4);
          ctx.lineTo(sx + 2, py + chipOff + 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        // Top bituminous asphalt wearing course (dense blacktop)
        ctx.beginPath();
        ctx.moveTo(0, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.lineTo(width, surfacePoints[surfacePoints.length - 1].y + 16);
        for (let i = surfacePoints.length - 1; i >= 0; i--) {
          ctx.lineTo(surfacePoints[i].x, surfacePoints[i].y + 16);
        }
        ctx.closePath();
        ctx.fillStyle = "#27272a";
        ctx.fill();

        // Asphalt fine aggregate crystalline micro-specks
        ctx.fillStyle = "rgba(161, 161, 170, 0.35)";
        for (let mx = stoneStartX; mx < distanceTraveledRef.current + width + stoneStep; mx += 16) {
          const sx = mx - distanceTraveledRef.current;
          const elev = getTerrainElevationAtScreenX(sx);
          ctx.fillRect(sx + 4, baselineY + elev + 4, 1.5, 1.5);
          ctx.fillRect(sx + 10, baselineY + elev + 9, 1.2, 1.2);
        }
      }

      ctx.restore(); // Exit clipped cross-section

      // 2B. Draw the Surface Boundary Line & Markings (Unclipped)
      if (roadPreset === "cobble") {
        // Cobblestone domed paver caps along the top edge
        const paverW = 28;
        const startX = Math.floor(distanceTraveledRef.current / paverW) * paverW;
        for (let mx = startX; mx < distanceTraveledRef.current + width + paverW; mx += paverW) {
          const sx = mx - distanceTraveledRef.current;
          const elev1 = getTerrainElevationAtScreenX(sx);
          const elevMid = getTerrainElevationAtScreenX(sx + paverW / 2);
          const elev2 = getTerrainElevationAtScreenX(sx + paverW);

          ctx.beginPath();
          ctx.moveTo(sx, baselineY + elev1);
          ctx.quadraticCurveTo(sx + paverW / 2, baselineY + elevMid - 2.5, sx + paverW, baselineY + elev2);
          ctx.strokeStyle = "#e4e4e7";
          ctx.lineWidth = 2;
          ctx.stroke();

          // Mortar gap notch
          ctx.beginPath();
          ctx.moveTo(sx, baselineY + elev1 - 1);
          ctx.lineTo(sx, baselineY + elev1 + 3);
          ctx.strokeStyle = "#18181b";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      } else if (roadPreset === "mud") {
        // Mud organic soft top boundary
        ctx.beginPath();
        ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "#b45309";
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Wet mud glossy highlight ridge
        ctx.beginPath();
        ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y - 0.5);
        }
        ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (roadPreset === "dirt") {
        // Gritty sand/dirt surface line
        ctx.beginPath();
        ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "#e2b17a";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Coarse gravel ridge stipple along top
        ctx.strokeStyle = "rgba(251, 191, 36, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        for (let i = 0; i < surfacePoints.length; i++) {
          const p = surfacePoints[i];
          if (i === 0) ctx.moveTo(p.x, p.y - 1);
          else ctx.lineTo(p.x, p.y - 1);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Clean Asphalt Highway Surface Line & Yellow Highway Center Markings
        ctx.beginPath();
        ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
        for (const p of surfacePoints) {
          ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Vivid Yellow Highway Center Dashes
        const dashLength = 32;
        const gapLength = 26;
        const totalDashUnit = dashLength + gapLength;
        const laneOffset = (distanceTraveledRef.current % totalDashUnit);

        ctx.save();
        ctx.strokeStyle = "#eab308"; // High-visibility highway yellow
        ctx.lineWidth = 2.5;
        ctx.setLineDash([dashLength, gapLength]);
        ctx.lineDashOffset = laneOffset;
        ctx.beginPath();
        for (let i = 0; i < surfacePoints.length; i++) {
          const p = surfacePoints[i];
          if (i === 0) ctx.moveTo(p.x, p.y + 18);
          else ctx.lineTo(p.x, p.y + 18);
        }
        ctx.stroke();
        ctx.restore();
      }

      // -------------------------------------------------------------
      // 3. ANOMALY LABELS ON ROAD
      // -------------------------------------------------------------
      for (const anom of anomaliesRef.current) {
        const sx = anom.worldX - distanceTraveledRef.current;
        const widthPx = anom.widthCm * pixelsPerCm;
        const depthPx = anom.depthCm * pixelsPerCm;

        if (sx > -120 && sx < width + 120) {
          const isPothole = anom.type.includes("pothole");
          const isDeep = anom.type === "deep_pothole";
          const markerColor = isDeep ? "#ef4444" : isPothole ? "#f59e0b" : "#3b82f6";

          if (anom.detected) {
            ctx.save();
            ctx.strokeStyle = markerColor;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(sx - widthPx / 2 - 4, baselineY - 4, widthPx + 8, Math.max(depthPx + 8, 20));

            ctx.fillStyle = markerColor;
            ctx.font = "bold 9px monospace";
            ctx.textAlign = "center";
            const labelY = isPothole ? baselineY - 14 : baselineY - depthPx - 14;
            const tagTitle = isDeep
              ? (roadPreset === "mud" ? "DEEP RUT" : roadPreset === "dirt" ? "WASHOUT" : roadPreset === "cobble" ? "SUNKEN PAVER" : "CRITICAL POTHOLE")
              : isPothole
                ? (roadPreset === "mud" ? "MUD HOLE" : roadPreset === "dirt" ? "DEPRESSION" : roadPreset === "cobble" ? "PAVER HOLE" : "POTHOLE")
                : (roadPreset === "mud" ? "MUD RIDGE" : roadPreset === "dirt" ? "GRAVEL MOUND" : roadPreset === "cobble" ? "PAVER BUMP" : "BUMP");
            ctx.fillText(`${tagTitle}: ${Math.abs(anom.depthCm)}cm`, sx, labelY);
            ctx.restore();
          }
        }
      }

      // -------------------------------------------------------------
      // 4. MOTORBIKE PROCEDURAL VECTOR MODEL (Facing Left to Right)
      // -------------------------------------------------------------
      // Motorbike positioned at 22% of screen width, facing RIGHT
      const bikeScreenX = width * 0.22;
      const wheelBase = 110; // Distance between rear axle (left) and front axle (right)
      const wheelRadius = 18;

      // Rear wheel is on the LEFT, Front wheel is on the RIGHT
      const rearAxleX = bikeScreenX - wheelBase / 2;
      const frontAxleX = bikeScreenX + wheelBase / 2;

      const rearGroundY = baselineY + getTerrainElevationAtScreenX(rearAxleX);
      const frontGroundY = baselineY + getTerrainElevationAtScreenX(frontAxleX);

      // Chassis pitch angle based on terrain slope (facing right)
      const targetPitch = Math.atan2(frontGroundY - rearGroundY, wheelBase);
      vehicleStateRef.current.pitch += (targetPitch - vehicleStateRef.current.pitch) * 0.22;
      const pitch = vehicleStateRef.current.pitch;

      const rearCenterY = rearGroundY - wheelRadius;
      const frontCenterY = frontGroundY - wheelRadius;

      const chassisMidX = (rearAxleX + frontAxleX) / 2;
      const chassisMidY = (rearCenterY + frontCenterY) / 2 - 12;

      // Draw Rotating Motorbike Wheels
      const drawMotorbikeWheel = (wx, wy) => {
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(vehicleStateRef.current.wheelRot);

        // Outer Tire Rim (White line on dark background)
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

        // Detailed Tire Tread Teeth along outer circumference
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

      drawMotorbikeWheel(rearAxleX, rearCenterY);
      drawMotorbikeWheel(frontAxleX, frontCenterY);

      // Draw Motorbike Body (Facing Left to Right)
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
      // Pivots dynamically according to sensorAngleDeg downward to the right
      ctx.rotate(beamAngleRad);

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

      // -------------------------------------------------------------
      // 5. LIDAR LASER BEAM RAYCAST (ADJUSTABLE ANGLE)
      // -------------------------------------------------------------
      // Compute global coordinates of front-mounted LiDAR lens (Mounted ABOVE headlight)
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const sensorLocalOffsetX = 47;
      const sensorLocalOffsetY = -34;

      const lidarOriginX = chassisMidX + sensorLocalOffsetX * cosP - sensorLocalOffsetY * sinP;
      const lidarOriginY = chassisMidY + sensorLocalOffsetX * sinP + sensorLocalOffsetY * cosP;

      // Absolute raycast angle in world space (facing down and forward to the right)
      const effectiveBeamAngleRad = beamAngleRad + pitch;
      const cosBeam = Math.cos(effectiveBeamAngleRad);
      const sinBeam = Math.sin(effectiveBeamAngleRad);

      // Find intersection with oncoming road terrain ahead to the right
      let rayT = (baselineY - lidarOriginY) / Math.max(sinBeam, 0.1);
      let hitX = lidarOriginX + rayT * cosBeam;
      let hitY = baselineY + getTerrainElevationAtScreenX(hitX);

      // Refine intersection along crater walls
      for (let iter = 0; iter < 4; iter++) {
        const terrainAtX = baselineY + getTerrainElevationAtScreenX(hitX);
        const errorY = terrainAtX - (lidarOriginY + rayT * sinBeam);
        rayT += errorY / Math.max(sinBeam, 0.1);
        hitX = lidarOriginX + rayT * cosBeam;
        hitY = baselineY + getTerrainElevationAtScreenX(hitX);
      }

      // Measured Slant Range along laser path
      const measuredSlantPx = Math.hypot(hitX - lidarOriginX, hitY - lidarOriginY);
      const measuredSlantCm = measuredSlantPx / pixelsPerCm;

      // Vertical clearance and deviation
      const verticalDepthCm = (hitY - lidarOriginY) / pixelsPerCm;
      const nominalSlantBaselineCm = nominalVerticalDepthCm / Math.max(sinAngle, 0.1);
      const deltaVerticalCm = (hitY - baselineY) / pixelsPerCm;

      // Lookahead lead distance ahead of front tire contact point
      const leadDistanceCm = (hitX - frontAxleX) / pixelsPerCm;

      // Anomaly detection rules
      const potThresh = settings?.pot_thresh || 4.5;
      const deepThresh = settings?.deep_thresh || 8.0;
      const bumpThresh = settings?.bump_thresh || 4.5;

      let isPothole = deltaVerticalCm > potThresh;
      let isDeep = deltaVerticalCm > deepThresh;
      let isBump = deltaVerticalCm < -bumpThresh;
      let isAnomaly = isPothole || isBump;

      // Surface Type Title
      let nominalTitle = "Nominal Asphalt";
      if (roadPreset === "mud") nominalTitle = "Nominal Mud Track";
      else if (roadPreset === "dirt") nominalTitle = "Nominal Dirt Road";
      else if (roadPreset === "cobble") nominalTitle = "Nominal Cobblestone";

      let activeClass = nominalTitle;
      if (isDeep) {
        if (roadPreset === "mud") activeClass = "Deep Mud Rut";
        else if (roadPreset === "dirt") activeClass = "Severe Washout";
        else if (roadPreset === "cobble") activeClass = "Sunken Paver Pit";
        else activeClass = "Deep Pothole";
      } else if (isPothole) {
        if (roadPreset === "mud") activeClass = "Mud Pothole";
        else if (roadPreset === "dirt") activeClass = "Gravel Depression";
        else if (roadPreset === "cobble") activeClass = "Loose Paver Hole";
        else activeClass = "Shallow Pothole";
      } else if (isBump) {
        if (roadPreset === "mud") activeClass = "Mud Ridge";
        else if (roadPreset === "dirt") activeClass = "Gravel Mound";
        else if (roadPreset === "cobble") activeClass = "Raised Paver Stone";
        else activeClass = "Speed Bump";
      }

      // Flag oncoming anomaly in generator mode
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
                detectedTypeName =
                  roadPreset === "mud"
                    ? "Deep Mud Rut"
                    : roadPreset === "dirt"
                    ? "Severe Washout"
                    : roadPreset === "cobble"
                    ? "Sunken Paver Pit"
                    : "Deep Pothole";
              } else if (isPotholeAnom) {
                detectedTypeName =
                  roadPreset === "mud"
                    ? "Mud Pothole"
                    : roadPreset === "dirt"
                    ? "Gravel Depression"
                    : roadPreset === "cobble"
                    ? "Loose Paver Hole"
                    : "Shallow Pothole";
              } else {
                detectedTypeName =
                  roadPreset === "mud"
                    ? "Mud Ridge"
                    : roadPreset === "dirt"
                    ? "Gravel Mound"
                    : roadPreset === "cobble"
                    ? "Raised Paver Stone"
                    : "Speed Bump";
              }

              const detectedObj = {
                id: Date.now(),
                time: new Date().toLocaleTimeString(),
                type: detectedTypeName,
                deviation_cm: `${anom.depthCm > 0 ? "+" : ""}${anom.depthCm.toFixed(1)}`,
                depth_cm: Math.abs(anom.depthCm),
                length_cm: anom.widthCm,
                width_cm: Math.round(anom.widthCm * 0.8),
                severity: Math.abs(anom.depthCm) >= 8.0 ? "Critical" : "Moderate",
                confidence: "98%",
                slant_range_cm: Math.round(measuredSlantCm * 10) / 10,
                angle_deg: Number(sensorAngleDeg.toFixed(2)),
              };

              setSessionDetections((prev) => [detectedObj, ...prev.slice(0, 19)]);

              if (onSimulatedAnomaly) {
                onSimulatedAnomaly(detectedObj);
              }
            }
          }
        }
      }

      // Draw Laser Beam in Red-Amber Mixed Color (Shooting down-right ahead of bike)
      ctx.save();

      // Create fiery red-amber mixed linear gradient from sensor emitter to pavement contact
      const beamGrad = ctx.createLinearGradient(lidarOriginX, lidarOriginY, hitX, hitY);

      if (isDeep) {
        beamGrad.addColorStop(0, "#dc2626"); // Crimson lens emitter
        beamGrad.addColorStop(0.35, "#ef4444"); // Intense red core
        beamGrad.addColorStop(0.75, "#f97316"); // Red-amber
        beamGrad.addColorStop(1, "#fbbf24"); // Amber flare on crater bed
      } else if (isPothole) {
        beamGrad.addColorStop(0, "#ef4444"); // Red lens emitter
        beamGrad.addColorStop(0.45, "#f97316"); // Red-amber
        beamGrad.addColorStop(1, "#f59e0b"); // Golden amber impact
      } else if (isBump) {
        beamGrad.addColorStop(0, "#f97316"); // Red-amber
        beamGrad.addColorStop(0.5, "#f59e0b"); // Golden amber
        beamGrad.addColorStop(1, "#fbbf24"); // Light amber
      } else {
        // Nominal red-amber mixed laser beam
        beamGrad.addColorStop(0, "#ef4444"); // Vivid crimson red at lens
        beamGrad.addColorStop(0.4, "#ea580c"); // Rich red-orange
        beamGrad.addColorStop(0.7, "#f97316"); // Warm red-amber
        beamGrad.addColorStop(1, "#f59e0b"); // Golden amber at pavement contact
      }

      // Outer glowing beam
      ctx.strokeStyle = beamGrad;
      ctx.lineWidth = isAnomaly ? 3.0 : 2.0;
      ctx.shadowColor = isAnomaly ? "#ef4444" : "#f97316";
      ctx.shadowBlur = isAnomaly ? 14 : 7;

      ctx.beginPath();
      ctx.moveTo(lidarOriginX, lidarOriginY);
      ctx.lineTo(hitX, hitY);
      ctx.stroke();

      // Inner high-intensity laser core filament (incandescent warm white-amber core)
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isAnomaly ? "rgba(254, 202, 202, 0.85)" : "rgba(254, 243, 199, 0.8)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(lidarOriginX, lidarOriginY);
      ctx.lineTo(hitX, hitY);
      ctx.stroke();

      // Laser impact reticle on pavement
      ctx.fillStyle = isAnomaly ? "#ef4444" : "#f97316";
      ctx.shadowColor = "#f59e0b";
      ctx.shadowBlur = isAnomaly ? 10 : 5;
      ctx.beginPath();
      ctx.arc(hitX, hitY, isAnomaly ? 4.5 : 3.0, 0, Math.PI * 2);
      ctx.fill();

      // Outer concentric ring around impact
      ctx.strokeStyle = isAnomaly ? "#ef4444" : "#fbbf24";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hitX, hitY, isAnomaly ? 7.5 : 5.0, 0, Math.PI * 2);
      ctx.stroke();

      // Expanding detection shockwave pulse on alert
      if (isAnomaly) {
        const pulseRadius = ((now % 600) / 600) * 20 + 4;
        ctx.beginPath();
        ctx.arc(hitX, hitY, pulseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = isDeep ? "#ef4444" : "#f97316";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = Math.max(0, 1 - (pulseRadius / 24));
        ctx.stroke();
      }

      // Measurement Callout Tag along inclined beam
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;
      const midBeamX = (lidarOriginX + hitX) / 2;
      const midBeamY = (lidarOriginY + hitY) / 2;

      ctx.fillStyle = "#18181b";
      ctx.fillRect(midBeamX + 10, midBeamY - 12, 120, 22);
      ctx.strokeStyle = isAnomaly ? "#ef4444" : "#f97316";
      ctx.lineWidth = 1;
      ctx.strokeRect(midBeamX + 10, midBeamY - 12, 120, 22);

      ctx.fillStyle = isAnomaly ? "#fca5a5" : "#fdba74";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`${sensorAngleDeg.toFixed(1)}° | R ${measuredSlantCm.toFixed(1)}cm`, midBeamX + 14, midBeamY + 2);

      // Early Warning Lookahead Bracket ahead of front wheel
      if (isAnomaly) {
        ctx.strokeStyle = isAnomaly ? "#ef4444" : "#f97316";
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(frontAxleX, baselineY);
        ctx.lineTo(hitX, baselineY);
        ctx.stroke();

        ctx.fillStyle = isAnomaly ? "#fca5a5" : "#fdba74";
        ctx.font = "8px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`Lead: ${leadDistanceCm.toFixed(0)}cm`, (frontAxleX + hitX) / 2, baselineY + 12);
      }

      ctx.restore();

      // -------------------------------------------------------------
      // 6. SYNC HUD STATS FOR UI OVERLAY
      // -------------------------------------------------------------
      setHudStats({
        speedKmph: simSpeedKmph,
        slantDistanceCm: Math.round(measuredSlantCm * 10) / 10,
        verticalDepthCm: Math.round(verticalDepthCm * 10) / 10,
        deviationCm: Math.round(deltaVerticalCm * 10) / 10,
        surfaceType: activeClass,
        isAlert: isAnomaly,
        severity: isDeep ? "Critical" : isPothole ? "Shallow" : isBump ? "Bump" : "Normal",
        detectedCount: detectedCountRef.current,
        earlyWarningLeadCm: Math.max(0, Math.round(leadDistanceCm)),
      });

      ctx.restore(); // Restore DPR scaling

      if (isRunning) {
        animFrameRef.current = requestAnimationFrame(render);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRunning, simSpeedKmph, simMode, autoSpawn, settings, spawnAnomaly, onSimulatedAnomaly, isHardwareAvailable, sensorAngleDeg, roadPreset]);

  return (
    <div className="space-y-4">
      {/* Simulation Command Bar */}
      <div className="bg-white border border-zinc-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-zinc-900 text-white rounded-md">
            <Bike className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-semibold text-zinc-950 uppercase tracking-wider">
                2D Simulation
              </h2>
            </div>
          </div>
        </div>

        {/* Action Controls & Mode Switch */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-1.5">
          {/* Mode Selector */}
          <div className="flex items-center bg-zinc-100 p-0.5 rounded-md border border-zinc-200 text-xs">
            <button
              onClick={() => setSimMode("generator")}
              className={`px-2.5 py-1 rounded font-medium transition-colors ${simMode === "generator"
                ? "bg-white text-zinc-900 shadow-xs"
                : "text-zinc-500 hover:text-zinc-900"
                }`}
            >
              Autonomous Road
            </button>

            <button
              onClick={() => {
                if (isHardwareAvailable) {
                  setSimMode("hardware");
                }
              }}
              disabled={!isHardwareAvailable}
              title={
                isHardwareAvailable
                  ? "Sync simulation terrain directly to live physical TF02-Pro LiDAR stream"
                  : "Hardware Not Detected: Connect a physical TF02-Pro LiDAR via USB serial to enable live sync"
              }
              className={`flex items-center space-x-1 px-2.5 py-1 rounded font-medium transition-colors ${simMode === "hardware" && isHardwareAvailable
                ? "bg-white text-zinc-900 shadow-xs"
                : isHardwareAvailable
                  ? "text-zinc-500 hover:text-zinc-900"
                  : "text-zinc-400 cursor-not-allowed opacity-60"
                }`}
            >
              {!isHardwareAvailable && <Lock className="w-3 h-3 text-zinc-400" />}
              <span>Hardware Sync</span>
            </button>
          </div>

          {/* Road Surface Preset Selector */}
          <div className="flex items-center bg-zinc-100 p-0.5 rounded-md border border-zinc-200 text-xs">
            <span className="px-2 py-0.5 text-[10px] font-mono text-zinc-400 uppercase hidden md:inline">Road:</span>
            {ROAD_PRESETS.map((p) => {
              const isSelected = roadPreset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handlePresetChange(p.id)}
                  title={`${p.label}: ${p.desc} (Key P to cycle)`}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded font-medium transition-colors ${isSelected
                    ? "bg-white text-zinc-900 shadow-xs font-semibold"
                    : "text-zinc-500 hover:text-zinc-900"
                    }`}
                >
                  <span className={`w-2 h-2 rounded-full border ${p.dot}`} />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          {/* Play / Pause Toggle */}
          <button
            onClick={() => setIsRunning(!isRunning)}
            title="Toggle simulation playback (Space)"
            className="flex items-center space-x-1.5 px-3 py-1 text-xs font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 text-zinc-700 bg-white transition"
          >
            {isRunning ? (
              <>
                <Pause className="w-3.5 h-3.5 text-zinc-500" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-zinc-500" />
                <span>Resume</span>
              </>
            )}
            <kbd className="hidden sm:inline px-1 py-0.2 bg-zinc-100 text-[10px] text-zinc-500 rounded border border-zinc-200 font-mono">Space</kbd>
          </button>

          {/* Reset Simulation Button */}
          <button
            onClick={() => {
              handleReset();
              if (onResetSimulation) onResetSimulation();
            }}
            title="Reset simulation distance, detected potholes, and road terrain (R)"
            className="flex items-center space-x-1.5 px-3 py-1 text-xs font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 text-zinc-700 bg-white transition"
          >
            <RefreshCw className="w-3.5 h-3.5 text-zinc-500" />
            <span>Reset Sim</span>
            <kbd className="hidden sm:inline px-1 py-0.2 bg-zinc-100 text-[10px] text-zinc-500 rounded border border-zinc-200 font-mono">R</kbd>
          </button>

          {/* Keyboard Shortcuts Trigger Button */}
          <button
            onClick={() => setShowShortcutsModal(true)}
            title="View keyboard shortcuts cheat sheet (or press ?)"
            className="flex items-center space-x-1.5 px-2.5 py-1 text-xs font-medium border border-zinc-300 rounded-md hover:bg-zinc-50 text-zinc-700 bg-white transition"
          >
            <Keyboard className="w-3.5 h-3.5 text-zinc-500" />
            <span className="hidden sm:inline">Shortcuts</span>
            <kbd className="px-1 py-0.2 text-[10px] font-mono bg-zinc-100 text-zinc-500 border border-zinc-200 rounded">?</kbd>
          </button>

          {/* Quick Anomaly Spawner */}
          {simMode === "generator" && (
            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => spawnAnomaly("deep_pothole")}
                title="Spawn deep crater pothole (Key 1)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Deep Pothole</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-red-200 rounded text-red-700">1</kbd>
              </button>
              <button
                onClick={() => spawnAnomaly("pothole")}
                title="Spawn shallow road pothole (Key 2)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded-md hover:bg-amber-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Shallow Pothole</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-amber-200 rounded text-amber-800">2</kbd>
              </button>
              <button
                onClick={() => spawnAnomaly("bump")}
                title="Spawn road speed bump (Key 3)"
                className="flex items-center space-x-1 px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200 rounded-md hover:bg-blue-100 transition"
              >
                <Plus className="w-3 h-3" />
                <span>Speed Bump</span>
                <kbd className="hidden md:inline px-1 text-[9px] font-mono bg-white/80 border border-blue-200 rounded text-blue-800">3</kbd>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sensor Angle & Mounting Alignment Control Bar */}
      <div className="bg-white border border-zinc-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center space-x-3 flex-wrap gap-y-2">
          {/* Angle Heading & Badge */}
          <div className="flex items-center space-x-2">
            <div className="p-1.5 bg-orange-50 text-orange-600 rounded border border-orange-200">
              <Sliders className="w-4 h-4" />
            </div>
            <span className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
              Sensor Angle (θ):
            </span>
            <span className="px-2 py-0.5 bg-zinc-900 text-white rounded font-mono font-bold text-xs shadow-xs">
              {sensorAngleDeg.toFixed(2)}°
            </span>
          </div>

          {/* Interactive Range Slider */}
          <div className="flex items-center space-x-2 pl-2">
            <span className="text-[10px] font-mono text-zinc-400">25°</span>
            <input
              type="range"
              min="25.0"
              max="50.0"
              step="0.5"
              value={sensorAngleDeg}
              onChange={(e) => handleAngleChange(parseFloat(e.target.value))}
              aria-label="Adjust sensor inclination angle"
              className="w-28 sm:w-40 accent-orange-600 cursor-pointer h-1.5"
            />
            <span className="text-[10px] font-mono text-zinc-400">50°</span>
          </div>

          {/* Stepper Nudge Buttons */}
          <div className="flex items-center space-x-1">
            <button
              onClick={() => handleAngleChange(sensorAngleDeg - 0.5)}
              title="Angle down by 0.5 degrees (Key D or [ )"
              className="px-1.5 py-0.5 text-xs font-mono bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded border border-zinc-200 transition"
            >
              -0.5° <span className="text-[9px] text-zinc-500 font-sans font-semibold">[D]</span>
            </button>
            <button
              onClick={() => handleAngleChange(sensorAngleDeg + 0.5)}
              title="Angle moveUp by 0.5 degrees (Key A or ] )"
              className="px-1.5 py-0.5 text-xs font-mono bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded border border-zinc-200 transition"
            >
              +0.5° <span className="text-[9px] text-zinc-500 font-sans font-semibold">[A]</span>
            </button>
          </div>
        </div>

        {/* Quick Angle Presets & Lookahead Lead Readout */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          <span className="text-[10px] font-mono text-zinc-400 uppercase">Presets:</span>
          {[
            { label: "25.0°", val: 25.0, desc: "Min Angle" },
            { label: "30.0°", val: 30.0, desc: "Long Range" },
            { label: "43.20°", val: 43.20, desc: "Default Calibrated", def: true },
            { label: "50.0°", val: 50.0, desc: "Max Angle" },
          ].map((preset) => {
            const isSelected = Math.abs(sensorAngleDeg - preset.val) < 0.05;
            return (
              <button
                key={preset.val}
                onClick={() => handleAngleChange(preset.val)}
                title={`${preset.desc} (${preset.val}°)`}
                className={`px-2 py-0.5 text-xs font-mono rounded border transition-colors ${isSelected
                  ? "bg-orange-600 text-white border-orange-700 font-bold shadow-xs"
                  : "bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border-zinc-200"
                  }`}
              >
                {preset.label}
                {preset.def && !isSelected && (
                  <span className="ml-1 text-[9px] text-orange-600 font-semibold">DEF</span>
                )}
              </button>
            );
          })}

          {/* Theoretical Lookahead distance preview */}
          <div className="hidden md:flex items-center ml-2 pl-2 border-l border-zinc-200 text-xs font-mono text-zinc-600">
            <span className="text-zinc-400 mr-1">Tire Lead:</span>
            <span className="font-semibold text-zinc-900">
              {(65.0 / Math.tan((sensorAngleDeg * Math.PI) / 180)).toFixed(0)} cm
            </span>
          </div>
        </div>
      </div>

      {/* Hardware Not Detected Warning Banner (when sync is locked) */}
      {!isHardwareAvailable && simMode === "generator" && (
        <div className="bg-zinc-100 border border-zinc-200 rounded-md px-3.5 py-2 text-xs text-zinc-600 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-zinc-400" />
            <span>
              <strong>Hardware Sync Locked:</strong> Physical sensor disconnected. Operating in Autonomous Simulation mode. Connect USB-UART (/dev/ttyUSB0) to enable live sensor sync.
            </span>
          </div>
          <span className="text-[10px] font-mono text-zinc-400 uppercase">Hardware Offline</span>
        </div>
      )}

      {/* Main 2D Canvas Viewport */}
      <div className="relative w-full h-[400px] bg-black border border-zinc-800 rounded-lg overflow-hidden shadow-sm">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
        />

        {/* Top Left Live HUD Badges */}
        <div className="absolute top-3 left-3 flex items-center space-x-2 pointer-events-none">
          {/* Surface Status Callout */}
          <div
            className={`px-3 py-1.5 rounded-md border text-xs font-mono font-semibold flex items-center space-x-2 shadow-md ${hudStats.isAlert
              ? hudStats.surfaceType === "Deep Pothole"
                ? "bg-red-600 text-white border-red-700 animate-pulse"
                : "bg-amber-500 text-white border-amber-600"
              : "bg-zinc-900 text-zinc-100 border-zinc-700"
              }`}
          >
            {hudStats.isAlert ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
            <span>{hudStats.surfaceType}</span>
          </div>

          {/* Measured Slant Range & Vertical Depth */}
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-3 py-1.5 rounded-md text-xs font-mono shadow-md">
            Angle: <span className="font-bold text-orange-400">{sensorAngleDeg.toFixed(1)}°</span>
            <span className="mx-2 text-zinc-600">|</span>
            Slant R: <span className="font-bold text-white">{hudStats.slantDistanceCm.toFixed(1)} cm</span>
            <span className="mx-2 text-zinc-600">|</span>
            Vert h: <span className="font-bold text-white">{hudStats.verticalDepthCm.toFixed(1)} cm</span>
            <span className={`ml-2 font-bold ${hudStats.deviationCm > 4.5 ? "text-red-400" : hudStats.deviationCm < -4.5 ? "text-blue-400" : "text-zinc-400"}`}>
              (Δ {hudStats.deviationCm > 0 ? "+" : ""}{hudStats.deviationCm.toFixed(1)} cm)
            </span>
          </div>
        </div>

        {/* Top Right Early Warning and Session Counts */}
        <div className="absolute top-3 right-3 flex items-center space-x-2 pointer-events-none">
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-md text-xs font-mono shadow-md">
            Lookahead: <span className="font-semibold text-emerald-400">{hudStats.earlyWarningLeadCm} cm ahead of tire</span>
          </div>
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-md text-xs font-mono shadow-md">
            Speed: <span className="font-semibold text-white">{hudStats.speedKmph} km/h</span>
          </div>
          <div className="bg-zinc-900/90 text-zinc-200 border border-zinc-700 px-2.5 py-1.5 rounded-md text-xs font-mono shadow-md">
            Detected: <span className="font-semibold text-red-400">{hudStats.detectedCount}</span>
          </div>
        </div>

        {/* Bottom Left Speed Slider */}
        <div className="absolute bottom-3 left-3 bg-zinc-900/95 border border-zinc-700 px-3 py-1.5 rounded-md flex items-center space-x-2.5 text-xs font-mono text-zinc-300 shadow-md">
          <span className="text-zinc-400">Speed (W/S):</span>
          <input
            type="range"
            min="10"
            max="80"
            step="5"
            value={simSpeedKmph}
            onChange={(e) => setSimSpeedKmph(Number(e.target.value))}
            className="w-24 accent-white cursor-pointer h-1.5"
          />
          <span className="font-bold text-white w-10">{simSpeedKmph} km/h</span>
        </div>

        {/* Bottom Right Auto Spawn Toggle */}
        {simMode === "generator" && (
          <div className="absolute bottom-3 right-3 bg-zinc-900/95 border border-zinc-700 px-3 py-1.5 rounded-md flex items-center space-x-2 text-xs font-mono text-zinc-300 shadow-md">
            <span className="text-zinc-400">Hazards (H):</span>
            <button
              onClick={() => setAutoSpawn(!autoSpawn)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${autoSpawn ? "bg-emerald-600 text-white" : "bg-zinc-700 text-zinc-300"
                }`}
            >
              {autoSpawn ? "ENABLED" : "PAUSED"}
            </button>
          </div>
        )}
      </div>

      {/* Technical Specifications & Session Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Simulation Session Detections */}
        <div className="lg:col-span-6 bg-white border border-zinc-200 rounded-lg p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-900 uppercase tracking-wider">
              Simulation Detection Log
            </h3>
            <span className="text-[10px] text-zinc-500 font-mono">
              {sessionDetections.length} Anomaly Events Recorded
            </span>
          </div>

          <div className="overflow-x-auto max-h-48 overflow-y-auto border border-zinc-100 rounded">
            <table className="min-w-full text-xs text-left font-mono">
              <thead className="bg-zinc-50 text-zinc-500 text-[10px] uppercase border-b border-zinc-200">
                <tr>
                  <th className="px-3 py-1.5">Time</th>
                  <th className="px-3 py-1.5">Anomaly Type</th>
                  <th className="px-3 py-1.5">Depth</th>
                  <th className="px-3 py-1.5">Slant Range</th>
                  <th className="px-3 py-1.5">Angle</th>
                  <th className="px-3 py-1.5">Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-zinc-700">
                {sessionDetections.length > 0 ? (
                  sessionDetections.map((d) => (
                    <tr key={d.id} className="hover:bg-zinc-50">
                      <td className="px-3 py-1 text-zinc-500">{d.time}</td>
                      <td className="px-3 py-1 font-semibold">
                        <span className={d.type.includes("Deep") ? "text-red-600" : d.type.includes("Pothole") ? "text-amber-600" : "text-blue-600"}>
                          {d.type}
                        </span>
                      </td>
                      <td className="px-3 py-1">{d.depth_cm} cm</td>
                      <td className="px-3 py-1">{d.slant_range_cm} cm</td>
                      <td className="px-3 py-1">{d.angle_deg}°</td>
                      <td className="px-3 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${d.severity === "Critical" ? "bg-red-50 text-red-700 border border-red-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                          {d.severity}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-zinc-400">
                      No simulation detections yet. Drive the motorbike forward or click "+ Deep Pothole" to trigger an event.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Cheat Sheet Modal */}
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
                  Simulation Keyboard Shortcuts
                </h3>
              </div>
              <button
                onClick={() => setShowShortcutsModal(false)}
                className="text-zinc-400 hover:text-zinc-700 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">Space</kbd>
                </div>
                <span className="text-zinc-600 text-right">Pause / Resume</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">R</kbd>
                </div>
                <span className="text-zinc-600 text-right">Reset Sim & Data</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">1</kbd>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">2</kbd>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">3</kbd>
                </div>
                <span className="text-zinc-600 text-right">Spawn Anomaly</span>
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
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">A</kbd>
                  <span className="text-[10px] text-zinc-400">/</span>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">]</kbd>
                </div>
                <span className="text-zinc-600 text-right">Angle MoveUp (+0.5°)</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">D</kbd>
                  <span className="text-[10px] text-zinc-400">/</span>
                  <kbd className="px-1.5 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">[</kbd>
                </div>
                <span className="text-zinc-600 text-right">Angle Down (-0.5°)</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">H</kbd>
                </div>
                <span className="text-zinc-600 text-right">Toggle Road Hazards</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 border-b border-zinc-100 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">P</kbd>
                </div>
                <span className="text-zinc-600 text-right">Cycle Road Preset</span>
              </div>

              <div className="grid grid-cols-2 py-1.5 items-center">
                <div className="flex items-center space-x-1">
                  <kbd className="px-2 py-0.5 bg-zinc-100 border border-zinc-300 rounded text-zinc-800 font-bold">?</kbd>
                </div>
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
