import { useEffect, useState } from "react";
import { LuArrowLeft, LuPlus } from "react-icons/lu";
import { api, downloadFile, downloadPdf, openAuthenticatedFile, superPasswordHeaders, hasSuperAuthorization } from "../lib/api";

type ProjectRow = {
  id: number; name: string; status: string; start_date: string | null; end_date: string | null;
  handover_date: string | null; project_value: number | null; value_currency: string;
  sales_tax_percent: number | null; tax_amount: number; total_payable: number; total_paid: number; remaining_balance: number;
  expected_handover_date: string | null; current_progress: number; latest_update: string | null;
  client_id: number; client_name: string; team_size: number;
};
type ClientOpt = { id: number; company_name: string };
type EmployeeOpt = { id: number; full_name: string };
type TeamMember = { assignment_id: number; employee_id: number; full_name: string; designation: string; role_on_project: string | null };
type ProgressUpdate = { id: number; progress_percent: number; report: string; created_at: string; created_by_name: string };
type ProjectRequirement = { id: number; attachment_name: string | null; client_name: string; current_version: number; current: { content: string; created_at: string }; versions: { version_number: number; content: string; created_at: string }[] };
type ProjectTransaction = { id: number; txn_date: string; invoice_number: string | null; category: string; custom_category: string | null; description: string | null; amount: number; currency: string; invoice_path: string | null; attachment_name: string | null };

const emptyForm = { client_id: "", name: "", description: "", status: "upcoming", start_date: "", expected_handover_date: "", project_value: "", sales_tax_percent: "5", value_currency: "USD" };
const STATUSES = ["upcoming", "ongoing", "done", "handed_over"];
const CURRENCIES = ["USD", "PKR", "AED", "EUR", "GBP", "SAR"];

