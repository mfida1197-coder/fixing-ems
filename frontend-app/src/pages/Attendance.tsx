import { useCallback, useEffect, useMemo, useState } from "react";
import { LuCalendarCheck, LuCircleCheck, LuClock, LuChartNoAxesColumn, LuCalendarDays, LuTrendingUp, LuHistory, LuLayers, LuLogIn, LuLogOut, LuCoffee } from "react-icons/lu";
import {
  getAttendanceCalendar,
  getAttendanceHistory,
  getAttendanceSummary,
  getCurrentAttendance,
  submitAttendanceAction,
  type AttendanceAction,
} from "../lib/attendanceApi";
import { ApiError } from "../lib/api";
import type {
  AttendanceCalendar,
  AttendanceCurrentState,
  AttendanceDayStatus,
  AttendanceHistory,
  AttendancePeriodSummary,
  AttendanceSessionCalculation,
  AttendanceSummary,
  GpsCoordinates,
} from "../types/attendance";

const ATTENDANCE_TIME_ZONE = "Asia/Karachi";
const STATUS_LABELS: Record<AttendanceDayStatus, string> = {
  future: "Future / no data",
  holiday: "Holiday",
  leave: "Full-day leave",
  short_leave: "Short leave",
  present: "Present",
  pending: "Current / pending",
  incomplete: "Incomplete",
  absent: "Absent",
};

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_CHECKED_IN: "You are already checked in.",
  ATTENDANCE_ALREADY_RECORDED_FOR_DATE: "Your GPS/office attendance is complete for today. Another check-in is not allowed.",
  NO_ACTIVE_SESSION: "There is no active attendance session.",
  ALREADY_ON_BREAK: "You are already on a break.",
  NOT_ON_BREAK: "You are not currently on a break.",
  ACTIVE_BREAK_MUST_END: "End your active break before checking out.",
  OUTSIDE_ALLOWED_GPS_RADIUS: "You are outside the allowed office attendance radius.",
  ATTENDANCE_GPS_NOT_CONFIGURED: "Office GPS attendance is not configured. Contact an administrator.",
  GPS_COORDINATES_REQUIRED: "Your location is required for this office attendance action.",
  INVALID_GPS_COORDINATES: "The location supplied by your browser is invalid. Please try again.",
  UNRESOLVED_PREVIOUS_SESSION: "A previous attendance session is still open and needs administrator review.",
  UNRESOLVED_INCOMPLETE_SESSION: "An incomplete attendance session needs administrator review before you can check in.",
  UNRESOLVED_INCOMPLETE_BREAK: "An incomplete break needs administrator review before another action can be recorded.",
  ATTENDANCE_SETTINGS_MISSING: "Your attendance settings are missing. Contact an administrator.",
};

function karachiDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATTENDANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthRange(monthKey: string): { from: string; to: string } {
  const [year, month] = monthKey.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, "0")}` };
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatDate(dateKey: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...options,
  }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

function formatEventTime(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ATTENDANCE_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "In progress";
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatLiveDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return [hours, minutes, remaining].map((part) => String(part).padStart(2, "0")).join(":");
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    return (error.code && ERROR_MESSAGES[error.code]) || error.message;
  }
  return error instanceof Error ? error.message : "Attendance action failed. Please try again.";
}

function requestCoordinates(): Promise<GpsCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser does not support location services."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
      }),
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("Location permission was denied. Allow location access and try again."));
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new Error("Your location is currently unavailable. Check location services and try again."));
        } else if (error.code === error.TIMEOUT) {
          reject(new Error("Location request timed out. Move to an open area and try again."));
        } else {
          reject(new Error("Your location could not be retrieved."));
        }
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  });
}

function StatusBadge({ status }: { status: AttendanceDayStatus | "working" | "on_break" | "not_checked_in" | "completed" }) {
  const label = status === "working"
    ? "Working"
    : status === "on_break"
      ? "On break"
      : status === "not_checked_in"
        ? "Not checked in"
        : status === "completed"
          ? "Completed"
          : STATUS_LABELS[status];
  return <span className={`attendance-status attendance-status-${status}`}>{label}</span>;
}

function ProgressCard({ title, period }: { title: string; period: AttendancePeriodSummary }) {
  const progress = period.target.progressPercent;
  const ratio = progress === null ? 0 : Math.max(0, Math.min(100, progress)) / 100;
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const percent = progress === null ? null : Math.round(progress);
  const progressTone = percent === null || percent < 50 ? "danger" : percent < 100 ? "warning" : "success";
  return (
    <section className={`attendance-progress-card attendance-progress-ring-card progress-tone-${progressTone}`}>
      <div className="attendance-progress-ring-wrap" aria-label={percent === null ? `${title}: no target set` : `${title}: ${percent}%`}>
        <svg viewBox="0 0 140 140" role="img" aria-hidden="true">
          <circle className="attendance-progress-ring-track" cx="70" cy="70" r={radius} />
          <circle
            className="attendance-progress-ring-value"
            cx="70"
            cy="70"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - ratio)}
          />
        </svg>
        <strong>{percent === null ? "—" : `${percent}%`}</strong>
      </div>
      <div className="attendance-progress-ring-copy">
        <p className="attendance-kicker">{title}</p>
        <strong>{formatDuration(period.workedSeconds)} <span>/ {period.target.targetConfigured ? formatDuration(period.target.targetMinutes * 60) : "No target"}</span></strong>
        <small>{formatDate(period.from, { month: "short", day: "numeric", year: undefined })} – {formatDate(period.to, { month: "short", day: "numeric", year: undefined })}</small>
      </div>
    </section>
  );
}

function SessionCard({
  calculation,
  index,
  compact = false,
  dashboard = false,
}: {
  calculation: AttendanceSessionCalculation;
  index: number;
  compact?: boolean;
  dashboard?: boolean;
}) {
  const { session } = calculation;
  return (
    <article className={`attendance-session ${session.state === "open" ? "attendance-session-active" : ""}`}>
      <div className="attendance-session-head">
        <div>
          <span className="attendance-session-dot" />
          <strong>{compact ? "Daily session" : `Session #${index + 1}`}</strong>
        </div>
        <span className={`attendance-record-state attendance-record-${session.state}`}>{session.state}</span>
      </div>
      <div className="attendance-session-times">
        <span><small>{dashboard && <LuLogIn size={13} />} Check in</small>{formatEventTime(session.checkInAtUtc)}</span>
        <span className="attendance-time-arrow">→</span>
        <span><small>{dashboard && <LuLogOut size={13} />} Check out</small>{session.checkOutAtUtc ? formatEventTime(session.checkOutAtUtc) : "Active"}</span>
        <span><small>{dashboard && <LuClock size={13} />} Worked</small>{formatDuration(calculation.workedSeconds)}</span>
        <span><small>{dashboard && <LuCoffee size={13} />} Breaks</small>{session.breaks.length} · {formatDuration(calculation.completedBreakSeconds)}</span>
      </div>
      {session.breaks.length > 0 && (
        <div className="attendance-break-list">
          {session.breaks.map((attendanceBreak, breakIndex) => (
            <div className="attendance-break-row" key={attendanceBreak.id}>
              <span>Break #{breakIndex + 1}</span>
              <span>{formatEventTime(attendanceBreak.breakOutAtUtc)} → {attendanceBreak.breakInAtUtc ? formatEventTime(attendanceBreak.breakInAtUtc) : "Active"}</span>
              <span className={`attendance-record-state attendance-record-${attendanceBreak.state}`}>{attendanceBreak.state}</span>
            </div>
          ))}
        </div>
      )}
      {(session.incompleteReason || calculation.hasIncompleteBreak) && (
        <p className="attendance-inline-warning">
          Action required: {session.incompleteReason || "This session contains an incomplete break."}
        </p>
      )}
    </article>
  );
}

