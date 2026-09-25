import React, { useState } from "react";
import { X, Sliders, Check } from "lucide-react";

export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings }) {
  const [speedKmph, setSpeedKmph] = useState(settings?.speed_kmph ?? 30);
  const [potThresh, setPotThresh] = useState(settings?.pot_thresh ?? 4.5);
  const [deepThresh, setDeepThresh] = useState(settings?.deep_thresh ?? 8.0);
  const [bumpThresh, setBumpThresh] = useState(settings?.bump_thresh ?? 4.5);
  const [confirmN, setConfirmN] = useState(settings?.confirm_n ?? 2);
  const [cooldownS, setCooldownS] = useState(settings?.cooldown_s ?? 3.0);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    await onSaveSettings({
      speed_kmph: Number(speedKmph),
      pot_thresh: Number(potThresh),
      deep_thresh: Number(deepThresh),
      bump_thresh: Number(bumpThresh),
      confirm_n: Number(confirmN),
      cooldown_s: Number(cooldownS),
    });
    setIsSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/50 backdrop-blur-xs">
      <div className="bg-white border border-zinc-200 rounded-lg w-full max-w-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-zinc-700" />
            <h3 className="text-sm font-semibold text-zinc-950">
              Detection Configuration
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Vehicle Speed */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Vehicle Speed (km/h)
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                min="5"
                max="120"
                step="5"
                value={speedKmph}
                onChange={(e) => setSpeedKmph(e.target.value)}
                className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <span className="text-xs text-zinc-500 font-mono w-28 whitespace-nowrap">
                {((speedKmph * 100000) / 3600 / 100).toFixed(1)} cm/frame
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              Converts frame count to physical road anomaly length and width at 100 Hz.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Shallow Threshold */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Shallow Threshold (cm)
              </label>
              <input
                type="number"
                min="1.0"
                max="30.0"
                step="0.5"
                value={potThresh}
                onChange={(e) => setPotThresh(e.target.value)}
                className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Positive road deviation trigger.
              </p>
            </div>

            {/* Deep Threshold */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Deep Threshold (cm)
              </label>
              <input
                type="number"
                min="1.0"
                max="50.0"
                step="0.5"
                value={deepThresh}
                onChange={(e) => setDeepThresh(e.target.value)}
                className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Severe hazardous pothole boundary.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Bump Threshold */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Bump Threshold (cm)
              </label>
              <input
                type="number"
                min="1.0"
                max="30.0"
                step="0.5"
                value={bumpThresh}
                onChange={(e) => setBumpThresh(e.target.value)}
                className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Negative road deviation trigger.
              </p>
            </div>

            {/* Streak Windows */}
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Confirm Streak (Windows)
              </label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={confirmN}
                onChange={(e) => setConfirmN(e.target.value)}
                className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-[11px] text-zinc-500 mt-1">
                Consecutive sample windows.
              </p>
            </div>
          </div>

          {/* Cooldown */}
          <div>
            <label className="block text-xs font-semibold text-zinc-700 mb-1">
              Detection Cooldown (Seconds)
            </label>
            <input
              type="number"
              min="0.5"
              max="30.0"
              step="0.5"
              value={cooldownS}
              onChange={(e) => setCooldownS(e.target.value)}
              className="w-full bg-white border border-zinc-300 rounded-md px-3 py-1.5 text-xs font-mono text-zinc-900 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Minimum duration between distinct event alerts.
            </p>
          </div>

          {/* Footer buttons */}
          <div className="pt-4 border-t border-zinc-200 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-white text-zinc-700 hover:bg-zinc-50 border border-zinc-300 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-900 hover:bg-zinc-800 text-white transition disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{isSaving ? "Saving..." : "Save Settings"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
