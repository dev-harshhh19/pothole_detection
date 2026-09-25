import React from "react";

function TechnicalLineChart({
  data,
  data2 = null,
  title,
  unit = "cm",
  color = "#18181b",
  color2 = "#a1a1aa",
  height = 150,
  minVal = null,
  maxVal = null,
  showZero = false,
  thresholds = null,
}) {
  const points = data || [];
  const points2 = data2 || [];

  if (points.length < 2) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center text-xs text-zinc-400 bg-zinc-50 rounded-md border border-zinc-200 font-mono"
      >
        Awaiting telemetry frames...
      </div>
    );
  }

  let allVals = [...points];
  if (points2.length > 0) allVals = [...allVals, ...points2];
  if (showZero) allVals.push(0);
  if (thresholds) {
    if (thresholds.upper) allVals.push(thresholds.upper);
    if (thresholds.lower) allVals.push(thresholds.lower);
  }

  const computedMin = minVal !== null ? minVal : Math.min(...allVals);
  const computedMax = maxVal !== null ? maxVal : Math.max(...allVals);
  const range = computedMax - computedMin || 1;
  const paddingY = 14;
  const chartHeight = height - paddingY * 2;
  const width = 500;

  const getCoordinates = (pts) => {
    return pts.map((val, idx) => {
      const x = (idx / (pts.length - 1)) * width;
      const normalized = (val - computedMin) / range;
      const y = height - paddingY - normalized * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
  };

  const path1 = `M ${getCoordinates(points).join(" L ")}`;
  const path2 = points2.length > 1 ? `M ${getCoordinates(points2).join(" L ")}` : null;

  const zeroY =
    showZero && computedMin <= 0 && computedMax >= 0
      ? height - paddingY - ((0 - computedMin) / range) * chartHeight
      : null;

  const upperY =
    thresholds && thresholds.upper !== undefined
      ? height - paddingY - ((thresholds.upper - computedMin) / range) * chartHeight
      : null;

  const lowerY =
    thresholds && thresholds.lower !== undefined
      ? height - paddingY - ((thresholds.lower - computedMin) / range) * chartHeight
      : null;

  const lastVal = points[points.length - 1];

  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-zinc-800 uppercase tracking-wider">
          {title}
        </span>
        <span className="text-xs font-mono font-bold text-zinc-950">
          {typeof lastVal === "number" ? lastVal.toFixed(1) : lastVal} {unit}
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          preserveAspectRatio="none"
          style={{ height }}
        >
          {/* Subtle grid lines */}
          <line
            x1="0"
            y1={paddingY}
            x2={width}
            y2={paddingY}
            stroke="#f4f4f5"
            strokeDasharray="2 2"
          />
          <line
            x1="0"
            y1={height / 2}
            x2={width}
            y2={height / 2}
            stroke="#f4f4f5"
            strokeDasharray="2 2"
          />
          <line
            x1="0"
            y1={height - paddingY}
            x2={width}
            y2={height - paddingY}
            stroke="#f4f4f5"
            strokeDasharray="2 2"
          />

          {/* Zero baseline */}
          {zeroY !== null && (
            <line
              x1="0"
              y1={zeroY}
              x2={width}
              y2={zeroY}
              stroke="#71717a"
              strokeWidth="1.5"
            />
          )}

          {/* Upper threshold line (semantic red) */}
          {upperY !== null && (
            <line
              x1="0"
              y1={upperY}
              x2={width}
              y2={upperY}
              stroke="#dc2626"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* Lower threshold line (semantic amber) */}
          {lowerY !== null && (
            <line
              x1="0"
              y1={lowerY}
              x2={width}
              y2={lowerY}
              stroke="#d97706"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {/* Secondary line (e.g. Baseline) */}
          {path2 && (
            <path
              d={path2}
              fill="none"
              stroke={color2}
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
          )}

          {/* Primary telemetry line */}
          <path
            d={path1}
            fill="none"
            stroke={color}
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        {/* Min/Max legend */}
        <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono mt-1.5 pt-1 border-t border-zinc-100">
          <span>Min: {computedMin.toFixed(1)} {unit}</span>
          {thresholds && (
            <span className="text-zinc-600">
              Limits: +{thresholds.upper} / -{Math.abs(thresholds.lower)} cm
            </span>
          )}
          <span>Max: {computedMax.toFixed(1)} {unit}</span>
        </div>
      </div>
    </div>
  );
}

export default function LiveCharts({ history }) {
  const { distance = [], deviation = [], strength = [], baseline = [] } = history || {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 1. Distance & Baseline Chart */}
      <TechnicalLineChart
        data={distance}
        data2={baseline}
        title="Distance & Baseline"
        unit="cm"
        color="#09090b"
        color2="#a1a1aa"
      />

      {/* 2. Deviation Chart */}
      <TechnicalLineChart
        data={deviation}
        title="Surface Deviation"
        unit="cm"
        color="#18181b"
        showZero={true}
        thresholds={{ upper: 4.5, lower: -4.5 }}
      />

      {/* 3. Signal Strength Chart */}
      <TechnicalLineChart
        data={strength}
        title="Signal Strength"
        unit="AU"
        color="#27272a"
      />
    </div>
  );
}
