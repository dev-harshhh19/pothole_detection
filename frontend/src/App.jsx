import React, { useState, useEffect, useRef } from "react";
import Navbar from "./components/Navbar";
import ConnectionPanel from "./components/ConnectionPanel";
import TelemetryCards from "./components/TelemetryCards";
import DetectionAlert from "./components/DetectionAlert";
import LiveCharts from "./components/LiveCharts";
import DetectionLog from "./components/DetectionLog";
import DiagnosticModal from "./components/DiagnosticModal";
import SettingsModal from "./components/SettingsModal";

export default function App() {
  // Connection state
  const [connected, setConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState("disconnected");
  const [statusMessage, setStatusMessage] = useState("Sensor not connected");
  const [selectedPort, setSelectedPort] = useState("COM3");
  const [availablePorts, setAvailablePorts] = useState([]);
  const [baudRate, setBaudRate] = useState(115200);
  const [framesReceived, setFramesReceived] = useState(0);
  const [errorsCount, setErrorsCount] = useState(0);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Telemetry metrics
  const [telemetry, setTelemetry] = useState({
    distance_cm: 0,
    baseline_cm: 0,
    deviation_cm: 0,
    strength: 0,
    temperature_c: 0,
    calibrated: false,
    warmup_count: 0,
    warmup_total: 20,
    class_id: 0,
    class_name: "Flat Road",
    confidence: 0,
    streak: 0,
    streak_target: 2,
    is_alert: false,
    alert_message: "",
    cooldown_remaining: 0,
  });

  const [potholeCount, setPotholeCount] = useState(0);
  const [bumpCount, setBumpCount] = useState(0);
  const [lastDepth, setLastDepth] = useState(0);

  // History buffers for real-time charts
  const [history, setHistory] = useState({
    distance: [],
    deviation: [],
    strength: [],
    baseline: [],
  });

  // Detection log list
  const [logs, setLogs] = useState([]);

  // Settings
  const [settings, setSettings] = useState({
    speed_kmph: 30,
    pot_thresh: 4.5,
    deep_thresh: 8.0,
    bump_thresh: 4.5,
    confirm_n: 2,
    cooldown_s: 3.0,
  });

  // Modal states
  const [isDiagnosticOpen, setIsDiagnosticOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // WebSocket reference
  const wsRef = useRef(null);

  // Fetch available COM / serial ports
  const fetchPorts = async () => {
    try {
      const res = await fetch("/api/ports");
      const data = await res.json();
      if (data && data.ports) {
        setAvailablePorts(data.ports);
        if (data.ports.length > 0 && !data.ports.includes(selectedPort)) {
          setSelectedPort(data.ports[0]);
        }
      }
    } catch {
      // Backend starting or offline
    }
  };

  // Fetch initial status
  const fetchInitialStatus = async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      if (data) {
        setConnected(data.connected);
        setIsSimulated(data.is_simulated);
        setStatus(data.status);
        setStatusMessage(data.status_message);
        if (data.port) setSelectedPort(data.port);
        if (data.baudrate) setBaudRate(data.baudrate);
        if (data.frames_received !== undefined) setFramesReceived(data.frames_received);
        if (data.errors_count !== undefined) setErrorsCount(data.errors_count);
        if (data.pothole_count !== undefined) setPotholeCount(data.pothole_count);
        if (data.bump_count !== undefined) setBumpCount(data.bump_count);
        if (data.last_depth !== undefined) setLastDepth(data.last_depth);
        if (data.telemetry) setTelemetry(data.telemetry);
        if (data.settings) setSettings(data.settings);
      }
    } catch {
      // Backend not yet reachable
    }
  };

  // Fetch detection log
  const fetchLog = async () => {
    try {
      const res = await fetch("/api/log");
      const data = await res.json();
      if (data && data.log) {
        setLogs(data.log);
      }
    } catch {
      // Backend not yet reachable
    }
  };

  // Connect to WebSocket stream
  useEffect(() => {
    fetchPorts();
    fetchInitialStatus();
    fetchLog();

    let ws = null;
    let reconnectTimeout = null;

    const connectWs = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const host = window.location.hostname || "localhost";
      const wsUrl = `${protocol}//${host}:8000/ws`;

      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setConnected(data.connected);
          setIsSimulated(data.is_simulated);
          setStatus(data.status);
          setStatusMessage(data.status_message);
          if (data.port) setSelectedPort(data.port);
          if (data.baudrate) setBaudRate(data.baudrate);
          setFramesReceived(data.frames_received || 0);
          setErrorsCount(data.errors_count || 0);
          setPotholeCount(data.pothole_count || 0);
          setBumpCount(data.bump_count || 0);
          setLastDepth(data.last_depth || 0);

          if (data.telemetry) {
            setTelemetry(data.telemetry);
          }

          if (data.history) {
            setHistory(data.history);
          }

          if (data.log_preview && data.log_preview.length > 0) {
            setLogs((prev) => {
              const existingIds = new Set(prev.map((item) => item.id));
              const newItems = data.log_preview.filter(
                (item) => !existingIds.has(item.id)
              );
              if (newItems.length > 0) {
                return [...newItems, ...prev];
              }
              return prev;
            });
          }
        } catch {
          // Parse error
        }
      };

      ws.onclose = () => {
        reconnectTimeout = setTimeout(connectWs, 2000);
      };

      ws.onerror = () => {
        if (ws) ws.close();
      };
    };

    connectWs();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Connect to hardware or simulation
  const handleConnect = async (simulate = false) => {
    setIsConnecting(true);
    setStatus("connecting");
    setStatusMessage(`Connecting to ${selectedPort} at ${baudRate} baud...`);
    try {
      const res = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: selectedPort,
          baudrate: baudRate,
          simulate: simulate,
        }),
      });
      const data = await res.json();
      setConnected(data.success);
      setIsSimulated(Boolean(data.simulated));
      setStatus(data.success ? "connected" : "error");
      setStatusMessage(data.message);
    } catch (err) {
      setConnected(false);
      setStatus("error");
      setStatusMessage(`Connection failed: ${err.message}`);
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect
  const handleDisconnect = async () => {
    try {
      const res = await fetch("/api/disconnect", { method: "POST" });
      const data = await res.json();
      setConnected(false);
      setIsSimulated(false);
      setStatus("disconnected");
      setStatusMessage(data.message || "Disconnected");
    } catch (err) {
      setStatusMessage(`Disconnect error: ${err.message}`);
    }
  };

  // Toggle simulation
  const handleToggleSimulate = () => {
    if (isSimulated && connected) {
      handleDisconnect();
    } else {
      handleConnect(true);
    }
  };

  // Reset metrics
  const handleResetMetrics = async () => {
    setIsResetting(true);
    try {
      await fetch("/api/reset", { method: "POST" });
      setPotholeCount(0);
      setBumpCount(0);
      setLastDepth(0);
      setLogs([]);
      setHistory({
        distance: [],
        deviation: [],
        strength: [],
        baseline: [],
      });
    } catch {
      // Error
    } finally {
      setIsResetting(false);
    }
  };

  // Save settings
  const handleSaveSettings = async (newSettings) => {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      setSettings(newSettings);
    } catch {
      // Error
    }
  };

  // Clear logs
  const handleClearLog = () => {
    setLogs([]);
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar
        connected={connected}
        isSimulated={isSimulated}
        status={status}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDiagnostic={() => setIsDiagnosticOpen(true)}
        onResetMetrics={handleResetMetrics}
        isResetting={isResetting}
      />

      {/* Main Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-4">
        {/* Connection and Hardware Status Panel */}
        <ConnectionPanel
          connected={connected}
          isSimulated={isSimulated}
          status={status}
          statusMessage={statusMessage}
          selectedPort={selectedPort}
          setSelectedPort={setSelectedPort}
          availablePorts={availablePorts}
          onRefreshPorts={fetchPorts}
          baudRate={baudRate}
          setBaudRate={setBaudRate}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onToggleSimulate={handleToggleSimulate}
          framesReceived={framesReceived}
          errorsCount={errorsCount}
          isConnecting={isConnecting}
        />

        {/* Telemetry Metrics Row */}
        <TelemetryCards
          telemetry={telemetry}
          potholeCount={potholeCount}
          bumpCount={bumpCount}
          lastDepth={lastDepth}
        />

        {/* Live Surface Condition Banner */}
        <DetectionAlert telemetry={telemetry} />

        {/* Telemetry Waveforms */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Sensor Waveforms (10 Hz Telemetry)
            </h2>
            <span className="text-[10px] text-zinc-500 font-mono">
              Window: 100 samples
            </span>
          </div>
          <LiveCharts history={history} />
        </div>

        {/* Anomaly Detection Log Table */}
        <DetectionLog logs={logs} onClearLog={handleClearLog} />
      </main>

      {/* Hardware Diagnostic Modal */}
      <DiagnosticModal
        isOpen={isDiagnosticOpen}
        onClose={() => setIsDiagnosticOpen(false)}
        selectedPort={selectedPort}
        baudRate={baudRate}
        isSimulated={isSimulated}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
}