export function AttendanceOverview() {
  const [data, setData] = useState<AttendanceCurrentState | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [history, setHistory] = useState<AttendanceHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const today = karachiDateKey();
    Promise.all([getCurrentAttendance(), getAttendanceSummary(today), getAttendanceHistory(addDays(today, -89), today)])
      .then(([current, period, records]) => { setData(current); setSummary(period); setHistory(records); })
      .catch(() => setError("Could not load attendance summary."));
  }, []);
  const sessions = data?.today.sessions ?? [];
  const days = history?.days.filter((day) => day.sessions.length > 0) ?? [];
  const totalSeconds = days.reduce((total, day) => total + day.totalWorkedSeconds, 0);
  return <section className="attendance-section-card employee-attendance-overview">
    <h2><LuCalendarCheck size={21} /> Attendance</h2>
    {error ? <p className="error-text">{error}</p> : !data ? <p>Loading attendance…</p> : <>
      <p className="page-sub">Attendance statistics · last 90 days</p>
      <div className="employee-attendance-summary employee-attendance-statistics">
        <div className="employee-stat-accent"><i><LuCalendarCheck size={19} /></i><span>Days Logged</span><strong>{days.length}</strong></div>
        <div className="employee-stat-success"><i><LuCircleCheck size={19} /></i><span>Completed</span><strong>{days.filter((day) => day.completedSessionCount > 0 && !day.hasIncompleteState && day.openSessionCount === 0).length}</strong></div>
        <div className="employee-stat-info"><i><LuClock size={19} /></i><span>Total Hours</span><strong>{formatDuration(totalSeconds)}</strong></div>
        <div className="employee-stat-info"><i><LuChartNoAxesColumn size={19} /></i><span>Avg / Day</span><strong>{formatDuration(days.length ? totalSeconds / days.length : 0)}</strong></div>
        <div className="employee-stat-accent"><i><LuCalendarDays size={19} /></i><span>This Week</span><strong>{formatDuration(summary?.weekly.workedSeconds ?? 0)}</strong></div>
        <div className="employee-stat-info"><i><LuCalendarDays size={19} /></i><span>This Month</span><strong>{formatDuration(summary?.monthly.workedSeconds ?? 0)}</strong></div>
      </div>
      {summary && <><h3><LuTrendingUp size={18} /> Work Progress</h3><div className="attendance-progress-grid"><div className="employee-week-progress"><LuCalendarDays className="employee-progress-icon" size={18} /><ProgressCard title="This Week" period={summary.weekly} /></div><div className="employee-month-progress"><LuCalendarDays className="employee-progress-icon" size={18} /><ProgressCard title="This Month" period={summary.monthly} /></div></div></>}
      <h3><LuHistory size={18} /> Recent Activity</h3>
      {days.length === 0 ? <p className="attendance-empty">No attendance activity recorded.</p> : <div className="employee-attendance-activity">{days.slice().reverse().map((day) => <div key={day.workDate} className="attendance-session"><strong>{formatDate(day.workDate)}</strong>{day.sessions.map((item) => <div className={`employee-attendance-activity-row ${item.session.state === "completed" ? "activity-completed" : "activity-progress"}`} key={item.session.id}><span><LuLogIn size={14} /> Check In: {formatEventTime(item.session.checkInAtUtc)}</span><span><LuLogOut size={14} /> Check Out: {item.session.checkOutAtUtc ? formatEventTime(item.session.checkOutAtUtc) : "In progress"}</span><span><LuClock size={14} /> Worked: {formatDuration(item.workedSeconds)}</span></div>)}</div>)}</div>}
      <div className="attendance-section-head"><h3><LuLayers size={18} /> {data.attendanceMode === "gps" ? "Today's session" : "Independent work sessions"}</h3></div>
      {sessions.length === 0 ? <p className="attendance-empty">No attendance session has been recorded today.</p> : <div className="attendance-session-list">{sessions.map((session, index) => <SessionCard dashboard key={session.session.id} calculation={session} index={index} compact={data.attendanceMode === "gps"} />)}</div>}
    </>}
  </section>;
}

