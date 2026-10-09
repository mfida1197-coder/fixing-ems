import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import LeaveRequestCard from "../components/LeaveRequestCard";
import { createMyLeaveRequest, getMyLeaveRequests } from "../lib/leaveApi";
import { ApiError } from "../lib/api";
import type { LeaveRequest, LeaveType } from "../types/leave";
import { LuClipboardList, LuClock, LuCircleCheck, LuCircleX } from "react-icons/lu";

const LEAVE_ERRORS: Record<string, string> = {
  INVALID_LEAVE_REQUEST: "Check the selected dates and times, then try again.",
  LEAVE_RANGE_TOO_LARGE: "A leave request cannot exceed 366 days.",
  LEAVE_REQUEST_CONFLICT: "This period overlaps an existing pending or approved leave request.",
  EMPLOYEE_MODE_REQUIRED: "Employee mode is required to request leave.",
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return (error.code && LEAVE_ERRORS[error.code]) || error.message;
  return error instanceof Error ? error.message : "Leave request could not be submitted.";
}

export default function Leave({ embedded = false, showRequestForm = true, onCloseRequestForm }: { embedded?: boolean; showRequestForm?: boolean; onCloseRequestForm?: () => void }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveType, setLeaveType] = useState<LeaveType>("full_day");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [shortDate, setShortDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const response = await getMyLeaveRequests();
    setRequests(response.requests);
  }, []);

  useEffect(() => {
    load().catch((loadError: unknown) => setError(messageFor(loadError))).finally(() => setLoading(false));
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const effectiveStart = leaveType === "full_day" ? startDate : shortDate;
    const effectiveEnd = leaveType === "full_day" ? endDate : shortDate;
    if (!effectiveStart || !effectiveEnd) return setError("Select the required leave date or range.");
    if (effectiveEnd < effectiveStart) return setError("End date must not be before start date.");
    if (leaveType === "short_hours" && (!startTime || !endTime || endTime <= startTime)) {
      return setError("Short-hour leave requires an end time after the start time.");
    }

    setSubmitting(true);
    try {
      await createMyLeaveRequest({
        leaveType,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        startTime: leaveType === "short_hours" ? startTime : null,
        endTime: leaveType === "short_hours" ? endTime : null,
        reason: reason.trim() || null,
      });
      await load();
      setStartDate("");
      setEndDate("");
      setShortDate("");
      setStartTime("");
      setEndTime("");
      setReason("");
      setSuccess("Leave request submitted for review.");
    } catch (submitError) {
      setError(messageFor(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  const content = (
    <div className={embedded ? "leave-page leave-page-embedded" : "leave-page"}>
      {!embedded && <div className="leave-page-head">
        <div>
          <h1 className="page-title">My Leave</h1>
          <p className="page-sub">Request full-day or short-hour leave and follow its review status.</p>
        </div>
        <div className="leave-counts" aria-label="Leave request counts">
          <span><strong>{requests.filter((request) => request.status === "pending").length}</strong> Pending</span>
          <span><strong>{requests.filter((request) => request.status === "approved").length}</strong> Approved</span>
        </div>
      </div>}

      {embedded && <div className="applications-summary-grid">
        {[{ label: "Total Requests", count: requests.length, icon: LuClipboardList, tone: "total" }, { label: "Pending", count: requests.filter((r) => r.status === "pending").length, icon: LuClock, tone: "pending" }, { label: "Approved", count: requests.filter((r) => r.status === "approved").length, icon: LuCircleCheck, tone: "approved" }, { label: "Rejected", count: requests.filter((r) => r.status === "rejected").length, icon: LuCircleX, tone: "rejected" }].map(({ label, count, icon: Icon, tone }) => <div className={`summary-card applications-summary-${tone}`} key={label}><Icon size={22} /><div><span>{label}</span><strong>{loading ? "—" : count}</strong></div></div>)}
      </div>}
      {!showRequestForm && error && <p className="error-text">{error}</p>}
      {!showRequestForm && success && <p className="attendance-success">{success}</p>}

      {showRequestForm && <section className="leave-form-card">
        <div className="leave-section-heading">
          <p className="attendance-kicker">Request leave</p>
          <h2>Send a request for administrator review</h2>
          <p>Approved short-hour leave is recorded separately and does not change actual worked time.</p>
        </div>

        <form className="leave-form" onSubmit={submit}>
          <div className="leave-type-picker" role="group" aria-label="Leave type">
            <button type="button" className={leaveType === "full_day" ? "active" : ""} onClick={() => setLeaveType("full_day")}>
              <strong>Full day</strong><span>One day or a date range</span>
            </button>
            <button type="button" className={leaveType === "short_hours" ? "active" : ""} onClick={() => setLeaveType("short_hours")}>
              <strong>Short hours</strong><span>A limited period on one day</span>
            </button>
          </div>

          {leaveType === "full_day" ? (
            <div className="leave-form-grid">
              <label>Start date<input className="field-input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
              <label>End date<input className="field-input" type="date" min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
            </div>
          ) : (
            <div className="leave-form-grid leave-form-grid-three">
              <label>Date<input className="field-input" type="date" value={shortDate} onChange={(event) => setShortDate(event.target.value)} required /></label>
              <label>Start time<input className="field-input" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required /></label>
              <label>End time<input className="field-input" type="time" min={startTime || undefined} value={endTime} onChange={(event) => setEndTime(event.target.value)} required /></label>
            </div>
          )}

          <label className="leave-reason-field">Reason <span>Optional</span>
            <textarea className="field-input" maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Share any useful context for the reviewer" />
          </label>
          {error && <p className="attendance-action-error">{error}</p>}
          {success && <p className="attendance-success">{success}</p>}
          <div className="leave-form-actions">
            <button className="btn-primary" type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit leave request"}</button>
            {onCloseRequestForm && <button className="btn-ghost" type="button" disabled={submitting} onClick={onCloseRequestForm}>Close</button>}
          </div>
        </form>
      </section>}

      <section className="leave-list-section">
        <div className="leave-section-heading">
          <p className="attendance-kicker">My requests</p>
          <h2>Leave request history</h2>
        </div>
        {loading ? <p className="attendance-loading">Loading leave requests…</p> : requests.length === 0 ? (
          <div className="leave-empty applications-empty"><LuClipboardList size={32} /><p>No leave requests have been submitted.</p></div>
        ) : (
          <div className="leave-request-list">{requests.map((request) => <LeaveRequestCard key={request.id} request={request} />)}</div>
        )}
      </section>
    </div>
  );
  return embedded ? content : <main className="content">{content}</main>;
}
