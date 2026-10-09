import { useCallback, useEffect, useState } from "react";
import { downloadPdf } from "../lib/api";
import { decideApplication, getApplication, getApplications } from "../lib/applicationApi";
import type { ApplicationStatus, GeneralApplication } from "../lib/applicationApi";

export default function GeneralApplicationManagement() {
  const [items, setItems] = useState<GeneralApplication[]>([]);
  const [status, setStatus] = useState<ApplicationStatus | "all">("pending");
  const [selected, setSelected] = useState<GeneralApplication | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => setItems((await getApplications(status)).applications), [status]);
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load applications")); }, [load]);

  async function open(item: GeneralApplication) {
    try { setSelected((await getApplication(item.id)).application); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load application"); }
  }
  async function decide(action: "approve" | "reject") {
    if (!selected || !window.confirm(`${action === "approve" ? "Approve" : "Reject"} this application? This decision is final.`)) return;
    setBusy(true); setError("");
    try { await decideApplication(selected.id, action, null); setSelected(null); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to review application"); }
    finally { setBusy(false); }
  }

  return <section className="requests-panel">
    <div className="content-head"><div><h2>General Applications</h2><p className="page-sub">Review employee applications and issue a final decision.</p></div><select className="field-input request-status-filter" value={status} onChange={(event) => setStatus(event.target.value as ApplicationStatus | "all")}><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>
    {error && <p className="error-text">{error}</p>}
    {selected && <div className="form-card application-review"><div className="form-title">{selected.subject}</div><p><strong>{selected.employee_name_snapshot}</strong> · {selected.employee_code_snapshot} · {selected.designation_snapshot}</p><p>{selected.category} · {String(selected.application_date).slice(0, 10)}</p><div className="application-full-body">{selected.body_text}</div><div className="inline-actions"><button className="btn-download" onClick={() => downloadPdf(`/api/applications/${selected.id}/pdf`, `Application-${selected.id}.pdf`)}>Download PDF</button>{selected.status === "pending" && <><button className="btn-sm" disabled={busy} onClick={() => decide("approve")}>Approve</button><button className="btn-sm btn-sm-danger" disabled={busy} onClick={() => decide("reject")}>Reject</button></>}<button className="btn-sm" onClick={() => setSelected(null)}>Close</button></div></div>}
    <div className="application-management-list">{items.map((item) => {
      const employeeName = item.employee_name_snapshot || "Employee";
      return <article className="application-management-card" key={item.id}><div className="application-management-person"><span className="employee-avatar" aria-hidden="true">{employeeName.charAt(0).toUpperCase()}</span><div><strong>{employeeName}</strong><small>{item.employee_code_snapshot || "—"} · {item.designation_snapshot || "—"}</small></div></div><div className="application-management-subject"><small>{item.category} · {String(item.application_date).slice(0, 10)}</small><strong>{item.subject}</strong><span>Submitted {new Date(item.submitted_at).toLocaleString("en-PK")}</span></div><span className={`leave-status leave-status-${item.status}`}>{item.status}</span><button className="btn-sm" onClick={() => open(item)}>Review</button></article>;
    })}{!items.length && <div className="application-management-empty"><strong>No applications found</strong><span>Applications matching this status will appear here.</span></div>}</div>
  </section>;
}
