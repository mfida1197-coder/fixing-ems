import type { LeaveRequest } from "../types/leave";

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function timeLabel(time: string | null): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function requestedLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Karachi",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function LeaveRequestCard({
  request,
  showEmployee = false,
  deciding = null,
  onDecision,
}: {
  request: LeaveRequest;
  showEmployee?: boolean;
  deciding?: "approve" | "reject" | null;
  onDecision?: (request: LeaveRequest, decision: "approve" | "reject") => void;
}) {
  const range = request.startDate === request.endDate
    ? dateLabel(request.startDate)
    : `${dateLabel(request.startDate)} – ${dateLabel(request.endDate)}`;

  return (
    <article className="leave-request-card">
      <div className="leave-request-card-head">
        <div>
          {showEmployee && (
            <p className="leave-employee-name">
              {request.employeeName}
              <span>{request.employeeCode} · {request.employeeDesignation}</span>
            </p>
          )}
          <div className="leave-request-title-line">
            <strong>{request.leaveType === "full_day" ? "Full-day leave" : "Short-hour leave"}</strong>
            <span className={`leave-status leave-status-${request.status}`}>{request.status}</span>
          </div>
        </div>
        <small>Requested {requestedLabel(request.createdAt)}</small>
      </div>

      <div className="leave-request-details">
        <div><span>Date</span><strong>{range}</strong></div>
        {request.leaveType === "short_hours" && (
          <div><span>Time</span><strong>{timeLabel(request.startTime)} – {timeLabel(request.endTime)}</strong></div>
        )}
        <div className="leave-reason"><span>Reason</span><strong>{request.reason || "No reason provided"}</strong></div>
      </div>

      {request.status !== "pending" && (
        <p className="leave-review-note">
          {request.status === "approved" ? "Approved" : "Rejected"}
          {request.reviewerName ? ` by ${request.reviewerName}` : ""}
          {request.reviewedAt ? ` · ${requestedLabel(request.reviewedAt)}` : ""}
        </p>
      )}

      {request.status === "pending" && onDecision && (
        <div className="leave-decision-actions">
          <button
            type="button"
            className="btn-primary leave-approve-btn"
            disabled={deciding !== null}
            onClick={() => onDecision(request, "approve")}
          >
            {deciding === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            className="btn-ghost leave-reject-btn"
            disabled={deciding !== null}
            onClick={() => onDecision(request, "reject")}
          >
            {deciding === "reject" ? "Rejecting…" : "Reject"}
          </button>
        </div>
      )}
    </article>
  );
}