export default function Projects({ canAccessFinance }: { canAccessFinance: boolean }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<ProjectRow | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [progressPercent, setProgressPercent] = useState("0");
  const [progressReport, setProgressReport] = useState("");
  const [requirements, setRequirements] = useState<ProjectRequirement[]>([]);
  const [transactions, setTransactions] = useState<ProjectTransaction[]>([]);
  const [assignId, setAssignId] = useState("");
  const [assignRole, setAssignRole] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [edit, setEdit] = useState({ name: "", client_id: "", start_date: "", end_date: "", expected_handover_date: "", project_value: "", sales_tax_percent: "", value_currency: "USD" });
  const [taxChanged, setTaxChanged] = useState(false);
  const [applyTax, setApplyTax] = useState(false);
  const [editApplyTax, setEditApplyTax] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateAction, setGateAction] = useState<"edit" | "delete" | "status" | null>(null);
  const [pendingStatus, setPendingStatus] = useState("");
  const [revealPass, setRevealPass] = useState("");
  const [gating, setGating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ongoing" | "upcoming" | "completed">("all");

  function formatHandoverDate(dateStr: string | null) {
    if (!dateStr) return "—";
    try {
      const raw = String(dateStr).slice(0, 10);
      const [y, m, d] = raw.split("-").map(Number);
      if (y && m && d) {
        const date = new Date(y, m - 1, d);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? raw : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return String(dateStr).slice(0, 10);
    }
  }


  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  async function load() {
    const [p, c, e] = await Promise.all([
      api<{ projects: ProjectRow[] }>("/api/projects"),
      api<{ clients: ClientOpt[] }>("/api/clients"),
      api<{ employees: EmployeeOpt[] }>("/api/employees"),
    ]);
    setProjects(p.projects);
    setClients(c.clients);
    setEmployees(e.employees);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function openProject(p: ProjectRow) {
    const [d, finance] = await Promise.all([
      api<{ project: ProjectRow; team: TeamMember[]; progress_updates: ProgressUpdate[]; requirements: ProjectRequirement[] }>(`/api/projects/${p.id}`),
      canAccessFinance ? api<{ transactions: ProjectTransaction[] }>(`/api/finance/transactions?project_id=${p.id}`) : Promise.resolve({ transactions: [] }),
    ]);
    setSelected({ ...p, ...d.project });
    setTeam(d.team);
    setProgressUpdates(d.progress_updates);
    setRequirements(d.requirements);
    setTransactions(finance.transactions);
    setProgressPercent(String(d.progress_updates[0]?.progress_percent ?? 0));
    setEditMode(false);
    setRevealPass("");
    setEdit({
      name: p.name, client_id: String(p.client_id),
      start_date: p.start_date ? String(p.start_date).slice(0, 10) : "",
      end_date: d.project.end_date ? String(d.project.end_date).slice(0, 10) : "",
      expected_handover_date: d.project.expected_handover_date ? String(d.project.expected_handover_date).slice(0, 10) : "",
      project_value: p.project_value ? String(p.project_value) : "",
      sales_tax_percent: d.project.sales_tax_percent == null ? "5" : String(d.project.sales_tax_percent),
      value_currency: p.value_currency,
    });
    setTaxChanged(false);
    setEditApplyTax(d.project.sales_tax_percent != null);
  }

  function set(key: keyof typeof emptyForm, value: string) { setForm((f) => ({ ...f, [key]: value })); }
  function setEd(key: keyof typeof edit, value: string) { setEdit((f) => ({ ...f, [key]: value })); }

  async function openGate(action: "edit" | "delete" | "status", status?: string) {
    setError("");
    if (await hasSuperAuthorization()) { try { await executeAction(action, status, ""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); } return; }
    if (status) setPendingStatus(status);
    setGateAction(action);
    setGateOpen(true);
  }

  async function submitGate() {
    if (!revealPass) return setError("Enter the Super Password");
    setGating(true);
    setError("");
    try {
      await api("/api/security/super-password/verify", {
        method: "POST",
        body: JSON.stringify({ password: revealPass }),
      });
      setGateOpen(false);
      setRevealPass("");
      await executeAction(gateAction, pendingStatus, "");
      setGateAction(null);
    } catch (e: any) {
      setRevealPass("");
      setError(e.message);
    } finally {
      setGating(false);
    }
  }

  async function executeAction(action: string | null, status: string | undefined, superPassword: string) {
    if (action === "edit") {
      setEd("sales_tax_percent", selected?.sales_tax_percent == null ? "5" : String(selected.sales_tax_percent));
      setEditApplyTax(selected?.sales_tax_percent != null);
      setTaxChanged(false);
      setEditMode(true);
    }
    else if (action === "delete") { await doDelete(superPassword); setRevealPass(""); }
    else if (action === "status" && status) { await doChangeStatus(status, superPassword); setRevealPass(""); }
  }

  async function save() {
    setError("");
    if (!form.client_id || !form.name || !form.expected_handover_date) return setError("Client, project name, and expected handover date are required");
    if (applyTax && (!form.sales_tax_percent.trim() || !Number.isFinite(Number(form.sales_tax_percent)) || Number(form.sales_tax_percent) < 0 || Number(form.sales_tax_percent) > 100)) return setError("Sales tax must be between 0 and 100 percent");
    if (form.start_date && form.expected_handover_date < form.start_date) return setError("Expected handover cannot be before the start date");
    setSaving(true);
    try {
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          client_id: Number(form.client_id),
          project_value: form.project_value ? Number(form.project_value) : null,
          sales_tax_percent: applyTax ? Number(form.sales_tax_percent) : null,
          start_date: form.start_date || null,
        }),
      });
      setForm({ ...emptyForm });
      setApplyTax(false);
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit() {
    if (!selected) return;
    setError("");
    if (!edit.expected_handover_date) return setError("Expected handover date is required");
    if (editApplyTax && (!edit.sales_tax_percent.trim() || !Number.isFinite(Number(edit.sales_tax_percent)) || Number(edit.sales_tax_percent) < 0 || Number(edit.sales_tax_percent) > 100)) return setError("Sales tax must be between 0 and 100 percent");
    if (edit.start_date && ((edit.end_date && edit.end_date < edit.start_date) || edit.expected_handover_date < edit.start_date)) return setError("End/expected handover cannot be before the start date");
    setSaving(true);
    try {
      await api(`/api/projects/${selected.id}`, {
        method: "PUT",
        headers: superPasswordHeaders(revealPass),
        body: JSON.stringify({
          name: edit.name, client_id: Number(edit.client_id),
          start_date: edit.start_date || null, end_date: edit.end_date || null,
          expected_handover_date: edit.expected_handover_date,
          project_value: edit.project_value ? Number(edit.project_value) : null,
          ...(taxChanged ? { sales_tax_percent: editApplyTax ? Number(edit.sales_tax_percent) : null } : {}),
          value_currency: edit.value_currency,
        }),
      });
      await load();
      const updated = await api<{ project: ProjectRow; team: TeamMember[]; progress_updates: ProgressUpdate[] }>(`/api/projects/${selected.id}`);
      setSelected({ ...selected, ...updated.project });
      setTeam(updated.team);
      setEditMode(false);
      setRevealPass("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function addProgressUpdate() {
    if (!selected) return;
    const percent = Number(progressPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) return setError("Progress must be a whole number from 0 to 100");
    if (!progressReport.trim()) return setError("Write a progress report before saving");
    setSaving(true); setError("");
    try {
      await api(`/api/projects/${selected.id}/progress`, { method: "POST", body: JSON.stringify({ progress_percent: percent, report: progressReport.trim() }) });
      const updated = await api<{ project: ProjectRow; team: TeamMember[]; progress_updates: ProgressUpdate[] }>(`/api/projects/${selected.id}`);
      setSelected({ ...selected, ...updated.project, current_progress: percent, latest_update: progressReport.trim() });
      setProgressUpdates(updated.progress_updates);
      setProgressReport("");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save progress update"); }
    finally { setSaving(false); }
  }

  async function doChangeStatus(status: string, superPassword: string) {
    if (!selected) return;
    await api(`/api/projects/${selected.id}`, {
      method: "PUT",
      headers: superPasswordHeaders(superPassword),
      body: JSON.stringify({ status }),
    });
    await load();
    setSelected({ ...selected, status });
  }

  async function doDelete(superPassword: string) {
    if (!selected || !confirm(`Delete ${selected.name}?`)) return;
    await api(`/api/projects/${selected.id}`, { method: "DELETE", headers: superPasswordHeaders(superPassword) });
    setSelected(null);
    await load();
  }

  async function assign() {
    if (!selected || !assignId) return;
    setError("");
    try {
      await api(`/api/projects/${selected.id}/assign`, {
        method: "POST",
        body: JSON.stringify({ employee_id: Number(assignId), role_on_project: assignRole || null }),
      });
      const d = await api<{ project: any; team: TeamMember[] }>(`/api/projects/${selected.id}`);
      setTeam(d.team);
      setAssignId(""); setAssignRole("");
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function unassign(assignmentId: number) {
    if (!selected) return;
    await api(`/api/projects/${selected.id}/assign/${assignmentId}`, { method: "DELETE" });
    const d = await api<{ project: any; team: TeamMember[] }>(`/api/projects/${selected.id}`);
    setTeam(d.team);
    await load();
  }

  // DETAIL VIEW
  if (selected) {
    return (
      <div className="content">
        <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={() => setSelected(null)}><LuArrowLeft size={15} aria-hidden="true" /> Back to projects</button>
        <div style={{ display: "flex", justifyContent: "end", alignItems: "center" }}>
          {!editMode && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {canAccessFinance && <button className="btn-download"
                onClick={() => downloadPdf(`/api/reports/project/${selected.id}.pdf`, `Ashtech-Project-${selected.name}.pdf`)}>
                ⬇ Download PDF
              </button>}
              <div className="detail-actions">
                <button className="btn-sm" onClick={() => openGate("edit")}>Edit</button>
                <button className="btn-sm btn-sm-danger" onClick={() => openGate("delete")}>Delete</button>
              </div>
            </div>
          )}
        </div>

        <div className="content-head" style={{ marginTop: 12 }}>
          <h1 className="page-title">{selected.name}</h1>
          <span className={`pill pill-${selected.status}`}>{selected.status.replace("_", " ")}</span>
        </div>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          Client: <strong>{selected.client_name}</strong>
          {selected.handover_date ? ` · Handed over on ${String(selected.handover_date).slice(0, 10)}` : ""}
          {selected.expected_handover_date ? ` · Expected handover ${String(selected.expected_handover_date).slice(0, 10)}` : ""}
        </p>

        {gateOpen && (
          <div className="reveal-gate">
            <div className="form-title">Confirm with Super Password</div>
            <div className="unlock-row">
              <input type="password" className="field-input" placeholder="Super Password"
                value={revealPass} onChange={(e) => setRevealPass(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitGate()} />
              <button className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={submitGate} disabled={gating}>
                {gating ? "Checking…" : "Confirm"}
              </button>
              <button className="btn-sm" onClick={() => { setGateOpen(false); setGateAction(null); setRevealPass(""); setError(""); }}>Cancel</button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}

        {editMode && (
          <div className="form-card">
            <div className="form-title">Edit project</div>
            <div className="form-grid">
              <div><label className="field-label">Project name</label>
                <input className="field-input" value={edit.name} onChange={(e) => setEd("name", e.target.value)} /></div>
              <div><label className="field-label">Client</label>
                <select className="field-input" value={edit.client_id} onChange={(e) => setEd("client_id", e.target.value)}>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                </select></div>
              <div><label className="field-label">Start date</label>
                <input
                  type="date"
                  className="field-input"
                  value={edit.start_date}
                  onChange={(e) => {
                    const val = e.target.value;
                    setError("");
                    setEd("start_date", val);
                  }}
                /></div>
              <div><label className="field-label">End date</label>
                <input type="date" className="field-input" value={edit.end_date} onChange={(e) => setEd("end_date", e.target.value)} /></div>
              <div><label className="field-label">Expected Handover Date *</label>
                <input type="date" className="field-input" value={edit.expected_handover_date} onChange={(e) => setEd("expected_handover_date", e.target.value)} /></div>
              <div><label className="field-label">Project value</label>
                <input
                  type="number"
                  className="field-input"
                  value={edit.project_value}
                  onWheel={handleWheel}
                  onChange={(e) => setEd("project_value", e.target.value)}
                /></div>
              <div><label className="field-label">
                <input type="checkbox" checked={editApplyTax} onChange={(e) => { setEditApplyTax(e.target.checked); setTaxChanged(true); }} /> Apply Sales Tax
              </label>
                {editApplyTax && <><label className="field-label">Sales Tax %</label><input type="number" min="0" max="100" step="0.01" className="field-input" value={edit.sales_tax_percent} onWheel={handleWheel} onChange={(e) => { setEd("sales_tax_percent", e.target.value); setTaxChanged(true); }} /></>}
              </div>
              <div><label className="field-label">Currency</label>
                <select className="field-input" value={edit.value_currency} onChange={(e) => setEd("value_currency", e.target.value)}>
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select></div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-primary" style={{ width: "auto", padding: "0 24px", marginTop: 8 }} onClick={saveEdit} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
              <button className="btn-sm" style={{ marginTop: 8 }} onClick={() => { setEditMode(false); setRevealPass(""); setError(""); }}>Cancel</button>
            </div>
          </div>
        )}

        <div className="form-card">
          <div className="form-title">Status</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {STATUSES.map((s) => (
              <button key={s}
                className={selected.status === s ? "btn-primary" : "btn-ghost"}
                style={{ width: "auto", padding: "0 16px", height: 38 }}
                onClick={() => openGate("status", s)}>
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="form-card">
          <div className="content-head" style={{ marginBottom: 12 }}>
            <div><div className="form-title">Project Progress</div><div className="page-sub">Expected handover: {selected.expected_handover_date ? String(selected.expected_handover_date).slice(0, 10) : "Not set"}</div></div>
            <strong style={{ fontSize: 24 }}>{Number(selected.current_progress || 0)}%</strong>
          </div>
          <div className="project-progress-track"><div className="project-progress-fill" style={{ width: `${Math.min(100, Math.max(0, Number(selected.current_progress || 0)))}%` }} /></div>
          {progressUpdates[0] && <p className="page-sub" style={{ marginTop: 10 }}>Latest update: <strong>{progressUpdates[0].report}</strong></p>}
          <div className="form-grid" style={{ marginTop: 16 }}>
            <div><label className="field-label">Progress % *</label><input type="number" min="0" max="100" step="1" className="field-input" value={progressPercent} onChange={(e) => setProgressPercent(e.target.value)} /></div>
            <div><label className="field-label">Progress report *</label><textarea className="field-input" rows={3} maxLength={4000} value={progressReport} onChange={(e) => setProgressReport(e.target.value)} placeholder="Describe what changed…" /></div>
          </div>
          <button className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={addProgressUpdate} disabled={saving}>{saving ? "Saving…" : "Add progress update"}</button>
          <div className="project-progress-history">
            {progressUpdates.map((update) => <div className="project-progress-update" key={update.id}><strong>{update.progress_percent}%</strong><div><div>{update.report}</div><small>{new Date(update.created_at).toLocaleDateString()} · {update.created_by_name}</small></div></div>)}
            {!progressUpdates.length && <div className="empty-note">No progress updates yet</div>}
          </div>
        </div>

        {canAccessFinance && <div className="form-card">
          <div className="form-title">Billing Summary</div>
          <div className="detail-grid">
            <div><div className="detail-label">Project Value</div><strong>{selected.value_currency} {Number(selected.project_value || 0).toFixed(2)}</strong></div>
            <div><div className="detail-label">{selected.sales_tax_percent == null ? "Sales Tax (not selected)" : `Tax (${Number(selected.sales_tax_percent).toFixed(2)}%)`}</div><strong>{selected.value_currency} {Number(selected.tax_amount || 0).toFixed(2)}</strong></div>
            <div><div className="detail-label">Total Payable</div><strong>{selected.value_currency} {Number(selected.total_payable || 0).toFixed(2)}</strong></div>
            <div><div className="detail-label">Paid</div><strong>{selected.value_currency} {Number(selected.total_paid || 0).toFixed(2)}</strong></div>
            <div><div className="detail-label">Remaining</div><strong>{selected.value_currency} {Number(selected.remaining_balance || 0).toFixed(2)}</strong></div>
          </div>
        </div>}

        <div className="form-card">
          <div className="form-title">Team ({team.length})</div>
          {team.map((m) => (
            <div className="team-row" key={m.assignment_id}>
              <div>
                <div>{m.full_name}</div>
                <div className="detail-label">{m.role_on_project ?? m.designation}</div>
              </div>
              <button className="btn-sm btn-sm-danger" onClick={() => unassign(m.assignment_id)}>Remove</button>
            </div>
          ))}
          {!team.length && <div className="empty-note">No one assigned yet</div>}
          <div className="unlock-row" style={{ marginTop: 14 }}>
            <select className="field-input" value={assignId} onChange={(e) => setAssignId(e.target.value)}>
              <option value="">Select employee…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <input className="field-input" placeholder="Role (optional)" value={assignRole} onChange={(e) => setAssignRole(e.target.value)} />
            <button className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={assign}>Assign</button>
          </div>
          {error && !gateOpen && !editMode && <p className="error-text">{error}</p>}
        </div>
        <div className="form-card">
          <div className="form-title">Requirements / Additions</div>
          <div className="project-progress-history">{requirements.map((requirement) => <div className="requirement-card" key={requirement.id}><strong>{requirement.current.content}</strong><small>Current · Version {requirement.current_version} · {new Date(requirement.current.created_at).toLocaleDateString()} · {requirement.client_name}</small>{requirement.attachment_name && <div className="inline-actions"><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/projects/requirements/${requirement.id}/attachment`).catch(() => setError("Unable to open attachment"))}>Open attachment</button><button className="btn-sm" onClick={() => void downloadFile(`/api/projects/requirements/${requirement.id}/attachment`, requirement.attachment_name!).catch(() => setError("Unable to download attachment"))}>Download attachment</button></div>}{requirement.versions.length > 1 && <details><summary>View previous versions</summary>{requirement.versions.slice(1).map((version) => <div className="requirement-version" key={version.version_number}><strong>Version {version.version_number}</strong><span>{version.content}</span><small>{new Date(version.created_at).toLocaleDateString()}</small></div>)}</details>}</div>)}{!requirements.length && <div className="empty-note">No requirements or additions yet.</div>}</div>
        </div>
        {canAccessFinance && <div className="form-card">
          <div className="form-title">Transactions</div>
          <div className="table-scroll"><table className="table"><thead><tr><th>Date</th><th>Invoice Number</th><th>Category</th><th>Description</th><th>Amount</th><th>Documents</th></tr></thead><tbody>
            {transactions.map((transaction) => <tr key={transaction.id}><td>{String(transaction.txn_date).slice(0, 10)}</td><td>{transaction.invoice_number || "—"}</td><td>{(transaction.custom_category || transaction.category).replace(/_/g, " ")}</td><td>{transaction.description || "—"}</td><td>{transaction.currency} {Number(transaction.amount).toLocaleString()}</td><td><div className="inline-actions">
              {transaction.invoice_path && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/finance/transactions/${transaction.id}/invoice?preview=1`)}>View invoice</button><button className="btn-sm" onClick={() => downloadFile(`/api/finance/transactions/${transaction.id}/invoice`, `${transaction.invoice_number || "invoice"}.pdf`)}>Download</button></>}
              {transaction.attachment_name && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/finance/transactions/${transaction.id}/attachment`)}>View receipt</button><button className="btn-sm" onClick={() => downloadFile(`/api/finance/transactions/${transaction.id}/attachment`, transaction.attachment_name || "receipt")}>Download</button></>}
              {!transaction.invoice_path && !transaction.attachment_name && "—"}
            </div></td></tr>)}
            {!transactions.length && <tr><td colSpan={6}><div className="empty-note">No transactions for this project</div></td></tr>}
          </tbody></table></div>
        </div>}
      </div>
    );
  }

  // ADD FORM VIEW — show only the form, not the table
  if (showForm) {
    return (
      <div className="content">
        <div className="content-head">
          <h1 className="page-title">Add project</h1>
          <button className="btn-sm" onClick={() => { setForm({ ...emptyForm }); setShowForm(false); setError(""); }}>Close</button>
        </div>

        <div className="form-card">
          <div className="form-title">New project</div>
          <div className="form-grid">
            <div><label className="field-label">Client *</label>
              <select className="field-input" value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select></div>
            <div><label className="field-label">Project name *</label>
              <input className="field-input" value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
            <div><label className="field-label">Status</label>
              <select className="field-input" value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select></div>
            <div>
              <label className="field-label">Start date</label>
              <input
                type="date"
                className="field-input"
                value={form.start_date}
                onChange={(e) => {
                  const val = e.target.value;
                  setError("");
                  set("start_date", val);
                }}
              />
            </div>
            <div><label className="field-label">Expected Handover Date *</label>
              <input type="date" className="field-input" value={form.expected_handover_date} onChange={(e) => set("expected_handover_date", e.target.value)} /></div>
            <div><label className="field-label">Project value</label>
              <input
                type="number"
                className="field-input"
                value={form.project_value}
                onWheel={handleWheel}
                onChange={(e) => set("project_value", e.target.value)}
              /></div>
              <div><label className="field-label">
                <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} /> Apply Sales Tax
              </label>{applyTax && <><label className="field-label">Sales Tax %</label><input type="number" min="0" max="100" step="0.01" className="field-input" value={form.sales_tax_percent} onWheel={handleWheel} onChange={(e) => set("sales_tax_percent", e.target.value)} /></>}</div>
            <div><label className="field-label">Currency</label>
              <select className="field-input" value={form.value_currency} onChange={(e) => set("value_currency", e.target.value)}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select></div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save project"}
            </button>
            <button className="btn-sm" onClick={() => { setForm({ ...emptyForm }); setShowForm(false); setError(""); }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // LIST VIEW
  const counts = {
    all: projects.length,
    ongoing: projects.filter((p) => p.status === "ongoing").length,
    upcoming: projects.filter((p) => p.status === "upcoming").length,
    completed: projects.filter((p) => p.status === "done" || p.status === "handed_over").length,
  };

  const query = searchQuery.trim().toLowerCase();
  const filteredProjects = projects.filter((p) => {
    const matchesSearch = !query || [p.name, p.client_name, p.value_currency, p.status]
      .some((v) => (v || "").toLowerCase().includes(query));
    let matchesStatus = true;
    if (statusFilter === "ongoing") matchesStatus = p.status === "ongoing";
    else if (statusFilter === "upcoming") matchesStatus = p.status === "upcoming";
    else if (statusFilter === "completed") matchesStatus = p.status === "done" || p.status === "handed_over";
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="content">
      <div className="projects-container-card">
        <div className="projects-card-header">
          <div className="projects-card-title-group">
            <h1 className="projects-page-title">Projects</h1>
            <p className="projects-page-subtitle">Track every project, client and handover</p>
          </div>
          <div className="projects-header-actions">
            <button className="btn-download" onClick={() => downloadPdf("/api/reports/projects.pdf", "Ashtech-Projects.pdf")}>
              ⬇ Download PDF
            </button>
            <button className="fin-btn-primary"
              onClick={() => setShowForm(true)}>
              <LuPlus size={15} aria-hidden="true" /> Add project
            </button>
          </div>
        </div>

        <div className="projects-toolbar">
          <div className="projects-filter-tabs">
            <button
              type="button"
              className={`projects-tab-btn ${statusFilter === "all" ? "active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              <span>All</span>
              <span className="projects-tab-count">{counts.all}</span>
            </button>
            <button
              type="button"
              className={`projects-tab-btn ${statusFilter === "ongoing" ? "active" : ""}`}
              onClick={() => setStatusFilter("ongoing")}
            >
              <span>Ongoing</span>
              <span className="projects-tab-count">{counts.ongoing}</span>
            </button>
            <button
              type="button"
              className={`projects-tab-btn ${statusFilter === "upcoming" ? "active" : ""}`}
              onClick={() => setStatusFilter("upcoming")}
            >
              <span>Upcoming</span>
              <span className="projects-tab-count">{counts.upcoming}</span>
            </button>
            <button
              type="button"
              className={`projects-tab-btn ${statusFilter === "completed" ? "active" : ""}`}
              onClick={() => setStatusFilter("completed")}
            >
              <span>Completed</span>
              <span className="projects-tab-count">{counts.completed}</span>
            </button>
          </div>

          <div className="projects-search-wrapper">
            <svg className="projects-search-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <line x1="12.5" y1="12.5" x2="17" y2="17" />
            </svg>
            <input
              type="text"
              className="projects-search-input"
              placeholder="Search projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {error && <p className="error-text" style={{ margin: "16px 24px 0" }}>{error}</p>}

        <div className="projects-table-scroll">
          <table className="projects-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Team</th>
                <th>Value</th>
                <th>Progress</th>
                <th>Expected Handover</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => (
                <tr key={p.id} onClick={() => openProject(p)}>
                  <td>
                    <span className="projects-name-val">{p.name}</span>
                  </td>
                  <td>
                    <span className="projects-client-val">{p.client_name}</span>
                  </td>
                  <td>
                    <div className="projects-team-badge">
                      <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
                        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                      </svg>
                      <span>{p.team_size || 0}</span>
                    </div>
                  </td>
                  <td>
                    <span className="projects-value-val">
                      {p.project_value ? `${p.value_currency} ${Number(p.project_value).toLocaleString()}` : "—"}
                    </span>
                  </td>
                  <td>
                    <div className="projects-progress-cell">
                      <div className="projects-progress-track">
                        <div
                          className={`projects-progress-bar-fill ${Number(p.current_progress || 0) >= 100 ? "complete" : ""}`}
                          style={{ width: `${Math.min(100, Math.max(0, Number(p.current_progress || 0)))}%` }}
                        />
                      </div>
                      <span className="projects-progress-text">{Number(p.current_progress || 0)}%</span>
                    </div>
                  </td>
                  <td>
                    <span className="projects-handover-val">
                      {formatHandoverDate(p.expected_handover_date)}
                    </span>
                  </td>
                  <td>
                    <span className={`project-status-pill status-${p.status}`}>
                      <span className="project-status-dot" />
                      {p.status === "handed_over" ? "Handed over" : p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
              {!filteredProjects.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-note">
                      {projects.length ? "No projects match the selected filter or search." : "No projects yet"}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
