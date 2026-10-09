import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import {
  downloadAttendanceReport,
  getAttendanceReport,
  getAttendanceReportOptions,
} from "../lib/attendanceReportsApi";
import type {
  AttendanceReportData,
  AttendanceReportEmployeeOption,
  AttendanceReportFilters,
  AttendanceReportStatus,
  ReportEmploymentStatus,
} from "../types/attendanceReports";
import type { AttendanceMode } from "../types/attendance";

function karachiToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function duration(seconds: number | null): string {
  if (seconds === null) return "Unverified";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function time(value: string | null): string {
  if (!value) return "Open / unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function message(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The attendance report could not be loaded.";
}

const STATUS_OPTIONS: Array<[AttendanceReportStatus, string]> = [
  ["present", "Present"], ["absent", "Absent"], ["leave", "Full-day leave"],
  ["short_leave", "Short leave"], ["holiday", "Holiday"], ["incomplete", "Incomplete"],
  ["pending", "Current / pending"], ["future", "Future / no data"],
];

export default function AttendanceReports() {
  const today = karachiToday();
  const [filters, setFilters] = useState<AttendanceReportFilters>({
    from: addDays(today, -29), to: today, employeeId: null,
    attendanceMode: null, attendanceStatus: null, employmentStatus: "active",
  });
  const [applied, setApplied] = useState<AttendanceReportFilters | null>(null);
  const [employees, setEmployees] = useState<AttendanceReportEmployeeOption[]>([]);
  const [report, setReport] = useState<AttendanceReportData | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    getAttendanceReportOptions()
      .then((result) => setEmployees(result.employees))
      .catch((loadError) => setError(message(loadError)))
      .finally(() => setLoadingOptions(false));
  }, []);

  async function load(nextFilters = filters, page = 1) {
    setLoading(true); setError(""); setSuccess("");
    try {
      const result = await getAttendanceReport(nextFilters, page, 25);
      setReport(result); setApplied(nextFilters);
    } catch (loadError) { setError(message(loadError)); }
    finally { setLoading(false); }
  }

  async function download() {
    if (!applied) return;
    setDownloading(true); setError(""); setSuccess("");
    try { setSuccess(`${await downloadAttendanceReport(applied)} downloaded successfully.`); }
    catch (downloadError) { setError(message(downloadError)); }
    finally { setDownloading(false); }
  }

  const update = <K extends keyof AttendanceReportFilters>(key: K, value: AttendanceReportFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const summary = report?.summary;

  return (
    <main className="content attendance-report-page">
      <div className="admin-attendance-head">
        <div><p className="attendance-kicker">Attendance reporting</p><h1 className="page-title">Attendance Reports</h1><p className="page-sub">Backend-authoritative employee-day reporting for Asia/Karachi.</p></div>
        <button className="btn-download" type="button" disabled={!applied || downloading || loading} onClick={download}>{downloading ? "Generating PDF…" : "Download PDF"}</button>
      </div>

      <section className="admin-dashboard-card attendance-report-filter-card">
        <div className="admin-card-head"><div><h2>Report filters</h2><p>Date ranges are limited to 366 days. Weekends remain normal work dates unless configured as holidays.</p></div></div>
        <div className="attendance-report-filters">
          <label><span className="field-label">Start date</span><input className="field-input" type="date" value={filters.from} onChange={(event) => update("from", event.target.value)} /></label>
          <label><span className="field-label">End date</span><input className="field-input" type="date" value={filters.to} onChange={(event) => update("to", event.target.value)} /></label>
          <label><span className="field-label">Employee</span><select className="field-input" disabled={loadingOptions} value={filters.employeeId ?? "all"} onChange={(event) => update("employeeId", event.target.value === "all" ? null : Number(event.target.value))}><option value="all">All employees</option>{employees.map((employee) => <option key={employee.employeeId} value={employee.employeeId}>{employee.employeeName} · {employee.employeeCode}{employee.employmentStatus === "active" ? "" : ` · ${employee.employmentStatus}`}</option>)}</select></label>
          <label><span className="field-label">Attendance mode</span><select className="field-input" value={filters.attendanceMode ?? "all"} onChange={(event) => update("attendanceMode", event.target.value === "all" ? null : event.target.value as AttendanceMode)}><option value="all">All modes</option><option value="gps">GPS / Office</option><option value="remote">Remote</option></select></label>
          <label><span className="field-label">Attendance status</span><select className="field-input" value={filters.attendanceStatus ?? "all"} onChange={(event) => update("attendanceStatus", event.target.value === "all" ? null : event.target.value as AttendanceReportStatus)}><option value="all">All statuses</option>{STATUS_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label><span className="field-label">Employment status</span><select className="field-input" value={filters.employmentStatus ?? "all"} onChange={(event) => update("employmentStatus", event.target.value === "all" ? null : event.target.value as ReportEmploymentStatus)}><option value="all">All employment statuses</option><option value="active">Active</option><option value="resigned">Resigned</option><option value="terminated">Terminated</option></select></label>
          <button className="btn-primary attendance-report-generate" type="button" disabled={loading || loadingOptions} onClick={() => load(filters, 1)}>{loading ? "Loading report…" : "Generate report"}</button>
        </div>
      </section>

      {error && <p className="attendance-action-error">{error}</p>}
      {success && <p className="attendance-action-success">{success}</p>}
      {!report && !loading && <div className="attendance-report-welcome"><strong>Choose filters and generate a report</strong><span>The preview and PDF will use the same server-calculated attendance result.</span></div>}
      {loading && !report && <div className="admin-dashboard-loading">Generating attendance preview…</div>}
      {report && summary && (
        <>
          <section className="attendance-report-summary" aria-label="Attendance report summary">
            {[
              ["Employees", summary.employeesIncluded], ["Employee-days", summary.employeeDays],
              ["Present", summary.presentEmployeeDays], ["Absent", summary.absentEmployeeDays],
              ["Leave", summary.leaveEmployeeDays], ["Incomplete", summary.incompleteEmployeeDays],
              ["Short Leave", summary.shortLeaveEmployeeDays], ["Holiday", summary.holidayEmployeeDays],
              ["Verified work", duration(summary.totalVerifiedWorkedSeconds)],
              ["Completed breaks", duration(summary.totalCompletedBreakSeconds)],
            ].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}
          </section>
          <section className="admin-dashboard-card attendance-report-preview">
            <div className="attendance-report-preview-head"><div><h2>Report preview</h2><p>{report.filters.from} to {report.filters.to} · Generated {new Date(report.generatedAtUtc).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}</p></div><span>{report.pagination.totalRows} row{report.pagination.totalRows === 1 ? "" : "s"}</span></div>
            {report.employeeSections.length === 0 ? <div className="attendance-directory-empty"><strong>No matching records</strong><span>Change the date range or filters and generate the report again.</span></div> : <div className="attendance-report-employees">{report.employeeSections.map((employee) => (
              <article className="attendance-report-employee" key={employee.employeeId}>
                <header><div><h3>{employee.employeeName}</h3><p>{employee.employeeCode} · {employee.designation}</p></div><span className="attendance-mode-badge">{employee.attendanceMode === "gps" ? "GPS / Office" : "Remote"}</span></header>
                <div className="table-scroll"><table className="table"><thead><tr><th>Date</th><th>Status</th><th>Sessions</th><th>Worked</th><th>Breaks</th></tr></thead><tbody>{employee.days.map((day) => <tr key={day.workDate}><td>{day.workDate}</td><td><span className={`attendance-status attendance-status-${day.attendanceStatus}`}>{day.attendanceStatusLabel}</span>{day.holidayName && <small className="report-day-note">{day.holidayName}</small>}{day.approvedLeave && <small className="report-day-note">{day.approvedLeave.leaveType === "short_hours" ? `Approved short leave: ${day.approvedLeave.startTime}–${day.approvedLeave.endTime}; worked time unchanged.` : "Approved full-day leave"}</small>}</td><td>{day.sessionCount}</td><td>{duration(day.verifiedWorkedSeconds)}</td><td>{duration(day.completedBreakSeconds)}</td></tr>)}</tbody></table></div>
                {employee.days.some((day) => day.sessions.length > 0) && <details className="attendance-report-employee-sessions"><summary>Session and break details</summary><div className="table-scroll"><table className="table"><thead><tr><th>Date</th><th>Session</th><th>State</th><th>Check In</th><th>Check Out</th><th>Worked</th><th>Breaks</th></tr></thead><tbody>{employee.days.flatMap((day) => day.sessions.map((session) => <tr key={session.id}><td>{day.workDate}</td><td>#{session.sessionNumber} · {session.attendanceMode === "gps" ? "GPS" : "Remote"}</td><td>{session.state}</td><td>{time(session.checkInAtUtc)}</td><td>{time(session.checkOutAtUtc)}</td><td>{duration(session.verifiedWorkedSeconds)}</td><td>{session.breaks.length === 0 ? "None" : session.breaks.map((item, index) => <small className="report-day-note" key={item.id}>Break #{index + 1}: {time(item.breakOutAtUtc)} – {time(item.breakInAtUtc)} · {item.state}{item.completedBreakSeconds === null ? "" : ` · ${duration(item.completedBreakSeconds)}`}</small>)}</td></tr>))}</tbody></table></div></details>}
                <footer><h4>Work Summary</h4><div className="attendance-report-work-summary">{[["Total Worked", duration(employee.summary.totalVerifiedWorkedSeconds)], ["Weekly Required Hours", employee.weeklyRequiredMinutes === null ? "Not configured" : duration(employee.weeklyRequiredMinutes * 60)], ["Monthly Required Hours", employee.monthlyRequiredMinutes === null ? "Not configured" : duration(employee.monthlyRequiredMinutes * 60)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><h4>Attendance Summary</h4><div className="attendance-report-status-counts">{[["Present", employee.summary.presentEmployeeDays], ["Absent", employee.summary.absentEmployeeDays], ["Leave", employee.summary.leaveEmployeeDays], ["Short Leave", employee.summary.shortLeaveEmployeeDays], ["Holiday", employee.summary.holidayEmployeeDays], ["Incomplete", employee.summary.incompleteEmployeeDays]].map(([label, count]) => <span key={label}>{label} <strong>{count}</strong></span>)}</div></footer>
              </article>
            ))}</div>}
            {report.pagination.totalPages > 1 && <div className="attendance-report-pagination"><button className="btn-sm" disabled={loading || report.pagination.page <= 1} onClick={() => applied && load(applied, report.pagination.page - 1)}>Previous</button><span>Page {report.pagination.page} of {report.pagination.totalPages}</span><button className="btn-sm" disabled={loading || report.pagination.page >= report.pagination.totalPages} onClick={() => applied && load(applied, report.pagination.page + 1)}>Next</button></div>}
          </section>
        </>
      )}
    </main>
  );
}