export default function Attendance({ focused = true }: { focused?: boolean }) {
  const today = karachiDateKey();
  const [current, setCurrent] = useState<AttendanceCurrentState | null>(null);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [history, setHistory] = useState<AttendanceHistory | null>(null);
  const [calendar, setCalendar] = useState<AttendanceCalendar | null>(null);
  const [todayCalendarStatus, setTodayCalendarStatus] = useState<AttendanceDayStatus | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<AttendanceAction | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [snapshotAt, setSnapshotAt] = useState(() => Date.now());

  const loadCore = useCallback(async () => {
    const currentDate = karachiDateKey();
    const [nextCurrent, nextSummary, nextHistory] = await Promise.all([
      getCurrentAttendance(),
      focused ? Promise.resolve(null) : getAttendanceSummary(currentDate),
      focused ? Promise.resolve(null) : getAttendanceHistory(addDays(currentDate, -89), currentDate),
    ]);
    setCurrent(nextCurrent);
    setSummary(nextSummary);
    setHistory(nextHistory);
    setSnapshotAt(Date.now());
  }, [focused]);

  const loadCalendar = useCallback(async (monthKey: string) => {
    setCalendarLoading(true);
    try {
      const range = monthRange(monthKey);
      const nextCalendar = await getAttendanceCalendar(range.from, range.to);
      setCalendar(nextCalendar);
      const currentDate = karachiDateKey();
      const currentDay = nextCalendar.days.find((day) => day.date === currentDate);
      if (currentDay) setTodayCalendarStatus(currentDay.status);
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCore()
      .catch((loadError: unknown) => setError(friendlyError(loadError)))
      .finally(() => setLoading(false));
  }, [loadCore]);

  useEffect(() => {
    if (focused) return;
    loadCalendar(calendarMonth)
      .catch((loadError: unknown) => setError(friendlyError(loadError)));
  }, [loadCalendar, calendarMonth, focused]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const state = useMemo(() => {
    if (!current) return "not_checked_in" as const;
    if (current.unresolvedPreviousSession || current.today.hasIncompleteState) return "incomplete" as const;
    if (current.currentSession?.hasOpenBreak) return "on_break" as const;
    if (current.currentSession) return "working" as const;
    if (current.today.completedSessionCount > 0) return "completed" as const;
    return "not_checked_in" as const;
  }, [current]);

  const liveSeconds = useMemo(() => {
    const base = current?.currentSession?.workedSeconds ?? 0;
    if (state !== "working") return base;
    return base + Math.max(0, Math.floor((now.getTime() - snapshotAt) / 1000));
  }, [current, now, snapshotAt, state]);

  const completedHistory = useMemo(
    () => history?.days.filter((day) => day.sessions.length > 0 || day.hasIncompleteState).reverse() ?? [],
    [history],
  );

  async function performAction(action: AttendanceAction) {
    if (!current || busyAction) return;
    setBusyAction(action);
    setError("");
    setSuccess("");
    setLocationStatus("");
    try {
      let coordinates: GpsCoordinates | undefined;
      if (current.attendanceMode === "gps") {
        setLocationStatus("Requesting your location…");
        coordinates = await requestCoordinates();
        setLocationStatus("Verifying your location with the attendance server…");
      }
      await submitAttendanceAction(action, coordinates);
      await Promise.all([loadCore(), ...(focused ? [] : [loadCalendar(calendarMonth)])]);
      setSuccess(
        action === "check-in"
          ? "Check-in recorded."
          : action === "check-out"
            ? "Check-out recorded."
            : action === "break-out"
              ? "Break started."
              : "Break ended. Welcome back.",
      );
    } catch (actionError) {
      setError(friendlyError(actionError));
    } finally {
      setBusyAction(null);
      setLocationStatus("");
    }
  }

  if (loading && !current) {
    return <main className="content attendance-page"><p className="attendance-loading">Loading attendance…</p></main>;
  }

  if (!current || (!focused && !summary)) {
    return <main className="content attendance-page"><p className="error-text">{error || "Attendance could not be loaded."}</p></main>;
  }

  const isGps = current.attendanceMode === "gps";
  const gpsDayComplete = isGps && current.today.completedSessionCount > 0 && !current.currentSession;
  const isIncomplete = state === "incomplete";
  const canStart = !current.currentSession && !gpsDayComplete && !isIncomplete;
  const latestSession = current.currentSession ?? current.today.sessions[current.today.sessions.length - 1];
  const currentCalendarStatus: AttendanceDayStatus = current.today.hasIncompleteState
    ? "incomplete"
    : current.today.completedSessionCount > 0
      ? "present"
      : todayCalendarStatus ?? "pending";

  return (
    <main className={`content attendance-page ${focused ? "employee-live-attendance" : ""}`}>
      <div className="attendance-page-head">
        <div>
          <div className="attendance-title-line">
            <h1 className="page-title">My Attendance</h1>
            <span className={`attendance-mode-pill attendance-mode-${current.attendanceMode}`}>
              {isGps ? "GPS / Office" : "Remote"}
            </span>
          </div>
          <p className="page-sub">Check in, manage today's sessions and view hours logged.</p>
        </div>
        {!focused && <StatusBadge status={state} />}
      </div>

      <section className="attendance-current-card">
        <div className="attendance-clock-block">
          <p><LuCalendarDays size={16} />{new Intl.DateTimeFormat("en-US", {
            timeZone: ATTENDANCE_TIME_ZONE,
            weekday: "long",
            month: "long",
            day: "numeric",
          }).format(now)}</p>
          <time>{new Intl.DateTimeFormat("en-US", {
            timeZone: ATTENDANCE_TIME_ZONE,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }).format(now)}</time>
          <small><LuClock size={13} /> Asia/Karachi</small>
        </div>

        <div className="attendance-control-block">
          <div className={`attendance-state-copy attendance-state-${state}`}>
            {focused ? <><StatusBadge status={state} />{state === "on_break" && <p>Break In before checking out.</p>}{gpsDayComplete && <p>Attendance complete for today.</p>}</> : <>
            <p className="attendance-kicker">Current attendance state</p>
            <h2>{state === "working" ? "You are working" : state === "on_break" ? "You are on a break" : state === "completed" ? (isGps ? "Attendance complete for today" : "Session completed") : state === "incomplete" ? "Action required" : "Ready to check in"}</h2>
            <p>
              {state === "working"
                ? `Current session started at ${formatEventTime(current.currentSession?.session.checkInAtUtc ?? null)}.`
                : state === "on_break"
                  ? "Resume the same session with Break In before checking out."
                  : gpsDayComplete
                    ? "GPS/office attendance allows one session per work date."
                    : isIncomplete
                      ? "Attendance history is preserved. Contact an administrator for review."
                      : isGps
                        ? "Location will be requested when you perform an attendance action."
                        : current.today.completedSessionCount > 0
                          ? "Start another independent remote work session when ready."
                          : "Start your first work session for today."}
            </p>
            </>}
          </div>

          {current.currentSession && (state === "working" || state === "on_break") && (
            <div className="attendance-live-timer">
              <span>{state === "on_break" ? "Working time paused" : "Live working time"}</span>
              <strong>{formatLiveDuration(liveSeconds)}</strong>
              {!focused && <small>Display only · refreshed from server state</small>}
            </div>
          )}

          <div className="attendance-actions">
            {canStart && (
              <button className="btn-primary attendance-main-action" onClick={() => performAction("check-in")} disabled={busyAction !== null}>
                <LuLogIn size={17} />
                {busyAction === "check-in" ? "Checking in…" : (!isGps && current.today.completedSessionCount > 0 ? "Check In Again" : "Check In")}
              </button>
            )}
            {state === "working" && (
              <>
                <button className="btn-download attendance-break-action" onClick={() => performAction("break-out")} disabled={busyAction !== null}>
                  <LuCoffee size={17} />
                  {busyAction === "break-out" ? "Starting break…" : "Break Out"}
                </button>
                <button className="btn-ghost attendance-checkout-action" onClick={() => performAction("check-out")} disabled={busyAction !== null}>
                  <LuLogOut size={17} />
                  {busyAction === "check-out" ? "Checking out…" : "Check Out"}
                </button>
              </>
            )}
            {state === "on_break" && (
              <button className="btn-primary attendance-main-action" onClick={() => performAction("break-in")} disabled={busyAction !== null}>
                <LuCircleCheck size={17} />
                {busyAction === "break-in" ? "Resuming…" : "Break In · Resume Work"}
              </button>
            )}
          </div>

          {locationStatus && <p className="attendance-location-status">⌖ {locationStatus}</p>}
          {!focused && success && <p className="attendance-success">{success}</p>}
          {error && <p className="attendance-action-error">{error}</p>}
          {focused && <div className="employee-attendance-summary">
            <div><span><LuLogIn size={15} /> Check In</span><strong>{formatEventTime(latestSession?.session.checkInAtUtc ?? null)}</strong></div>
            <div><span><LuLogOut size={15} /> Check Out</span><strong>{latestSession ? latestSession.session.checkOutAtUtc ? formatEventTime(latestSession.session.checkOutAtUtc) : "In progress" : "—"}</strong></div>
            <div><span><LuClock size={15} /> Hours Logged</span><strong>{formatDuration(current.today.totalWorkedSeconds + (state === "working" || state === "on_break" ? liveSeconds : 0))}</strong></div>
            <div><span><LuCoffee size={15} /> Breaks</span><strong>{current.today.sessions.reduce((count, item) => count + item.session.breaks.length, 0)} breaks</strong></div>
          </div>}
        </div>
      </section>

      {(current.unresolvedPreviousSession || current.today.hasIncompleteState) && (
        <div className="attendance-warning-panel">
          <strong>Incomplete attendance requires review</strong>
          <span>No history was changed or removed. Attendance actions remain blocked until the record is resolved.</span>
        </div>
      )}

      {!focused && <section className="attendance-section-card">
        <div className="attendance-section-head">
          <div>
            <p className="attendance-kicker">{isGps ? "Today's attendance" : "Today's sessions"}</p>
            <h2>{isGps ? "Single daily session" : "Independent remote work sessions"}</h2>
          </div>
          <div className="attendance-day-total">
            <span>{formatDuration(current.today.totalWorkedSeconds)}</span>
            <small>{isGps ? "completed work" : `across ${current.today.sessions.length} session${current.today.sessions.length === 1 ? "" : "s"}`}</small>
          </div>
        </div>

        <div className="attendance-mini-stats">
          <div><span>Completed work</span><strong>{formatDuration(current.today.totalWorkedSeconds)}</strong></div>
          <div><span>Completed breaks</span><strong>{formatDuration(current.today.totalCompletedBreakSeconds)}</strong></div>
          <div><span>Sessions</span><strong>{current.today.sessions.length}</strong></div>
          {!focused && <div><span>Calendar status</span><strong>{STATUS_LABELS[currentCalendarStatus]}</strong></div>}
        </div>

        {current.today.sessions.length === 0 ? (
          <p className="attendance-empty">No attendance session has been recorded today.</p>
        ) : (
          <div className="attendance-session-list">
            {current.today.sessions.map((session, index) => (
              <SessionCard key={session.session.id} calculation={session} index={index} compact={isGps} />
            ))}
          </div>
        )}
        {!isGps && current.today.sessions.length > 0 && (
          <p className="attendance-session-note">Each Check In Again starts a new session; previous sessions stay separate.</p>
        )}
      </section>}

      {!focused && summary && <>
      <div className="attendance-progress-grid">
        <ProgressCard title="Weekly progress" period={summary.weekly} />
        <ProgressCard title="Monthly progress" period={summary.monthly} />
      </div>

      <section className="attendance-section-card">
        <div className="attendance-calendar-head">
          <div>
            <p className="attendance-kicker">Attendance calendar</p>
            <h2>{formatDate(`${calendarMonth}-01`, { month: "long", year: "numeric", day: undefined })}</h2>
          </div>
          <div className="attendance-calendar-actions">
            <button className="btn-sm" onClick={() => setCalendarMonth((value) => shiftMonth(value, -1))} aria-label="Previous month">←</button>
            <button className="btn-sm" onClick={() => setCalendarMonth(today.slice(0, 7))}>Today</button>
            <button className="btn-sm" onClick={() => setCalendarMonth((value) => shiftMonth(value, 1))} aria-label="Next month">→</button>
          </div>
        </div>
        {calendarLoading ? (
          <p className="attendance-loading">Loading calendar…</p>
        ) : calendar && (
          <>
            <div className="attendance-calendar-weekdays" aria-hidden="true">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="attendance-calendar-grid">
              {Array.from({ length: (new Date(`${calendar.from}T00:00:00.000Z`).getUTCDay() + 6) % 7 }, (_, index) => (
                <span className="attendance-calendar-spacer" key={`spacer-${index}`} />
              ))}
              {calendar.days.map((day) => (
                <div
                  className={`attendance-calendar-day attendance-calendar-${day.status} ${day.date === today ? "attendance-calendar-today" : ""}`}
                  key={day.date}
                  title={day.holiday?.name || STATUS_LABELS[day.status]}
                >
                  <span>{Number(day.date.slice(-2))}</span>
                  <i aria-hidden="true" />
                  <small>{STATUS_LABELS[day.status]}</small>
                </div>
              ))}
            </div>
            <div className="attendance-legend">
              {(Object.keys(STATUS_LABELS) as AttendanceDayStatus[]).map((status) => (
                <span key={status}><i className={`attendance-legend-${status}`} />{STATUS_LABELS[status]}</span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="attendance-section-card">
        <div className="attendance-section-head">
          <div>
            <p className="attendance-kicker">Attendance history</p>
            <h2>Last 90 days</h2>
          </div>
        </div>
        {completedHistory.length === 0 ? (
          <p className="attendance-empty">No attendance sessions are available for this period.</p>
        ) : (
          <div className="attendance-history-list">
            {completedHistory.map((day) => (
              <div className="attendance-history-day" key={day.workDate}>
                <div className="attendance-history-date">
                  <strong>{formatDate(day.workDate, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</strong>
                  <span>{formatDuration(day.totalWorkedSeconds)} completed work · {formatDuration(day.totalCompletedBreakSeconds)} breaks</span>
                </div>
                {day.sessions.map((session, index) => (
                  <SessionCard key={session.session.id} calculation={session} index={index} compact={isGps} />
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      </>}
    </main>
  );
}
