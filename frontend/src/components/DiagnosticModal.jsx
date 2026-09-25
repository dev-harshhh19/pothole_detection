import React, { useState } from "react";
import { X, Search, Radio, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";

export default function DiagnosticModal({ isOpen, onClose, selectedPort, baudRate, isSimulated }) {
  const [isRunningRaw, setIsRunningRaw] = useState(false);
  const [isRunningFrame, setIsRunningFrame] = useState(false);
  const [rawResult, setRawResult] = useState(null);
  const [frameResult, setFrameResult] = useState(null);

  if (!isOpen) return null;

  const runRawTest = async () => {
    setIsRunningRaw(true);
    setRawResult(null);
    try {
      const res = await fetch("/api/diagnostic/raw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: selectedPort,
          baudrate: baudRate,
          simulate: isSimulated,
        }),
      });
      const data = await res.json();
      setRawResult(data);
    } catch (err) {
      setRawResult({
        success: false,
        message: `Network error: ${err.message}`,
        lines: [],
      });
    } finally {
      setIsRunningRaw(false);
    }
  };

  const runFrameTest = async () => {
    setIsRunningFrame(true);
    setFrameResult(null);
    try {
      const res = await fetch("/api/diagnostic/frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: selectedPort,
          baudrate: baudRate,
          simulate: isSimulated,
        }),
      });
      const data = await res.json();
      setFrameResult(data);
    } catch (err) {
      setFrameResult({
        success: false,
        message: `Network error: ${err.message}`,
        frame: null,
      });
    } finally {
      setIsRunningFrame(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-xs">
      <div className="bg-white border border-zinc-200 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">
              Hardware Diagnostic Utility
            </h3>
            <p className="text-xs text-zinc-500 font-mono mt-0.5">
              Port: {selectedPort} | Baud: {baudRate}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-5">
          {/* Action buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={runRawTest}
              disabled={isRunningRaw}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-md text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white transition disabled:opacity-50"
            >
              {isRunningRaw ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>{isRunningRaw ? "Reading raw bytes..." : "Raw 90-Byte Dump"}</span>
            </button>

            <button
              onClick={runFrameTest}
              disabled={isRunningFrame}
              className="flex items-center justify-center space-x-2 px-4 py-2.5 rounded-md text-xs font-semibold bg-white hover:bg-zinc-50 text-zinc-900 border border-zinc-300 transition disabled:opacity-50"
            >
              {isRunningFrame ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Radio className="w-4 h-4" />
              )}
              <span>{isRunningFrame ? "Sampling frame..." : "Single Frame Test"}</span>
            </button>
          </div>

          {/* Raw test results */}
          {rawResult && (
            <div className="border border-zinc-200 rounded-md p-4 bg-zinc-50">
              <div className="flex items-center space-x-2 text-xs font-semibold mb-2">
                {rawResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                )}
                <span
                  className={
                    rawResult.success ? "text-emerald-800" : "text-rose-800"
                  }
                >
                  {rawResult.message}
                </span>
              </div>

              {rawResult.lines && rawResult.lines.length > 0 && (
                <div className="mt-2 bg-white p-3 rounded border border-zinc-200 font-mono text-xs text-zinc-800 max-h-48 overflow-y-auto space-y-1">
                  {rawResult.lines.map((line, idx) => (
                    <div key={idx}>{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Frame test results */}
          {frameResult && (
            <div className="border border-zinc-200 rounded-md p-4 bg-zinc-50">
              <div className="flex items-center space-x-2 text-xs font-semibold mb-2">
                {frameResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600" />
                )}
                <span
                  className={
                    frameResult.success ? "text-emerald-800" : "text-rose-800"
                  }
                >
                  {frameResult.message}
                </span>
              </div>

              {frameResult.frame && (
                <div className="mt-2 bg-white p-3 rounded border border-zinc-200 font-mono text-xs text-zinc-800">
                  <pre>{JSON.stringify(frameResult.frame, null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          {/* Diagnostic Notes */}
          <div className="text-xs text-zinc-500 space-y-1.5 border-t border-zinc-200 pt-3">
            <h4 className="font-semibold text-zinc-700 uppercase tracking-wider text-[10px]">
              Sensor Troubleshooting
            </h4>
            <ul className="list-disc pl-4 space-y-1 text-zinc-600">
              <li>
                Connect Sensor TX line to USB-UART Adapter RX line and ensure shared GND.
              </li>
              <li>
                Default TF02-Pro rate is 115200 baud. If packets are corrupt, test at 9600 baud.
              </li>
              <li>
                Valid TF02-Pro data frames begin with header bytes 0x59 0x59.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-200 bg-zinc-50 flex justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-white text-zinc-700 hover:bg-zinc-100 border border-zinc-300 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
