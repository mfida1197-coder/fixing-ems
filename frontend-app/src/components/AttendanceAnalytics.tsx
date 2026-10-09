import type {
  AdminAttendanceDashboardData,
  AttendanceOverviewBucket,
} from "../types/attendanceDashboard";
import { ATTENDANCE_STATUS_COLORS } from "./attendanceAnalyticsConfig";

export function AttendanceOverviewChart({ buckets, gradientId = "ems-attendance-fill" }: { buckets: AttendanceOverviewBucket[]; gradientId?: string }) {
  const width = 700;
  const baseline = 180;
  const largest = Math.max(1, ...buckets.map((bucket) => bucket.present));
  const points = buckets.map((bucket, index) => ({
    ...bucket,
    x: 45 + (index * 610) / Math.max(buckets.length - 1, 1),
    y: baseline - (bucket.present / largest) * 125,
  }));
  const line = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const area = `45,${baseline} ${line} 655,${baseline}`;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));

  return (
    <div className="admin-overview-scroll" role="img" aria-label="Employees present over the selected period">
      <svg viewBox={`0 0 ${width} 230`} className="admin-overview-svg" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff7a1a" stopOpacity=".3" />
            <stop offset="100%" stopColor="#ff7a1a" stopOpacity=".02" />
          </linearGradient>
        </defs>
        {[55, 117, baseline].map((y) => <line className="admin-overview-gridline" key={y} x1="45" x2="655" y1={y} y2={y} strokeDasharray={y === baseline ? "0" : "4 4"} />)}
        <polygon points={area} fill={`url(#${gradientId})`} />
        <polyline className="admin-overview-line" points={line} fill="none" />
        {points.map((bucket, index) => (
          <g key={`${bucket.from}-${bucket.to}`}>
            <title>{`${bucket.label}: ${bucket.present} employees present`}</title>
            <circle className="admin-overview-point" cx={bucket.x} cy={bucket.y} r={buckets.length > 12 ? 3 : 6} />
            {(index % labelEvery === 0 || index === buckets.length - 1) && <text x={bucket.x} y="210" textAnchor="middle">{bucket.label}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function AttendanceTeamStatus({ data, centerLabel = "Total Employees" }: { data: AdminAttendanceDashboardData["teamStatus"]; centerLabel?: string }) {
  const visible = data.statuses.filter((status) => status.count > 0);
  let cursor = 0;
  const stops = visible.map((entry) => {
    const start = cursor;
    cursor += entry.percentage;
    return `${ATTENDANCE_STATUS_COLORS[entry.status]} ${start}% ${cursor}%`;
  });
  const background = stops.length ? `conic-gradient(${stops.join(",")})` : "var(--ui-border)";

  return (
    <div className="admin-team-status-body">
      <div className="admin-team-ring" style={{ background }} aria-label={`${data.totalEmployees} employees`}>
        <div><strong>{data.totalEmployees}</strong><span>{centerLabel}</span></div>
      </div>
      <div className="admin-team-legend">
        {visible.map((entry) => (
          <div key={entry.status}>
            <i style={{ background: ATTENDANCE_STATUS_COLORS[entry.status] }} />
            <span>{entry.label}</span><strong>{entry.count}</strong><small>{entry.percentage}%</small>
          </div>
        ))}
        {visible.length === 0 && <p className="attendance-empty">No employees to summarize.</p>}
      </div>
    </div>
  );
}
