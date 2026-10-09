import { useState } from "react";
import type { Txn } from "../pages/Finance";

interface FinanceOverviewChartProps {
  txns: Txn[];
}

interface ChartBucket {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

export function FinanceOverviewChart({ txns }: FinanceOverviewChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!txns || txns.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: 220,
          color: "var(--ui-muted, #94a3b8)",
          fontSize: 14,
        }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 8, opacity: 0.6 }}>
          <path d="M3 3v18h18" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M19 9l-5 5-4-4-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>No transaction data available for the selected period</span>
      </div>
    );
  }

  // Sort chronological
  const sorted = [...txns].sort(
    (a, b) => new Date(a.txn_date).getTime() - new Date(b.txn_date).getTime()
  );

  const firstDate = new Date(sorted[0].txn_date).getTime();
  const lastDate = new Date(sorted[sorted.length - 1].txn_date).getTime();
  const spanDays = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24));
  const isMultiMonth = spanDays > 75;

  const bucketMap = new Map<string, ChartBucket>();

  for (const t of sorted) {
    const d = new Date(t.txn_date);
    const key = isMultiMonth
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      : String(t.txn_date).slice(0, 10);
    const label = isMultiMonth
      ? d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const cur = bucketMap.get(key) || { key, label, inflow: 0, outflow: 0, net: 0 };
    if (t.type === "inflow") cur.inflow += Number(t.amount_pkr);
    if (t.type === "outflow") cur.outflow += Number(t.amount_pkr);
    cur.net = cur.inflow - cur.outflow;
    bucketMap.set(key, cur);
  }

  const rawBuckets = Array.from(bucketMap.values());

  // If only 1 bucket, add a padded baseline before so line renders
  const buckets: ChartBucket[] =
    rawBuckets.length === 1
      ? [{ key: "prev", label: "", inflow: 0, outflow: 0, net: 0 }, ...rawBuckets]
      : rawBuckets;

  // Chart dimensions
  const svgWidth = 740;
  const svgHeight = 240;
  const padLeft = 70;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 45;
  const plotW = svgWidth - padLeft - padRight;
  const plotH = svgHeight - padTop - padBottom;
  const baselineY = padTop + plotH;

  const maxValRaw = Math.max(1, ...buckets.map((b) => Math.max(b.inflow, b.outflow)));
  // Round up to nice number
  const mag = Math.pow(10, Math.floor(Math.log10(maxValRaw)));
  const normalized = maxValRaw / mag;
  let niceNorm = 10;
  if (normalized <= 1) niceNorm = 1;
  else if (normalized <= 2) niceNorm = 2;
  else if (normalized <= 5) niceNorm = 5;
  const maxVal = niceNorm * mag;

  const points = buckets.map((b, i) => {
    const x = padLeft + (i / Math.max(buckets.length - 1, 1)) * plotW;
    const yIn = baselineY - (b.inflow / maxVal) * plotH;
    const yOut = baselineY - (b.outflow / maxVal) * plotH;
    return { ...b, x, yIn, yOut, index: i };
  });

  const inflowLine = points.map((p) => `${p.x},${p.yIn}`).join(" ");
  const outflowLine = points.map((p) => `${p.x},${p.yOut}`).join(" ");
  const inflowArea = `${points[0].x},${baselineY} ${inflowLine} ${points[points.length - 1].x},${baselineY}`;
  const outflowArea = `${points[0].x},${baselineY} ${outflowLine} ${points[points.length - 1].x},${baselineY}`;

  // Y-axis grid levels
  const yTicks = [0, 0.33, 0.66, 1].map((ratio) => ({
    val: maxVal * ratio,
    y: baselineY - ratio * plotH,
  }));

  const formatPkr = (n: number) => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
    if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
    return String(Math.round(abs));
  };

  const labelInterval = Math.max(1, Math.ceil(buckets.length / 8));
  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="admin-overview-scroll" style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        aria-label="Finance Inflow and Outflow Chart"
      >
        <defs>
          <linearGradient id="chart-inflow-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
          <linearGradient id="chart-outflow-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Gridlines & Y-axis labels */}
        {yTicks.map(({ val, y }, idx) => (
          <g key={idx}>
            <line
              x1={padLeft}
              x2={padLeft + plotW}
              y1={y}
              y2={y}
              stroke="var(--ui-border, #e2e8f0)"
              strokeDasharray={idx === 0 ? "0" : "3 3"}
              strokeOpacity="0.8"
            />
            <text
              x={padLeft - 10}
              y={y + 4}
              textAnchor="end"
              fontSize="11"
              fontWeight="500"
              fill="var(--ui-muted, #94a3b8)"
            >
              Rs {formatPkr(val)}
            </text>
          </g>
        ))}

        {/* Shaded Areas */}
        <polygon points={inflowArea} fill="url(#chart-inflow-grad)" />
        <polygon points={outflowArea} fill="url(#chart-outflow-grad)" />

        {/* Polylines */}
        <polyline
          points={inflowLine}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={outflowLine}
          fill="none"
          stroke="#ef4444"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Active hover crosshair vertical guide */}
        {activePoint && (
          <line
            x1={activePoint.x}
            x2={activePoint.x}
            y1={padTop}
            y2={baselineY}
            stroke="var(--ui-muted, #94a3b8)"
            strokeDasharray="2 2"
            strokeOpacity="0.7"
          />
        )}

        {/* X-axis labels and interactive point markers */}
        {points.map((p, idx) => {
          const showLabel = (idx % labelInterval === 0 || idx === points.length - 1) && !!p.label;
          return (
            <g
              key={p.key + idx}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{ cursor: "pointer" }}
            >
              {showLabel && (
                <text
                  x={p.x}
                  y={baselineY + 22}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="500"
                  fill="var(--ui-muted, #94a3b8)"
                >
                  {p.label}
                </text>
              )}

              {/* Invisible wider hit-target for hover */}
              <rect
                x={p.x - 12}
                y={padTop}
                width="24"
                height={plotH}
                fill="transparent"
              />

              {/* Inflow Dot */}
              <circle
                cx={p.x}
                cy={p.yIn}
                r={hoveredIdx === idx ? 5.5 : 3.5}
                fill="#ffffff"
                stroke="#10b981"
                strokeWidth="2.5"
                style={{ transition: "r 0.15s ease" }}
              />

              {/* Outflow Dot */}
              <circle
                cx={p.x}
                cy={p.yOut}
                r={hoveredIdx === idx ? 5.5 : 3.5}
                fill="#ffffff"
                stroke="#ef4444"
                strokeWidth="2.5"
                style={{ transition: "r 0.15s ease" }}
              />
            </g>
          );
        })}
      </svg>

      {/* Floating Tooltip */}
      {activePoint && activePoint.label && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: activePoint.x / svgWidth < 0.5 ? `${activePoint.x / svgWidth * 100}%` : undefined,
            right: activePoint.x / svgWidth >= 0.5 ? `${(1 - activePoint.x / svgWidth) * 100}%` : undefined,
            maxWidth: "calc(100% - 16px)",
            boxSizing: "border-box",
            background: "var(--ui-surface, #ffffff)",
            border: "1px solid var(--ui-border, #e2e8f0)",
            boxShadow: "0 6px 16px rgba(0, 0, 0, 0.12)",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 12,
            pointerEvents: "none",
            zIndex: 10,
            whiteSpace: "normal",
            overflowWrap: "anywhere",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--ui-text, #0f172a)", marginBottom: 4 }}>
            {activePoint.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span>Inflow: <strong>Rs {Number(activePoint.inflow).toLocaleString()}</strong></span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ef4444", marginTop: 2 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
            <span>Outflow: <strong>Rs {Number(activePoint.outflow).toLocaleString()}</strong></span>
          </div>
          <div style={{ borderTop: "1px solid var(--ui-border, #f1f5f9)", marginTop: 4, paddingTop: 4, color: "var(--ui-muted, #64748b)" }}>
            Net: <strong style={{ color: activePoint.net >= 0 ? "#10b981" : "#ef4444" }}>
              {activePoint.net < 0 ? "-" : ""}Rs {Math.abs(activePoint.net).toLocaleString()}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}
