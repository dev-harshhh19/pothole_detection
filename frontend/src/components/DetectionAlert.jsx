import React from "react";
import { AlertTriangle, CheckCircle, ShieldAlert, AlertCircle, Clock } from "lucide-react";

export default function DetectionAlert({ telemetry }) {
  const {
    class_id = 0,
    class_name = "Flat Road",
    deviation_cm = 0,
    distance_cm = 0,
    confidence = 0,
    streak = 0,
    streak_target = 2,
    is_alert = false,
    alert_message = "",
    cooldown_remaining = 0,
  } = telemetry || {};

  let statusBadgeClasses = "bg-emerald-50 text-emerald-800 border-emerald-200";
  let iconContainer = "bg-emerald-50 border-emerald-200 text-emerald-700";
  let Icon = CheckCircle;

  if (class_id === 1) {
    statusBadgeClasses = "bg-amber-50 text-amber-800 border-amber-200";
    iconContainer = "bg-amber-50 border-amber-200 text-amber-700";
    Icon = AlertCircle;
  } else if (class_id === 2) {
    statusBadgeClasses = "bg-rose-50 text-rose-800 border-rose-200";
    iconContainer = "bg-rose-50 border-rose-200 text-rose-700";
    Icon = ShieldAlert;
  } else if (class_id === 3) {
    statusBadgeClasses = "bg-amber-50 text-amber-800 border-amber-200";
    iconContainer = "bg-amber-50 border-amber-200 text-amber-700";
    Icon = AlertTriangle;
  }

  const streakPercent = Math.min(100, Math.round((streak / streak_target) * 100));

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Road condition status */}
        <div className="flex items-center space-x-3.5">
          <div className={`w-9 h-9 rounded-md flex items-center justify-center border ${iconContainer}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Surface Condition:
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${statusBadgeClasses}`}>
                {class_name}
              </span>
              {confidence > 0 && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 border border-zinc-200 font-mono">
                  ML Conf: {Math.round(confidence * 100)}%
                </span>
              )}
            </div>

            <div className="text-xs text-zinc-600 mt-1 font-mono flex items-center space-x-3">
              <span>
                Distance: <strong className="text-zinc-900">{distance_cm.toFixed(1)} cm</strong>
              </span>
              <span className="text-zinc-300">|</span>
              <span>
                Deviation:{" "}
                <strong
                  className={
                    deviation_cm > 8.0
                      ? "text-rose-700 font-bold"
                      : deviation_cm > 4.5 || deviation_cm < -4.5
                      ? "text-amber-700 font-bold"
                      : "text-zinc-900"
                  }
                >
                  {deviation_cm >= 0 ? `+${deviation_cm.toFixed(1)}` : deviation_cm.toFixed(1)} cm
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Right: Streak and cooldown */}
        <div className="flex items-center space-x-4 self-end sm:self-center">
          <div className="text-right">
            <div className="text-[11px] font-mono text-zinc-500">
              Streak: {streak} / {streak_target}
            </div>
            <div className="w-24 h-1.5 bg-zinc-100 rounded-full mt-1 overflow-hidden border border-zinc-200">
              <div
                className={`h-full transition-all duration-150 ${
                  class_id === 2 ? "bg-rose-600" : class_id === 1 ? "bg-amber-600" : "bg-zinc-800"
                }`}
                style={{ width: `${streakPercent}%` }}
              ></div>
            </div>
          </div>

          {cooldown_remaining > 0 && (
            <div className="flex items-center space-x-1 px-2 py-1 rounded bg-zinc-100 border border-zinc-200 text-xs text-zinc-700 font-mono">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span>Cooldown: {cooldown_remaining.toFixed(1)}s</span>
            </div>
          )}
        </div>
      </div>

      {/* Confirmed alert notification */}
      {is_alert && alert_message && (
        <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center space-x-2 text-xs font-semibold text-rose-700">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 text-rose-600" />
          <span>ALERT: {alert_message}</span>
        </div>
      )}
    </div>
  );
}
