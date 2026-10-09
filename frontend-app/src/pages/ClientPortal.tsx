import { useEffect, useState } from "react";
import { api, downloadFile, openAuthenticatedFile } from "../lib/api";
import { LuFolderKanban, LuCalendarDays, LuArrowRight, LuArrowLeft, LuTrendingUp, LuWallet, LuPercent, LuCircleCheck, LuClock, LuHistory, LuReceipt, LuEye, LuDownload, LuClipboardList, LuPlus } from "react-icons/lu";
import { StatusBadge } from "../components/StatusBadge";

type ClientProject = {
  id: number; name: string; description: string | null; status: string;
  start_date: string | null; end_date: string | null; expected_handover_date: string | null;
  project_value: number; sales_tax_percent: number | null; tax_amount: number; total_payable: number; total_paid: number; remaining_balance: number; value_currency: string;
  current_progress: number; latest_update?: string | null;
};
type ProgressUpdate = { id: number; progress_percent: number; report: string; created_at: string };
type Requirement = { id: number; attachment_name: string | null; current_version: number; current: { content: string; created_at: string }; versions: { version_number: number; content: string; created_at: string }[] };
type ProjectTransaction = {
  id: number; txn_date: string; invoice_number: string | null; category: string;
  description: string | null; amount: string | number; currency: string;
  has_invoice: number | boolean; has_receipt: number | boolean; attachment_name: string | null;
};
type ProjectDetailsResponse = { project: ClientProject; progress_updates: ProgressUpdate[]; requirements: Requirement[]; transactions: ProjectTransaction[] };

