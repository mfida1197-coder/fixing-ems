import { useCallback, useEffect, useState } from "react";
import LeaveRequestCard from "../components/LeaveRequestCard";
import { decideLeaveRequest, getManagedLeaveRequests } from "../lib/leaveApi";
import { ApiError } from "../lib/api";
import type { LeaveRequest, LeaveStatus, LeaveType } from "../types/leave";

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "LEAVE_REQUEST_ALREADY_DECIDED") return "This request was already decided. The list has been refreshed.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Leave requests could not be loaded.";
}

export default function LeaveManagement() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [status, setStatus] = useState<LeaveStatus | "all">("pending");
  const [leaveType, setLeaveType] = useState<LeaveType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const response = await getManagedLeaveRequests({ status, leaveType });
    setRequests(response.requests);
  }, [status, leaveType]);

  useEffect(() => {
    setLoading(true);
    load().catch((loadError: unknown) => setError(errorMessage(loadError))).finally(() => setLoading(false));
  }, [load]);

  async function decide(request: LeaveRequest, action: "approve" | "reject") {
    const verb = action === "approve" ? "approve" : "reject";
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${request.employeeName}'s ${request.leaveType === "full_day" ? "full-day" : "short-hour"} leave request?`)) return;
    setDeciding({ id: request.id, action });
    setError("");
    setSuccess("");
    try {
      await decideLeaveRequest(request.id, action);
      await load();
      setSuccess(`Leave request ${action === "approve" ? "approved" : "rejected"}.`);
    } catch (decisionError) {
      setError(errorMessage(decisionError));
      await load().catch(() => undefined);
    } finally {
      setDeciding(null);
    }
  }

  return (
    <main className="content leave-page leave-management-page">
      <div className="leave-page-head">
        <div>
          <h1 className="page-title">Leave Management</h1>
          <p className="page-sub">Review employee requests and make a final pending-to-approved or pending-to-rejected decision.</p>
        </div>
      </div>

      <section className="leave-admin-toolbar">
        <label>Status
          <select className="field-input" value={status} onChange={(event) => setStatus(event.target.value as LeaveStatus | "all")}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <label>Leave type
          <select className="field-input" value={leaveType} onChange={(event) => setLeaveType(event.target.value as LeaveType | "all")}>
            <option value="all">All types</option>
            <option value="full_day">Full day</option>
            <option value="short_hours">Short hours</option>
          </select>
        </label>
        <div className="leave-toolbar-count"><strong>{requests.length}</strong><span>matching requests</span></div>
      </section>

      {error && <p className="attendance-action-error leave-page-message">{error}</p>}
      {success && <p className="attendance-success leave-page-message">{success}</p>}

      <section className="leave-list-section">
        <div className="leave-section-heading">
          <p className="attendance-kicker">Employee requests</p>
          <h2>{status === "all" ? "All leave requests" : `${status[0].toUpperCase()}${status.slice(1)} requests`}</h2>
        </div>
        {loading ? <p className="attendance-loading">Loading leave requests…</p> : requests.length === 0 ? (
          <p className="leave-empty">No requests match these filters.</p>
        ) : (
          <div className="leave-request-list">
            {requests.map((request) => (
              <LeaveRequestCard
                key={request.id}
                request={request}
                showEmployee
                deciding={deciding?.id === request.id ? deciding.action : null}
                onDecision={decide}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
