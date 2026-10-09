import { useCallback, useEffect, useMemo, useState } from "react";
import { LuArrowLeft } from "react-icons/lu";
import {
  getAdminEmployeeCalendar,
  getAdminEmployeeHistory,
  getAttendanceEmployeeOverview,
  getAttendanceEmployees,
  getCanonicalEmployeeDetail,
  getEmployeeLeaveHistory,
  updateAttendanceEmployeeSettings,
} from "../lib/attendanceEmployeesApi";
import type {
  AttendanceEmployeeDirectory,
  AttendanceEmployeeLiveState,
  AttendanceEmployeeProfileOverview,
  CanonicalEmployeeDetail,
} from "../types/attendanceEmployees";
import type {
  AttendanceCalendar,
  AttendanceHistory,
  AttendancePeriodSummary,
  AttendanceSessionCalculation,
} from "../types/attendance";
import type { LeaveRequest } from "../types/leave";

const STATUS_LABELS: Record<string, string> = {
  future: "Future", holiday: "Holiday", leave: "Full-day leave", short_leave: "Short leave",
  present: "Present", pending: "Current / pending", incomplete: "Incomplete", absent: "Absent",
  working: "Working", on_break: "On break",
};

function karachiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function moveDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthRange(month: string) {
  const from = `${month}-01`;
  const date = new Date(`${from}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: date.toISOString().slice(0, 10) };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(value));
}

function duration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function displayHours(minutes: number) {
  if (!minutes) return "No target set";
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "The request could not be completed";
}

function ProgressCard({ title, period }: { title: string; period: AttendancePeriodSummary }) {
  const percent = period.target.progressPercent;
  return (
    <article className="attendance-progress-card">
      <div><span>{title}</span><strong>{duration(period.workedSeconds)}</strong></div>
      <div className="attendance-progress-track"><i style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></div>
      <small>{period.target.targetConfigured ? `${displayHours(period.target.targetMinutes)} target · ${percent}%` : "No target set"}</small>
    </article>
  );
}

function SessionCard({ session, number }: { session: AttendanceSessionCalculation; number: number }) {
  return (
    <article className={`attendance-session ${session.session.state === "open" ? "attendance-session-active" : ""}`}>
      <div className="attendance-session-head">
        <div><span className="attendance-session-dot" /><strong>Session #{number}</strong></div>
        <span className={`attendance-status attendance-status-${session.session.state === "incomplete" ? "incomplete" : session.session.state === "open" ? "pending" : "present"}`}>{session.session.state}</span>
      </div>
      <div className="attendance-session-times">
        <span><small>Check in</small>{formatTime(session.session.checkInAtUtc)}</span><b>→</b>
        <span><small>Check out</small>{formatTime(session.session.checkOutAtUtc)}</span>
        <span><small>Worked</small>{duration(session.workedSeconds)}</span>
        <span><small>Breaks</small>{duration(session.completedBreakSeconds)}</span>
      </div>
      {session.session.breaks.length > 0 && (
        <div className="attendance-breaks">
          {session.session.breaks.map((item, index) => (
            <span key={item.id}>Break #{index + 1}: {formatTime(item.breakOutAtUtc)} → {formatTime(item.breakInAtUtc)} · {item.state}</span>
          ))}
        </div>
      )}
      {(session.session.state === "incomplete" || session.hasIncompleteBreak) && (
        <p className="attendance-warning-inline">Incomplete attendance is preserved and requires a separately approved correction workflow.</p>
      )}
    </article>
  );
}

type ProfileData = {
  overview: AttendanceEmployeeProfileOverview;
  employee: CanonicalEmployeeDetail;
  history: AttendanceHistory;
  calendar: AttendanceCalendar;
  leave: LeaveRequest[];
};

export type AttendanceDirectoryPreset = {
  title: string;
  description: string;
  employment?: "active" | "resigned" | "terminated";
  status?: AttendanceEmployeeLiveState;
};

export function EmployeeAttendanceProfile({ employeeId, onBack, onOpenSettings, embedded = false }: {
  employeeId: number;
  onBack?: () => void;
  onOpenSettings: () => void;
  embedded?: boolean;
}) {
  const today = karachiToday();
  const [date, setDate] = useState(today);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"gps" | "remote">("remote");
  const [weeklyHours, setWeeklyHours] = useState("0");
  const [monthlyHours, setMonthlyHours] = useState("0");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const historyFrom = moveDate(date, -89);
    const calendarRange = monthRange(calendarMonth);
    try {
      const [overview, employee, history, calendar, leave] = await Promise.all([
        getAttendanceEmployeeOverview(employeeId, date),
        getCanonicalEmployeeDetail(employeeId).then((result) => result.employee),
        getAdminEmployeeHistory(employeeId, historyFrom, date),
        getAdminEmployeeCalendar(employeeId, calendarRange.from, calendarRange.to),
        getEmployeeLeaveHistory(employeeId).then((result) => result.requests),
      ]);
      setData({ overview, employee, history, calendar, leave });
      setMode(overview.settings.attendanceMode);
      setWeeklyHours(String(overview.settings.weeklyTargetMinutes / 60));
      setMonthlyHours(String(overview.settings.monthlyTargetMinutes / 60));
    } catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }, [calendarMonth, date, employeeId]);

  useEffect(() => { load(); }, [load]);

  async function saveSettings() {
    const weekly = Number(weeklyHours);
    const monthly = Number(monthlyHours);
    if (!Number.isFinite(weekly) || weekly < 0 || !Number.isFinite(monthly) || monthly < 0) {
      setError("Weekly and monthly targets must be non-negative numbers of hours"); return;
    }
    const weeklyTargetMinutes = Math.round(weekly * 60);
    const monthlyTargetMinutes = Math.round(monthly * 60);
    setSaving(true); setError(""); setMessage("");
    try {
      await updateAttendanceEmployeeSettings(employeeId, { attendanceMode: mode, weeklyTargetMinutes, monthlyTargetMinutes });
      setMessage("Attendance settings saved. Historical sessions were not changed.");
      await load();
    } catch (saveError) { setError(errorText(saveError)); }
    finally { setSaving(false); }
  }

  if (loading && !data) return <div className={`attendance-admin-employees${embedded ? " attendance-profile-embedded" : " content"}`}>{!embedded && <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={onBack}><LuArrowLeft size={15} aria-hidden="true" /> Attendance employees</button>}<div className="admin-dashboard-loading">Loading employee attendance profile…</div></div>;
  if (!data) return <div className={`attendance-admin-employees${embedded ? " attendance-profile-embedded" : " content"}`}>{!embedded && <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={onBack}><LuArrowLeft size={15} aria-hidden="true" /> Attendance employees</button>}<p className="attendance-action-error">{error || "Employee attendance profile is unavailable."}</p></div>;

  const { employee, overview, history, calendar, leave } = data;
  const gpsMissing = mode === "gps" && (
    overview.organizationSettings.officeLatitude === null
    || overview.organizationSettings.officeLongitude === null
    || overview.organizationSettings.allowedRadiusMeters === null
  );
  const net = (Number(employee.basic_salary) || 0) + (Number(employee.allowances) || 0) - (Number(employee.deductions) || 0);
  const startWeekday = new Date(`${calendar.from}T00:00:00.000Z`).getUTCDay();
  const spacers = startWeekday === 0 ? 6 : startWeekday - 1;

  return (
    <div className={`${embedded ? "attendance-profile-embedded" : "content"} attendance-admin-employees attendance-employee-profile`}>
      {!embedded && <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={onBack}><LuArrowLeft size={15} aria-hidden="true" /> Attendance employees</button>}
      {!embedded && <header className="attendance-profile-head">
        <div><p className="attendance-kicker">Attendance employee profile</p><h1 className="page-title">{employee.full_name}</h1><p className="page-sub">{employee.employee_code} · {employee.designation} · {employee.assigned_project ?? "No project assigned"}</p></div>
        <div className="attendance-profile-badges"><span className={`attendance-status attendance-status-${employee.status === "active" ? "present" : "incomplete"}`}>{employee.status}</span><span className="attendance-mode-badge">{overview.settings.attendanceMode === "gps" ? "GPS / Office" : "Remote"}</span></div>
      </header>}
      {error && <p className="attendance-action-error">{error}</p>}{message && <p className="attendance-action-success">{message}</p>}
      {gpsMissing && <div className="attendance-config-warning"><strong>Office GPS settings are incomplete.</strong><span>GPS employees cannot check in until office coordinates and radius are configured.</span><button className="btn-sm" onClick={onOpenSettings}>Open Settings</button></div>}

      <section className="admin-dashboard-card attendance-settings-card">
        <div className="admin-card-head"><div><h2>Attendance Settings</h2><p>Targets are entered in hours and stored as minutes.</p></div></div>
        <div className="attendance-settings-grid">
          <label><span className="field-label">Attendance mode</span><select className="field-input" value={mode} onChange={(event) => setMode(event.target.value as "gps" | "remote")}><option value="remote">Remote</option><option value="gps">GPS / Office</option></select></label>
          <label><span className="field-label">Weekly target (hours)</span><input className="field-input" type="number" min="0" max="168" step="0.25" value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} /></label>
          <label><span className="field-label">Monthly target (hours)</span><input className="field-input" type="number" min="0" max="744" step="0.25" value={monthlyHours} onChange={(event) => setMonthlyHours(event.target.value)} /></label>
          <button className="btn-primary attendance-settings-save" disabled={saving} onClick={saveSettings}>{saving ? "Saving…" : "Save settings"}</button>
        </div>
        <p className="attendance-settings-note">Changing mode affects future check-ins only. Changing targets affects progress interpretation only. Historical sessions and durations remain unchanged.</p>
      </section>

      <section className="admin-dashboard-card">
        <div className="attendance-profile-date-head"><div><h2>Selected Date Attendance</h2><p>{formatDate(date)} · Asia/Karachi</p></div><div><button className="btn-sm" onClick={() => setDate(moveDate(date, -1))}>‹</button><input className="field-input" type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /><button className="btn-sm" onClick={() => setDate(moveDate(date, 1))}>›</button>{date !== today && <button className="btn-ghost" onClick={() => setDate(today)}>Today</button>}</div></div>
        <div className="attendance-profile-day-summary"><span><small>Mode</small><strong>{overview.settings.attendanceMode === "gps" ? "GPS / Office" : "Remote"}</strong></span><span><small>Sessions</small><strong>{overview.selectedDay.sessions.length}</strong></span><span><small>Worked</small><strong>{duration(overview.selectedDay.totalWorkedSeconds + overview.selectedDay.currentSessionWorkedSeconds)}</strong></span><span><small>Breaks</small><strong>{duration(overview.selectedDay.totalCompletedBreakSeconds)}</strong></span></div>
        {overview.selectedDay.sessions.length > 0 ? <div className="attendance-session-list">{overview.selectedDay.sessions.map((session, index) => <SessionCard key={session.session.id} session={session} number={index + 1} />)}</div> : <p className="attendance-empty">No attendance sessions exist for this date.</p>}
        <p className="attendance-session-note">{overview.settings.attendanceMode === "remote" ? "Remote sessions remain separate; breaks stay inside their session." : "GPS / Office uses one daily session; breaks stay inside that session."}</p>
      </section>

      <section className="attendance-progress-grid"><ProgressCard title="This week" period={overview.summary.weekly} /><ProgressCard title="This month" period={overview.summary.monthly} /></section>

      <section className="admin-dashboard-card">
        <div className="attendance-calendar-head"><div><h2>Attendance Calendar</h2><p>Backend-derived status; weekends are not automatic holidays.</p></div><input className="field-input" type="month" value={calendarMonth} onChange={(event) => event.target.value && setCalendarMonth(event.target.value)} /></div>
        <div className="attendance-calendar-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        <div className="attendance-calendar-grid">{Array.from({ length: spacers }, (_, index) => <span className="attendance-calendar-spacer" key={index} />)}{calendar.days.map((day) => <button type="button" key={day.date} className={`attendance-calendar-day attendance-calendar-${day.status} ${day.date === date ? "attendance-calendar-today" : ""}`} onClick={() => setDate(day.date)}><span>{Number(day.date.slice(-2))}</span><i /><small>{STATUS_LABELS[day.status]}</small></button>)}</div>
      </section>

      <section className="admin-dashboard-card">
        <div className="admin-card-head"><div><h2>Attendance History</h2><p>Last 90 days through the selected date</p></div></div>
        {history.days.some((day) => day.sessions.length) ? <div className="attendance-history-list">{history.days.filter((day) => day.sessions.length).reverse().map((day) => <div className="attendance-history-day" key={day.workDate}><div className="attendance-history-date"><strong>{formatDate(day.workDate)}</strong><span>{duration(day.totalWorkedSeconds)} worked · {day.sessions.length} session{day.sessions.length === 1 ? "" : "s"}</span></div><div className="attendance-session-list">{day.sessions.map((session, index) => <SessionCard key={session.session.id} session={session} number={index + 1} />)}</div></div>)}</div> : <p className="attendance-empty">No attendance history exists in this range.</p>}
      </section>

      <section className="admin-dashboard-card">
        <div className="admin-card-head"><div><h2>Leave History</h2><p>Canonical Phase 6 leave records</p></div></div>
        {leave.length ? <div className="attendance-leave-history">{leave.map((request) => <article key={request.id}><div><strong>{request.leaveType === "full_day" ? "Full-day leave" : "Short-hour leave"}</strong><span className={`leave-status leave-status-${request.status}`}>{request.status}</span></div><p>{request.startDate}{request.endDate !== request.startDate ? ` → ${request.endDate}` : ""}{request.startTime ? ` · ${request.startTime.slice(0, 5)}–${request.endTime?.slice(0, 5)}` : ""}</p><small>{request.reason || "No reason provided"}{request.reviewerName ? ` · Reviewed by ${request.reviewerName}` : ""}</small></article>)}</div> : <p className="attendance-empty">No leave history exists for this employee.</p>}
      </section>

      {!embedded && <section className="admin-dashboard-card attendance-employee-information">
        <div className="admin-card-head"><div><h2>EMS Employee Information</h2><p>Read-only canonical HR data. Manage it from Main EMS → Employees.</p></div></div>
        <div className="attendance-info-grid">{[
          ["Employee code", employee.employee_code], ["Father's name", employee.father_name], ["Email", employee.email], ["Phone", employee.phone],
          ["Employment type", employee.employment_type], ["Joining date", String(employee.joining_date).slice(0, 10)], ["System access", employee.system_role === "admin" ? "Admin + Employee" : "Employee"], ["Project role", employee.assigned_role],
          ["CNIC", employee.cnic], ["Address", employee.address], ["Bank", `${employee.bank_name ?? "—"}${employee.bank_account ? ` · ${employee.bank_account}` : ""}`],
          ["Basic salary", employee.basic_salary ? `${employee.salary_currency} ${Number(employee.basic_salary).toLocaleString()}` : null], ["Allowances", employee.allowances ? `${employee.salary_currency} ${Number(employee.allowances).toLocaleString()}` : null], ["Deductions", employee.deductions ? `${employee.salary_currency} ${Number(employee.deductions).toLocaleString()}` : null], ["Net salary", (employee.basic_salary || employee.allowances || employee.deductions) ? `${employee.salary_currency} ${net.toLocaleString()}` : null],
        ].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value || "—"}</strong></div>)}</div>
      </section>}
    </div>
  );
}

export default function AdminAttendanceEmployees({
  onOpenSettings,
  onBack,
  initialDate,
  preset,
}: {
  onOpenSettings: () => void;
  onBack?: () => void;
  initialDate?: string;
  preset?: AttendanceDirectoryPreset | null;
}) {
  const today = karachiToday();
  const [date, setDate] = useState(initialDate ?? today);
  const [data, setData] = useState<AttendanceEmployeeDirectory | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"all" | "remote" | "gps">("all");
  const [employment, setEmployment] = useState<"all" | "active" | "resigned" | "terminated">(preset?.employment ?? "all");
  const [status, setStatus] = useState<"all" | AttendanceEmployeeLiveState>(preset?.status ?? "all");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await getAttendanceEmployees(date)); }
    catch (loadError) { setError(errorText(loadError)); }
    finally { setLoading(false); }
  }, [date]);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => (data?.employees ?? []).filter((employee) => {
    const query = search.trim().toLowerCase();
    return (!query || `${employee.employeeName} ${employee.employeeCode} ${employee.designation}`.toLowerCase().includes(query))
      && (mode === "all" || employee.attendanceMode === mode)
      && (employment === "all" || employee.employmentStatus === employment)
      && (status === "all" || employee.attendanceState === status);
  }), [data, employment, mode, search, status]);

  if (selectedId !== null) return <EmployeeAttendanceProfile employeeId={selectedId} onBack={() => { setSelectedId(null); load(); }} onOpenSettings={onOpenSettings} />;

  return (
    <main className="content attendance-admin-employees">
      <div className="admin-attendance-head"><div>{onBack && <button type="button" className="fin-btn-secondary fin-back-button portal-back-button" onClick={onBack}><LuArrowLeft size={15} aria-hidden="true" /> Dashboard</button>}<p className="attendance-kicker">Employee directory</p><h1 className="page-title">{preset?.title ?? "Attendance Employees"}</h1><p className="page-sub">{preset?.description ?? "Attendance-focused directory. HR management remains in Main EMS → Employees."}</p></div><div className="attendance-directory-date"><label className="field-label">Work date</label><input className="field-input" type="date" value={date} onChange={(event) => event.target.value && setDate(event.target.value)} /></div></div>
      {!data?.organizationGpsConfigured && <div className="attendance-config-warning"><strong>Office GPS settings are incomplete.</strong><span>GPS employees cannot check in until the organization location is configured.</span><button className="btn-sm" onClick={onOpenSettings}>Open Settings</button></div>}
      {error && <p className="attendance-action-error">{error}</p>}
      <section className="attendance-directory-filters"><input className="field-input" type="search" placeholder="Search employee name, code, or designation" value={search} onChange={(event) => setSearch(event.target.value)} /><select className="field-input" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="all">All modes</option><option value="remote">Remote</option><option value="gps">GPS / Office</option></select><select className="field-input" value={employment} onChange={(event) => setEmployment(event.target.value as typeof employment)}><option value="all">All employment statuses</option><option value="active">Active</option><option value="resigned">Resigned</option><option value="terminated">Terminated</option></select><select className="field-input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">All attendance states</option><option value="working">Working</option><option value="on_break">On break</option><option value="present">Present</option><option value="absent">Absent</option><option value="leave">Full-day leave</option><option value="short_leave">Short leave</option><option value="incomplete">Incomplete</option><option value="pending">Current / pending</option><option value="holiday">Holiday</option></select></section>
      {loading && !data ? <div className="admin-dashboard-loading">Loading attendance employees…</div> : visible.length ? <section className="attendance-directory-list"><div className="attendance-directory-header"><span>Employee</span><span>Mode</span><span>Attendance</span><span>Worked</span><span>Weekly progress</span><span /></div>{visible.map((employee) => <button type="button" className={`attendance-directory-row ${employee.employmentStatus !== "active" ? "attendance-directory-inactive" : ""}`} key={employee.employeeId} onClick={() => setSelectedId(employee.employeeId)}><span className="attendance-directory-person"><i>{employee.employeeName.charAt(0).toUpperCase()}</i><b>{employee.employeeName}<small>{employee.employeeCode} · {employee.designation}</small></b><em>{employee.employmentStatus}</em></span><span className="attendance-mode-badge">{employee.attendanceMode === "gps" ? "GPS / Office" : "Remote"}</span><span className={`attendance-status attendance-status-${employee.attendanceState}`}>{employee.attendanceStateLabel}</span><strong>{employee.employmentStatus === "active" ? duration(employee.selectedDateWorkedSeconds) : "Historical"}</strong><span className="attendance-directory-progress"><i><b style={{ width: `${Math.min(100, employee.weekly.target.progressPercent ?? 0)}%` }} /></i><small>{employee.weekly.target.targetConfigured ? `${employee.weekly.target.progressPercent}%` : "No target set"}</small></span><span className="attendance-directory-arrow">→</span></button>)}</section> : <div className="attendance-directory-empty"><strong>{data?.employees.length ? "No employees match these filters" : "No employees are available"}</strong><span>Adjust the filters or choose another date.</span></div>}
      {data && <p className="attendance-directory-count">Showing {visible.length} of {data.employees.length} employees · {formatDate(data.selectedDate)}</p>}
    </main>
  );
}