export default function ClientPortal({ view = "dashboard" }: { view?: "dashboard" | "invoices" | "progress" }) {
  const [projects, setProjects] = useState<ClientProject[]>([]);
  const [selected, setSelected] = useState<ClientProject | null>(null);
  const [updates, setUpdates] = useState<ProgressUpdate[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [transactions, setTransactions] = useState<ProjectTransaction[]>([]);
  const [requirementText, setRequirementText] = useState("");
  const [requirementFile, setRequirementFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [editingRequirementId, setEditingRequirementId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [progressGroups, setProgressGroups] = useState<Array<{ project: ClientProject; updates: ProgressUpdate[] }>>([]);
  const [progressLoading, setProgressLoading] = useState(view === "progress");
  const [invoiceItems, setInvoiceItems] = useState<Array<ProjectTransaction & { project_name: string }>>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(view === "invoices");

  useEffect(() => {
    api<{ projects: ClientProject[] }>("/api/client-portal/projects")
      .then(async (result) => {
        setProjects(result.projects);
        if (view === "progress" || view === "invoices") {
          const groups = await Promise.all(result.projects.map(async (project) => {
            const details = await api<ProjectDetailsResponse>(`/api/client-portal/projects/${project.id}`);
            return { project: details.project, updates: details.progress_updates, transactions: details.transactions };
          }));
          setProgressGroups(groups);
          setInvoiceItems(groups.flatMap((group) => group.transactions.filter((item) => Boolean(item.has_invoice) || Boolean(item.has_receipt)).map((item) => ({ ...item, project_name: group.project.name }))).sort((a, b) => String(b.txn_date).localeCompare(String(a.txn_date)) || b.id - a.id));
        }
      }).catch((caught) => setError(caught.message)).finally(() => { setProgressLoading(false); setInvoicesLoading(false); });
  }, [view]);

  async function openProject(project: ClientProject) {
    setError("");
    try {
      const result = await api<ProjectDetailsResponse>(`/api/client-portal/projects/${project.id}`);
      setSelected(result.project); setUpdates(result.progress_updates); setRequirements(result.requirements); setTransactions(result.transactions);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load project"); }
  }

  async function saveRequirement() {
    if (!selected || !requirementText.trim()) return setError("Enter a requirement or addition");
    setError("");
    try {
      if (requirementFile && requirementFile.size > 10 * 1024 * 1024) return setError("Attachment must be 10 MB or smaller");
      const form = new FormData(); form.set("content", requirementText.trim()); if (requirementFile) form.set("attachment", requirementFile);
      await api(editingRequirementId ? `/api/client-portal/requirements/${editingRequirementId}` : `/api/client-portal/projects/${selected.id}/requirements`, {
        method: editingRequirementId ? "PUT" : "POST", body: editingRequirementId ? JSON.stringify({ content: requirementText.trim() }) : form,
      });
      const result = await api<ProjectDetailsResponse>(`/api/client-portal/projects/${selected.id}`);
      setRequirements(result.requirements); setRequirementText(""); setEditingRequirementId(null);
      setRequirementFile(null); setFileInputKey((key) => key + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save requirement"); }
  }

  if (view.startsWith("invoices")) return <main className="content client-portal-page client-invoices-page">
    <div className="content-head"><div><h1 className="page-title">Invoices</h1><p className="page-sub">View and download your project invoices and receipts.</p></div></div>
    {error && <p className="error-text">{error}</p>}
    {invoicesLoading ? <p className="page-sub">Loading invoices…</p> : !error && <div className="client-invoice-grid">
      {invoiceItems.map((item) => <article className="client-invoice-card" key={item.id}>
        <header><span className="client-project-icon"><LuReceipt size={21} /></span><strong>{item.invoice_number || "Receipt"}</strong></header>
        <span className="client-invoice-project"><LuFolderKanban size={14} />{item.project_name}</span>
        <div className="client-invoice-meta"><span><LuCalendarDays size={14} />{String(item.txn_date).slice(0, 10)}</span><span>{item.category.replace(/_/g, " ")}</span></div>
        <strong className="client-invoice-amount">{item.currency} {Number(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <div className="inline-actions">
          {Boolean(item.has_invoice) && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/client-portal/transactions/${item.id}/invoice?preview=1`).catch(() => setError("Unable to open invoice"))}><LuEye size={14} /> View Invoice</button><button className="btn-sm" onClick={() => void downloadFile(`/api/client-portal/transactions/${item.id}/invoice`, `${item.invoice_number || "invoice"}.pdf`).catch(() => setError("Unable to download invoice"))}><LuDownload size={14} /> Download</button></>}
          {Boolean(item.has_receipt) && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/client-portal/transactions/${item.id}/receipt?preview=1`).catch(() => setError("Unable to open receipt"))}><LuEye size={14} /> View Receipt</button><button className="btn-sm" onClick={() => void downloadFile(`/api/client-portal/transactions/${item.id}/receipt`, item.attachment_name || "receipt").catch(() => setError("Unable to download receipt"))}><LuDownload size={14} /> Download Receipt</button></>}
        </div>
      </article>)}
      {!invoiceItems.length && <div className="empty-note client-invoice-empty"><LuReceipt size={30} /><h3>No invoices yet</h3><p>Your invoices will appear here when they are generated.</p></div>}
    </div>}
  </main>;

  if (view === "progress") return <main className="content client-portal-page client-progress-page">
    <div className="content-head"><div><h1 className="page-title">Progress Updates</h1><p className="page-sub">Latest progress from your projects.</p></div></div>
    {error && <p className="error-text">{error}</p>}
    {progressLoading ? <p className="page-sub">Loading progress updates…</p> : !error && <>
      {progressGroups.filter((group) => group.updates.length > 0).map((group) => <section className="form-card client-progress-group" key={group.project.id}>
        <div className="client-card-heading"><span className="client-project-icon"><LuFolderKanban size={22} /></span><strong>{group.project.name}</strong><StatusBadge value={group.project.status} /></div>
        <div className="client-progress-label"><span><LuTrendingUp size={16} /> Current Progress</span><strong>{group.project.current_progress}%</strong></div>
        <div className="project-progress-track"><div className="project-progress-fill" style={{ width: `${Math.min(100, Math.max(0, Number(group.project.current_progress)))}%` }} /></div>
        <h3 className="client-progress-history-title"><LuHistory size={16} /> Recent Updates</h3>
        <div className="client-update-timeline">{group.updates.map((update) => <div className="client-update-entry" key={update.id}><strong>{update.progress_percent}%</strong><div><p>{update.report}</p><small><LuCalendarDays size={13} />{new Date(update.created_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" })}</small></div></div>)}</div>
      </section>)}
      {!progressGroups.some((group) => group.updates.length > 0) && <div className="empty-note">No progress updates yet.</div>}
    </>}
  </main>;

  if (selected) return <main className={`content client-portal-page ${view === "dashboard" ? "client-project-detail-page" : ""}`}>
    <button className="btn-ghost client-back-action" onClick={() => setSelected(null)}><LuArrowLeft size={16} /> Back to {view === "invoices" ? "Invoices" : "projects"}</button>
    <div className="content-head client-detail-header"><span className="client-project-icon"><LuFolderKanban size={24} /></span><div><h1 className="page-title">{selected.name}</h1><p className="page-sub"><LuCalendarDays size={14} /> Expected handover: {selected.expected_handover_date ? String(selected.expected_handover_date).slice(0, 10) : "Not set"}</p></div><StatusBadge value={selected.status} /></div>
    {error && <p className="error-text">{error}</p>}
    {view !== "invoices" && <><section className="form-card client-detail-progress">
      <div className="content-head"><div className="form-title"><LuTrendingUp size={19} /> Current progress</div><strong className="client-detail-percentage">{Number(selected.current_progress || 0)}%</strong></div>
      <div className="project-progress-track"><div className="project-progress-fill" style={{ width: `${Math.min(100, Math.max(0, Number(selected.current_progress || 0)))}%` }} /></div>
      {selected.description && <p className="page-sub" style={{ marginTop: 16 }}>{selected.description}</p>}
    </section>
    <section className="form-card"><div className="form-title"><LuWallet size={19} /> Billing Summary</div><div className="client-billing-grid">
      <div><LuFolderKanban size={18} /><div className="detail-label">Project Value</div><strong>{selected.value_currency} {Number(selected.project_value || 0).toFixed(2)}</strong></div>
      <div className="billing-info"><LuPercent size={18} /><div className="detail-label">{selected.sales_tax_percent == null ? "Sales Tax (not selected)" : `Tax (${Number(selected.sales_tax_percent).toFixed(2)}%)`}</div><strong>{selected.value_currency} {Number(selected.tax_amount || 0).toFixed(2)}</strong></div>
      <div className="billing-info"><LuReceipt size={18} /><div className="detail-label">Total Payable</div><strong>{selected.value_currency} {Number(selected.total_payable || 0).toFixed(2)}</strong></div>
      <div className="billing-paid"><LuCircleCheck size={18} /><div className="detail-label">Total Paid</div><strong>{selected.value_currency} {Number(selected.total_paid || 0).toFixed(2)}</strong></div>
      <div><LuClock size={18} /><div className="detail-label">Remaining</div><strong>{selected.value_currency} {Number(selected.remaining_balance || 0).toFixed(2)}</strong></div>
    </div></section>
    <section className="form-card"><div className="form-title"><LuHistory size={19} /> Progress updates</div><div className="project-progress-history">
      {updates.map((update) => <div className="project-progress-update" key={update.id}><strong>{update.progress_percent}%</strong><div><div>{update.report}</div><small>{new Date(update.created_at).toLocaleDateString()}</small></div></div>)}
      {!updates.length && <div className="empty-note">No progress updates yet</div>}
    </div></section>
    </>}
    <section className="form-card"><div className="form-title"><LuReceipt size={19} /> {view === "invoices" ? "Invoices / receipts" : "Project transactions"}</div>
      <div className="table-scroll"><table><thead><tr><th>Date</th><th>Invoice Number</th><th>Category</th><th>Description</th><th>Amount</th><th>Document</th></tr></thead><tbody>
        {transactions.map((transaction) => {
          const invoicePath = `/api/client-portal/transactions/${transaction.id}/invoice`;
          const receiptPath = `/api/client-portal/transactions/${transaction.id}/receipt`;
          return <tr key={transaction.id}><td>{String(transaction.txn_date).slice(0, 10)}</td><td>{transaction.invoice_number || "—"}</td><td>{transaction.category}</td><td>{transaction.description || "—"}</td><td>{Number(transaction.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {transaction.currency}</td><td><div className="inline-actions">
            {Boolean(transaction.has_invoice) && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`${invoicePath}?preview=1`).catch(() => setError("Unable to open invoice"))}><LuEye size={14} /> View invoice</button><button className="btn-sm" onClick={() => downloadFile(invoicePath, `${transaction.invoice_number || "invoice"}.pdf`)}><LuDownload size={14} /> Download</button></>}
            {Boolean(transaction.has_receipt) && <><button className="btn-sm" onClick={() => void openAuthenticatedFile(`${receiptPath}?preview=1`).catch(() => setError("Unable to open receipt"))}><LuEye size={14} /> View receipt</button><button className="btn-sm" onClick={() => downloadFile(receiptPath, transaction.attachment_name || "receipt")}><LuDownload size={14} /> Download</button></>}
            {!transaction.has_invoice && !transaction.has_receipt && "—"}
          </div></td></tr>;
        })}
        {!transactions.length && <tr><td colSpan={6}><div className="empty-note">No transactions are linked to this project.</div></td></tr>}
      </tbody></table></div>
    </section>
    {view !== "invoices" && <section className="form-card client-detail-requirements"><div className="form-title"><LuClipboardList size={19} /> Requirements / Additions</div>
      <label className="field-label">{editingRequirementId ? "Edit requirement" : "Add a requirement or addition"}</label>
      <textarea className="field-input" maxLength={4000} rows={4} value={requirementText} onChange={(event) => setRequirementText(event.target.value)} placeholder="Describe the requested addition…" />
      {!editingRequirementId && <label className="field-label">Optional Attachment<input key={fileInputKey} className="field-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(event) => setRequirementFile(event.target.files?.[0] || null)} /><span className="field-help">PDF, JPG, PNG, WEBP · Maximum 10 MB</span></label>}
      <div className="inline-actions"><button className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={saveRequirement}><LuPlus size={16} />{editingRequirementId ? "Save new version" : "Add requirement"}</button>{editingRequirementId && <button className="btn-sm" onClick={() => { setEditingRequirementId(null); setRequirementText(""); }}>Cancel</button>}</div>
      <div className="project-progress-history">
        {requirements.map((requirement) => <div className="requirement-card" key={requirement.id}><div className="content-head"><strong>{requirement.current.content}</strong><button className="btn-sm" onClick={() => { setEditingRequirementId(requirement.id); setRequirementText(requirement.current.content); }}>Edit</button></div><small>Current · Version {requirement.current_version} · {new Date(requirement.current.created_at).toLocaleDateString()}</small>{requirement.attachment_name && <div className="inline-actions"><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/client-portal/requirements/${requirement.id}/attachment`).catch(() => setError("Unable to open attachment"))}>Open attachment</button><button className="btn-sm" onClick={() => void downloadFile(`/api/client-portal/requirements/${requirement.id}/attachment`, requirement.attachment_name!).catch(() => setError("Unable to download attachment"))}>Download attachment</button></div>}{requirement.versions.length > 1 && <details><summary>View edit history</summary>{requirement.versions.slice(1).map((version) => <div className="requirement-version" key={version.version_number}><strong>Version {version.version_number}</strong><span>{version.content}</span><small>{new Date(version.created_at).toLocaleDateString()}</small></div>)}</details>}</div>)}
        {!requirements.length && <div className="empty-note"><LuClipboardList size={24} /><p>No requirements or additions yet.</p></div>}
      </div>
    </section>}
  </main>;

  return <main className="content client-portal-page">
    <div className="content-head"><div><h1 className="page-title">{view === "invoices" ? "Invoices" : "Client Dashboard"}</h1><p className="page-sub">{view === "invoices" ? "Select your project to view its existing invoices and receipts." : "Your projects and latest delivery progress."}</p></div></div>
    {error && <p className="error-text">{error}</p>}
    <div className="client-project-grid">
      {projects.map((project) => <button type="button" className="client-project-card" key={project.id} onClick={() => openProject(project)}>
        <div className="client-card-heading"><span className="client-project-icon"><LuFolderKanban size={22} /></span><strong>{project.name}</strong><StatusBadge value={project.status} /></div>
        <div className="client-card-progress-label">{Number(project.current_progress || 0)}% complete</div>
        <div className="project-progress-track"><div className="project-progress-fill" style={{ width: `${Math.min(100, Math.max(0, Number(project.current_progress || 0)))}%` }} /></div>
        <div className="client-card-footer"><div className="client-card-handover"><LuCalendarDays size={18} /><div><small>Expected handover</small><strong>{project.expected_handover_date ? String(project.expected_handover_date).slice(0, 10) : "Not set"}</strong></div></div><span className="client-card-link">{view === "invoices" ? "View invoices" : "View details"}<LuArrowRight size={16} /></span></div>
      </button>)}
      {!projects.length && <div className="empty-note">No projects are linked to your account.</div>}
    </div>
  </main>;
}
