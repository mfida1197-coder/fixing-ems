import { useEffect, useState } from "react";
import { api } from "../lib/api";

type ResetStatus = "pending" | "approved" | "rejected";

type ResetRequest = {
  id: number;
  status: ResetStatus;
  requested_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  employee_id: number;
  employee_code: string;
  full_name: string;
  username_masked: string;
  reviewed_by_name: string | null;
};

export default function PasswordResetRequests({ onBack }: { onBack?: () => void }) {
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [status, setStatus] = useState<"all" | ResetStatus>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  async function load(nextStatus = status) {
    setLoading(true);
    try {
      const data = await api<{ requests: ResetRequest[] }>(`/api/password-resets?status=${nextStatus}`);
      setRequests(data.requests);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load password reset requests");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(status); }, [status]);

  async function approve(id: number) {
    if (!window.confirm("Approve this password reset request? The employee's current password will stop working immediately.")) return;
    setBusyId(id);
    try {
      await api(`/api/password-resets/${id}/approve`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to approve the request");
    } finally {
      setBusyId(null);
    }
  }

  async function reject() {
    if (!rejectingId) return;
    setBusyId(rejectingId);
    try {
      await api(`/api/password-resets/${rejectingId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectionReason.trim() || null }),
      });
      setRejectingId(null);
      setRejectionReason("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reject the request");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="content">
      {onBack && <button className="back-link" onClick={onBack}>← Back to employees</button>}
      <div className="content-head">
        <div>
          <h1 className="page-title">Password Reset Requests</h1>
          <p className="page-subtitle">Review employee-submitted password changes. Passwords and hashes are never displayed.</p>
        </div>
        <select
          className="field-input reset-status-filter"
          value={status}
          onChange={(event) => setStatus(event.target.value as "all" | ResetStatus)}
          aria-label="Filter password reset requests"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {error && <p className="error-text">{error}</p>}
      {rejectingId !== null && (
        <div className="form-card reset-reject-panel">
          <div className="form-title">Reject password reset request</div>
          <label className="field-label">Reason (optional)</label>
          <textarea
            className="field-input"
            rows={3}
            maxLength={300}
            value={rejectionReason}
            onChange={(event) => setRejectionReason(event.target.value)}
            placeholder="Reason visible to management history"
          />
          <div className="inline-actions">
            <button className="btn-sm btn-sm-danger" disabled={busyId !== null} onClick={reject}>Confirm rejection</button>
            <button className="btn-sm" onClick={() => { setRejectingId(null); setRejectionReason(""); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-scroll">
        <table className="table reset-request-table">
          <thead>
            <tr>
              <th>Employee</th><th>Employee ID</th><th>Username</th><th>Requested</th><th>Status</th><th>Review</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.id}>
                <td><strong>{request.full_name}</strong></td>
                <td>{request.employee_code}</td>
                <td className="mono-value">{request.username_masked}</td>
                <td>{new Date(request.requested_at).toLocaleString("en-PK")}</td>
                <td><span className={`leave-status leave-status-${request.status}`}>{request.status}</span></td>
                <td>
                  {request.reviewed_at
                    ? <>{request.reviewed_by_name || "Administrator"}<br /><small>{new Date(request.reviewed_at).toLocaleString("en-PK")}</small></>
                    : "—"}
                  {request.rejection_reason && <div className="field-help">{request.rejection_reason}</div>}
                </td>
                <td>
                  {request.status === "pending" ? (
                    <div className="inline-actions">
                      <button className="btn-sm" disabled={busyId !== null} onClick={() => approve(request.id)}>Approve</button>
                      <button className="btn-sm btn-sm-danger" disabled={busyId !== null} onClick={() => setRejectingId(request.id)}>Reject</button>
                    </div>
                  ) : "Finalized"}
                </td>
              </tr>
            ))}
            {!loading && requests.length === 0 && <tr><td colSpan={7}><div className="empty-note">No password reset requests found.</div></td></tr>}
            {loading && <tr><td colSpan={7}><div className="empty-note">Loading requests…</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
