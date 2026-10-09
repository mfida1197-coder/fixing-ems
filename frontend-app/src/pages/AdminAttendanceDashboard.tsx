import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api";
import { getAttendanceDashboard } from "../lib/attendanceDashboardApi";
import type {
  AdminAttendanceDashboardData,
  AdminAttendanceStatus,
  AttendanceOverviewPeriod,
  AttendanceTimelineEmployee,
} from "../types/attendanceDashboard";
import {
  AttendanceOverviewChart,
  AttendanceTeamStatus,
} from "../components/AttendanceAnalytics";
import { ATTENDANCE_PERIODS, ATTENDANCE_STATUS_COLORS } from "../components/attendanceAnalyticsConfig";
import type { AttendanceDirectoryPreset } from "./AdminAttendanceEmployees";


function karachiToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function moveDate(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTime(value: string | null): string {
  if (!value) return "Open";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function duration(seconds: number | null): string {
  if (seconds === null) return "In progress";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "Attendance dashboard could not be loaded.";
}

function TimelineLane({ employee }: { employee: AttendanceTimelineEmployee }) {
  return (
    <article className="admin-timeline-lane">
      <div className="admin-timeline-person">
        <span className="admin-avatar">{employee.employeeName.charAt(0).toUpperCase()}</span>
        <div><strong>{employee.employeeName}</strong><small>{employee.employeeCode} · {employee.designation}</small></div>
        <span className={`attendance-status attendance-status-${employee.status}`}>{employee.statusLabel}</span>
      </div>
      <div className="admin-timeline-track" aria-label={`${employee.employeeName} attendance timeline`}>
        {Array.from({ length: 9 }, (_, index) => <i className="admin-timeline-gridline" key={index} style={{ left: `${index * 12.5}%` }} />)}
        {employee.sessions.map((session) => (
          <div key={session.id} className={`admin-session-layer admin-session-${(session.sessionNumber - 1) % 3}`}>
            {session.workingSegments.map((item, index) => (
              <span
                key={`work-${index}`}
                className="admin-work-segment"
                style={{ left: `${(item.startMinute / 1440) * 100}%`, width: `${Math.max(.35, ((item.endMinute - item.startMinute) / 1440) * 100)}%` }}
                title={`Session ${session.sessionNumber} working segment`}
              />
            ))}
            {session.breaks.map((item) => (
              <span
                key={`break-${item.id}`}
                className={`admin-break-segment admin-break-${item.state}`}
                style={{ left: `${(item.startMinute / 1440) * 100}%`, width: `${Math.max(.35, ((item.endMinute - item.startMinute) / 1440) * 100)}%` }}
                title={`Break (${item.state})`}
              />
            ))}
          </div>
        ))}
        {employee.sessions.length === 0 && <span className="admin-no-activity">No attendance sessions</span>}
      </div>
      <div className="admin-session-chips">
        {employee.sessions.map((session) => (
          <span key={session.id}>
            S{session.sessionNumber} {formatTime(session.checkInAtUtc)}–{formatTime(session.checkOutAtUtc)} · {duration(session.workedSeconds)}
            {session.breaks.length ? ` · ${session.breaks.length} break${session.breaks.length === 1 ? "" : "s"}` : ""}
          </span>
        ))}
      </div>
    </article>
  );
}

export default function AdminAttendanceDashboard({
  onOpenReports,
  onOpenEmployees,
  onOpenPendingLeave,
}: {
  onOpenReports: () => void;
  onOpenEmployees: (preset: AttendanceDirectoryPreset, date: string) => void;
  onOpenPendingLeave: () => void;
}) {
  const today = karachiToday();
  const [date, setDate] = useState(today);
  const [period, setPeriod] = useState<AttendanceOverviewPeriod>(7);
  const [data, setData] = useState<AdminAttendanceDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"activity" | "all" | AdminAttendanceStatus>("activity");

  const load = useCallback(async (manual = false) => {
    if (manual) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");
    try { setData(await getAttendanceDashboard(date, period)); }
    catch (loadError) { setError(errorMessage(loadError)); }
    finally { setLoading(false); setRefreshing(false); }
  }, [date, period]);

  useEffect(() => { load(); }, [load]);

  const employees = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.timeline.employees ?? []).filter((employee) => {
      const matchesSearch = !query || `${employee.employeeName} ${employee.employeeCode} ${employee.designation}`.toLowerCase().includes(query);
      const matchesFilter = filter === "all" || (filter === "activity" ? employee.sessions.length > 0 : employee.status === filter);
      return matchesSearch && matchesFilter;
    });
  }, [data, filter, search]);

  return (
    <main className="content admin-attendance-page">
      {error && <p className="attendance-action-error">{error}</p>}
      {loading && !data ? <div className="admin-dashboard-loading">Loading attendance analytics…</div> : data && (
        <>
          <section className="admin-kpi-grid" aria-label="Attendance key performance indicators">
            {[
              {
                label: "Total Employees", value: data.kpis.totalEmployees, detail: "Active EMS employees", tone: "total",
                onClick: () => onOpenEmployees({ title: "Total employees", description: "Active EMS employees for the selected work date.", employment: "active" }, date),
              },
              {
                label: "Today Presents", value: data.kpis.todayPresent, detail: "Completed attendance for selected date", tone: "present",
                onClick: () => onOpenEmployees({ title: "Present today", description: "Employees with completed attendance for the selected work date.", status: "present" }, date),
              },
              {
                label: "Today Absents", value: data.kpis.todayAbsent, detail: "Absent for selected date", tone: "absent",
                onClick: () => onOpenEmployees({ title: "Absent today", description: "Employees who have not checked in for the selected work date.", status: "absent" }, date),
              },
              {
                label: "Pending Leave", value: data.kpis.pendingLeave, detail: "Awaiting review", tone: "leave",
                onClick: onOpenPendingLeave,
              },
            ].map((item) => <button type="button" className={`admin-kpi-card admin-kpi-${item.tone}`} key={item.label} onClick={item.onClick} aria-label={`${item.label}: ${item.value}. ${item.detail}`}><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></button>)}
          </section>

          <section className="admin-analytics-grid">
            <div className="admin-dashboard-card admin-overview-card">
              <div className="admin-card-head"><div><h2>Attendance Overview</h2><p>Employees present over the selected period</p></div><select className="field-input" value={period} onChange={(event) => setPeriod(Number(event.target.value) as AttendanceOverviewPeriod)}>{ATTENDANCE_PERIODS.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select></div>
              {data.overview.buckets.length ? <AttendanceOverviewChart buckets={data.overview.buckets} /> : <p className="attendance-empty">No chart data is available.</p>}
              <div className="admin-chart-legend"><span><i style={{ background: ATTENDANCE_STATUS_COLORS.present }} />Present employees</span></div>
            </div>
            <div className="admin-dashboard-card admin-team-card"><div className="admin-card-head"><div><h2>Team Status</h2><p>{formatDate(data.selectedDate)}</p></div></div><AttendanceTeamStatus data={data.teamStatus} /></div>
          </section>

          <section className="admin-dashboard-card admin-timeline-card">
            <div className="admin-timeline-head">
              <div><h2>Daily Check-in &amp; Check-out Timeline</h2><p>Separate sessions and break-excluded working segments</p></div>
              <div className="admin-timeline-date-controls"><button type="button" className="btn-sm" aria-label="Previous day" onClick={() => setDate(moveDate(date, -1))}>‹</button><input className="field-input" type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /><button type="button" className="btn-sm" aria-label="Next day" onClick={() => setDate(moveDate(date, 1))}>›</button>{date !== today && <button type="button" className="btn-ghost" onClick={() => setDate(today)}>Today</button>}<button type="button" className="btn-ghost" disabled={refreshing} onClick={() => load(true)}>↻ {refreshing ? "Syncing…" : "Sync"}</button></div>
            </div>
            <div className="admin-timeline-summary"><span><strong>{data.timeline.totalCheckIns}</strong> check-ins</span><span><strong>{data.timeline.totalCheckOuts}</strong> check-outs</span><span><strong>{data.timeline.activeEmployees}</strong> active sessions</span><time>{formatDate(data.selectedDate)}</time></div>
            <div className="admin-timeline-filters"><input className="field-input" type="search" placeholder="Search employee" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="field-input" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="activity">With attendance activity</option><option value="all">All employees</option><option value="present">Present</option><option value="absent">Absent</option><option value="leave">Full-day leave</option><option value="short_leave">Short leave</option><option value="holiday">Holiday</option><option value="incomplete">Incomplete</option><option value="pending">Current / pending</option></select></div>
            <div className="admin-timeline-scroll"><div className="admin-timeline-canvas"><div className="admin-time-axis"><span>Employee</span><div>{["12 AM", "3 AM", "6 AM", "9 AM", "12 PM", "3 PM", "6 PM", "9 PM", "12 AM"].map((label, index) => <small key={`${label}-${index}`}>{label}</small>)}</div></div>{employees.map((employee) => <TimelineLane employee={employee} key={employee.employeeId} />)}{employees.length === 0 && <div className="admin-timeline-empty"><strong>No matching attendance activity</strong><span>Change the date or filters to view another result.</span></div>}</div></div>
            <div className="admin-timeline-legend"><span><i className="work" />Working segment</span><span><i className="break" />Break gap</span><span>Remote sessions remain separate · GPS breaks remain inside one session</span></div>
          </section>

          <section className="admin-dashboard-card admin-report-card"><div><p className="attendance-kicker">Reports</p><h2>Attendance Reports</h2><p>Preview backend-authoritative employee-day results and download an audited PDF.</p></div><button className="btn-download" type="button" onClick={onOpenReports}>Open Reports</button></section>
        </>
      )}
    </main>
  );
}
