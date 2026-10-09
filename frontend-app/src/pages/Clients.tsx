import { useEffect, useState, useMemo } from "react";
import { api, downloadPdf, superPasswordHeaders, hasSuperAuthorization } from "../lib/api";
import {
  LuDownload,
  LuArrowLeft,
  LuPlus,
  LuSearch,
  LuPencil,
  LuTrash2,
  LuChevronRight,
} from "react-icons/lu";

type ClientRow = {
  id: number; company_name: string; contact_person: string | null;
  email: string | null; phone: string | null; country: string | null;
  ntn: string | null;
  status: "active" | "inactive"; project_count: number;
  has_client_access: boolean | number;
  created_at?: string;
};

type ClientDetail = ClientRow & {
  projects: { id: number; name: string; status: string; project_value: number | null; value_currency: string; handover_date: string | null }[];
  transactions: { id: number; type: string; txn_date: string; description: string | null; amount: number; currency: string; amount_pkr: number; category: string }[];
};

const emptyForm = { company_name: "", contact_person: "", email: "", phone: "", country: "", ntn: "", status: "active", login_password: "" };

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const COUNTRY_REGEX = /^[a-zA-Z\s]+$/;
const PHONE_ALLOWED = /^[+0-9\s\-()]*$/;

function isValidEmail(e: string): boolean {
  if (!e.trim()) return true;
  return EMAIL_REGEX.test(e.trim());
}

function isValidNtn(n: string): boolean {
  if (!n.trim()) return true;
  return /^\d+$/.test(n.trim());
}

function isValidCountry(c: string): boolean {
  if (!c.trim()) return true;
  return COUNTRY_REGEX.test(c.trim());
}

function isValidPhone(p: string): boolean {
  if (!p.trim()) return true;
  const digits = p.replace(/\D/g, "");
  return PHONE_ALLOWED.test(p.trim()) && digits.length >= 10 && digits.length <= 15;
}

export default function Clients({ canAccessFinance }: { canAccessFinance: boolean }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selected, setSelected] = useState<ClientDetail | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateAction, setGateAction] = useState<{ type: "edit"; client: ClientRow } | { type: "delete"; client: ClientRow } | null>(null);
  const [revealPass, setRevealPass] = useState("");
  const [gating, setGating] = useState(false);
  const [sortOrder] = useState<"desc" | "asc">("desc");
  const [showPassword, setShowPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [countryFilter, setCountryFilter] = useState("");

  async function load() {
    const data = await api<{ clients: ClientRow[] }>("/api/clients");
    setClients(data.clients);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const timeA = a.created_at ? new Date(a.created_at).getTime() : a.id;
      const timeB = b.created_at ? new Date(b.created_at).getTime() : b.id;
      return sortOrder === "desc" ? timeB - timeA : timeA - timeB;
    });
  }, [clients, sortOrder]);

  const countries = useMemo(() => {
    const set = new Set<string>();
    clients.forEach((c) => {
      if (c.country && c.country.trim()) set.add(c.country.trim());
    });
    return Array.from(set).sort();
  }, [clients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortedClients.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (countryFilter && (c.country ?? "").trim().toLowerCase() !== countryFilter.toLowerCase()) return false;
      if (!q) return true;
      return (
        (c.company_name ?? "").toLowerCase().includes(q) ||
        (c.contact_person ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.country ?? "").toLowerCase().includes(q) ||
        (c.ntn ?? "").toLowerCase().includes(q)
      );
    });
  }, [sortedClients, search, statusFilter, countryFilter]);

  async function openClient(c: ClientRow) {
    const projData = await api<{ projects: any[] }>("/api/projects");
    const txnData = canAccessFinance
      ? await api<{ transactions: any[] }>("/api/finance/transactions")
      : { transactions: [] };
    const projects = projData.projects.filter((p: any) => p.client_id === c.id);
    const transactions = txnData.transactions.filter((t: any) => t.client_name === c.company_name);
    setSelected({ ...c, projects, transactions });
  }

  function set(key: keyof typeof emptyForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function openGate(action: typeof gateAction) {
    if (await hasSuperAuthorization()) { try { await executeAction(action, ""); } catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); } return; }
    setGateAction(action);
    setGateOpen(true);
    setError("");
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
      await executeAction(gateAction, "");
      setGateAction(null);
    } catch (e: any) {
      setRevealPass("");
      setError(e.message);
    } finally {
      setGating(false);
    }
  }

  async function executeAction(action: typeof gateAction, superPassword: string) {
    if (!action) return;
    if (action.type === "edit") {
      const c = action.client;
      setEditingId(c.id);
      setForm({
        company_name: c.company_name,
        contact_person: c.contact_person ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
        country: c.country ?? "",
        ntn: c.ntn ?? "",
        status: c.status,
        login_password: "",
      });
      setFieldErrors({});
      setShowForm(true);
      setError("");
    } else {
      await doDelete(action.client.id, action.client.company_name, superPassword);
      setRevealPass("");
    }
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setFieldErrors({});
    setError("");
    setRevealPass("");
    setShowPassword(false);
  }

  async function save() {
    setError("");
    const newErrors: Record<string, string> = {};

    if (!form.company_name.trim()) {
      newErrors.company_name = "Company name is required";
    }
    if (!form.email.trim()) newErrors.email = "Email is required for client login";
    if (!editingId && !form.login_password.trim()) newErrors.login_password = "Login Password is required";

    if (form.email.trim() && !isValidEmail(form.email)) {
      newErrors.email = "Please enter a valid email address (e.g. name@example.com)";
    }

    if (form.country.trim() && !isValidCountry(form.country)) {
      newErrors.country = "Country must contain letters and spaces only (no numbers or special characters)";
    }

    if (form.phone.trim() && !isValidPhone(form.phone)) {
      newErrors.phone = "Phone must not contain letters — use digits only (e.g. 0300-1234567 or +92 300 1234567)";
    }

    if (form.ntn.trim() && !isValidNtn(form.ntn)) {
      newErrors.ntn = "NTN number must contain digits only (no letters, spaces, dashes, or special characters)";
    }

    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      setError(Object.values(newErrors)[0]);
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api(`/api/clients/${editingId}`, {
          method: "PUT",
          headers: superPasswordHeaders(revealPass),
          body: JSON.stringify(form),
        });
      } else {
        await api("/api/clients", { method: "POST", body: JSON.stringify(form) });
      }
      closeForm();
      setRevealPass("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(id: number, name: string, superPassword: string) {
    if (!confirm(`Delete ${name}?`)) return;
    setError("");
    try {
      await api(`/api/clients/${id}`, { method: "DELETE", headers: superPasswordHeaders(superPassword) });
      setSelected(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function generateClientPassword() {
    const rawName = (form.contact_person || form.company_name).trim().split(/\s+/)[0] || "";
    const name = rawName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const country = form.country.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const phone = form.phone.replace(/\D/g, "");
    if (!name || !country || phone.length < 4) return setError("Enter the client name, country, and at least four phone digits before generating a password");
    set("login_password", `${name}.${country}.${phone.slice(-4)}`);
    setShowPassword(true);
    setError("");
  }

  const fmt = (n: number) => `Rs ${Number(n).toLocaleString()}`;

  // DETAIL VIEW
  if (selected) {
    const totalIn = selected.transactions.filter(t => t.type === "inflow").reduce((s, t) => s + Number(t.amount_pkr), 0);
    const totalOut = selected.transactions.filter(t => t.type === "outflow").reduce((s, t) => s + Number(t.amount_pkr), 0);

    return (
      <div className="content">
        <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={() => setSelected(null)}><LuArrowLeft size={15} aria-hidden="true" /> Back to clients</button>
        <div style={{ display: "flex", justifyContent: "end", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {canAccessFinance && <button className="btn-download"
              onClick={() => downloadPdf(`/api/reports/client/${selected.id}.pdf`, `Ashtech-Client-${selected.company_name}.pdf`)}>
              ⬇ Download PDF
            </button>}
            <div className="detail-actions">
              <button className="btn-sm" onClick={() => openGate({ type: "edit", client: selected })}>Edit</button>
              <button className="btn-sm btn-sm-danger" onClick={() => openGate({ type: "delete", client: selected })}>Delete</button>
            </div>
          </div>
        </div>

        <h1 className="page-title" style={{ marginTop: 12, marginBottom: 4 }}>{selected.company_name}</h1>
        <p className="page-sub" style={{ marginBottom: 20 }}>
          <span className={`pill ${selected.status === "active" ? "pill-active" : "pill-resigned"}`}>{selected.status}</span>
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
        {!gateOpen && error && <p className="error-text" style={{ marginBottom: 16 }}>{error}</p>}

        {/* Edit form inside detail view */}
        {showForm && (
          <div className="form-card">
            <div className="form-title">{editingId ? "Edit client" : "New client"}</div>
            <div className="form-grid">
              <div>
                <label className="field-label">Company name *</label>
                <input className="field-input" value={form.company_name} onChange={(e) => {
                  set("company_name", e.target.value);
                  if (fieldErrors.company_name) setFieldErrors(prev => ({ ...prev, company_name: "" }));
                }} />
                {fieldErrors.company_name && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.company_name}</span>}
              </div>
              <div>
                <label className="field-label">Contact person</label>
                <input className="field-input" value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
              </div>
              <div>
                <label className="field-label">Email</label>
                <input className="field-input" type="email" value={form.email} onChange={(e) => {
                  const val = e.target.value;
                  set("email", val);
                  if (val.trim() && !isValidEmail(val)) {
                    setFieldErrors(prev => ({ ...prev, email: "Please enter a valid email address (e.g. name@example.com)" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, email: "" }));
                  }
                }} placeholder="name@example.com" />
                {fieldErrors.email && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.email}</span>}
              </div>
              <div>
                <label className="field-label">Phone</label>
                <input className="field-input" value={form.phone} onChange={(e) => {
                  const val = e.target.value;
                  if (PHONE_ALLOWED.test(val)) {
                    set("phone", val);
                    if (val.trim() && !isValidPhone(val)) {
                      setFieldErrors(prev => ({ ...prev, phone: "Phone must not contain letters — digits only (e.g. 0300-1234567)" }));
                    } else {
                      setFieldErrors(prev => ({ ...prev, phone: "" }));
                    }
                  }
                }} placeholder="0300-1234567 or +92 300 1234567" />
                {fieldErrors.phone && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.phone}</span>}
              </div>
              <div>
                <label className="field-label">Country</label>
                <input className="field-input" value={form.country} onChange={(e) => {
                  const val = e.target.value;
                  set("country", val);
                  if (val.trim() && !isValidCountry(val)) {
                    setFieldErrors(prev => ({ ...prev, country: "Country must contain letters and spaces only" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, country: "" }));
                  }
                }} placeholder="e.g. Pakistan" />
                {fieldErrors.country && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.country}</span>}
              </div>
              <div>
                <label className="field-label">NTN Number (optional)</label>
                <input
                  className="field-input"
                  value={form.ntn}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || /^\d+$/.test(val)) {
                      set("ntn", val);
                      setFieldErrors(prev => ({ ...prev, ntn: "" }));
                    }
                  }}
                  placeholder="e.g. 1234567"
                />
                {fieldErrors.ntn && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.ntn}</span>}
              </div>
              <div>
                <label className="field-label">Status</label>
                <select className="field-input" value={form.status} onChange={(e) => set("status", e.target.value)}>
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><label className="field-label">Login Password {editingId ? "(leave blank to keep current)" : "*"}</label><button type="button" className="login-link-button" style={{ margin: 0 }} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div>
                <div className="unlock-row"><input className="field-input" type={showPassword ? "text" : "password"} value={form.login_password} onChange={(event) => set("login_password", event.target.value)} placeholder={editingId ? "Enter a replacement password" : "Enter or generate a password"} /><button type="button" className="btn-sm" onClick={generateClientPassword}>Generate</button></div>
                <span className="field-help">Passwords use bcrypt and cannot be revealed later. Enter a replacement to reset it.</span>
                {fieldErrors.login_password && <span className="error-text" style={{ fontSize: 12, display: "block" }}>{fieldErrors.login_password}</span>}
              </div>
            </div>
            {error && <p className="error-text">{error}</p>}
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} onClick={save} disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Save client"}
              </button>
              <button className="btn-sm" onClick={closeForm}>Close</button>
            </div>
          </div>
        )}

        <div className="detail-grid" style={{ marginBottom: 20 }}>
          {[
            ["Contact", selected.contact_person ?? "—"],
            ["Email", selected.email ?? "—"],
            ["Phone", selected.phone ?? "—"],
            ["Country", selected.country ?? "—"],
            ["NTN", selected.ntn ?? "—"],
          ].map(([label, value]) => (
            <div className="detail-row" key={label}>
              <div className="detail-label">{label}</div>
              <div className="detail-value">{value}</div>
            </div>
          ))}
        </div>

        {canAccessFinance && <div className="summary-row" style={{ marginBottom: 20 }}>
          <div className="summary-card">
            <div className="summary-label">Total inflow</div>
            <div className="summary-value summary-inflow">{fmt(totalIn)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Total outflow</div>
            <div className="summary-value summary-outflow">{fmt(totalOut)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Net</div>
            <div className="summary-value" style={{ color: (totalIn - totalOut) >= 0 ? "var(--fin-positive, #15803D)" : "var(--fin-negative, #DC2626)" }}>{fmt(totalIn - totalOut)}</div>
          </div>
        </div>}

        {canAccessFinance && <div className="form-card">
          <div className="form-title">Projects ({selected.projects.length})</div>
          {selected.projects.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Project</th><th>Status</th><th>Value</th><th>Handover</th></tr></thead>
                <tbody>
                  {selected.projects.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td><span className={`pill pill-${p.status}`}>{p.status.replace("_", " ")}</span></td>
                      <td>{p.project_value ? `${p.value_currency} ${Number(p.project_value).toLocaleString()}` : "—"}</td>
                      <td>{p.handover_date ? String(p.handover_date).slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-note">No projects</div>}
        </div>}

        <div className="form-card">
          <div className="form-title">Transactions ({selected.transactions.length})</div>
          {selected.transactions.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>PKR Value</th></tr></thead>
                <tbody>
                  {selected.transactions.map((t) => (
                    <tr key={t.id}>
                      <td>{String(t.txn_date).slice(0, 10)}</td>
                      <td>{t.category.replace("_", " ")}</td>
                      <td>{t.description ?? "—"}</td>
                      <td className={t.type === "inflow" ? "amount-inflow" : "amount-outflow"}>
                        {t.type === "inflow" ? "+" : "−"} {t.currency} {Number(t.amount).toLocaleString()}
                      </td>
                      <td className={t.type === "inflow" ? "amount-inflow" : "amount-outflow"}>
                        {fmt(t.amount_pkr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty-note">No transactions</div>}
        </div>
      </div>
    );
  }

  // ADD FORM VIEW — show only the form, not the list
  if (showForm) {
    return (
      <div className="content">
        <div className="content-head">
          <h1 className="page-title">{editingId ? "Edit client" : "Add client"}</h1>
          <button className="btn-sm" onClick={closeForm}>Close</button>
        </div>

        <div className="form-card">
          <div className="form-title">{editingId ? "Edit client" : "New client"}</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Company name *</label>
              <input className="field-input" value={form.company_name} onChange={(e) => {
                set("company_name", e.target.value);
                if (fieldErrors.company_name) setFieldErrors(prev => ({ ...prev, company_name: "" }));
              }} />
              {fieldErrors.company_name && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.company_name}</span>}
            </div>
            <div>
              <label className="field-label">Contact person</label>
              <input className="field-input" value={form.contact_person} onChange={(e) => set("contact_person", e.target.value)} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input
                className="field-input"
                type="email"
                value={form.email}
                onChange={(e) => {
                  const val = e.target.value;
                  set("email", val);
                  if (val.trim() && !isValidEmail(val)) {
                    setFieldErrors(prev => ({ ...prev, email: "Please enter a valid email address (e.g. name@example.com)" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, email: "" }));
                  }
                }}
                placeholder="name@example.com"
              />
              {fieldErrors.email && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.email}</span>}
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input
                className="field-input"
                value={form.phone}
                onChange={(e) => {
                  const val = e.target.value;
                  // Only allow digits, +, spaces, hyphens, parentheses — block all alphabetic chars
                  if (PHONE_ALLOWED.test(val)) {
                    set("phone", val);
                    if (val.trim() && !isValidPhone(val)) {
                      setFieldErrors(prev => ({ ...prev, phone: "Phone must not contain letters — digits only (e.g. 0300-1234567)" }));
                    } else {
                      setFieldErrors(prev => ({ ...prev, phone: "" }));
                    }
                  }
                }}
                placeholder="0300-1234567 or +92 300 1234567"
              />
              {fieldErrors.phone && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.phone}</span>}
            </div>
            <div>
              <label className="field-label">Country</label>
              <input
                className="field-input"
                value={form.country}
                onChange={(e) => {
                  const val = e.target.value;
                  set("country", val);
                  if (val.trim() && !isValidCountry(val)) {
                    setFieldErrors(prev => ({ ...prev, country: "Country must contain letters and spaces only (no numbers or special characters)" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, country: "" }));
                  }
                }}
                placeholder="e.g. Pakistan"
              />
              {fieldErrors.country && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.country}</span>}
            </div>
            <div>
              <label className="field-label">NTN Number (optional)</label>
              <input
                className="field-input"
                value={form.ntn}
                onChange={(e) => {
                  const val = e.target.value;
                  // Strictly accept only numeric characters
                  if (val === "" || /^\d+$/.test(val)) {
                    set("ntn", val);
                    setFieldErrors(prev => ({ ...prev, ntn: "" }));
                  }
                }}
                placeholder="e.g. 1234567"
              />
              {fieldErrors.ntn && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.ntn}</span>}
            </div>
            <div>
              <label className="field-label">Status</label>
              <select className="field-input" value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><label className="field-label">Login Password {editingId ? "(leave blank to keep current)" : "*"}</label><button type="button" className="login-link-button" style={{ margin: 0 }} onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div>
              <div className="unlock-row"><input className="field-input" type={showPassword ? "text" : "password"} value={form.login_password} onChange={(event) => set("login_password", event.target.value)} placeholder={editingId ? "Enter a replacement password" : "Enter or generate a password"} /><button type="button" className="btn-sm" onClick={generateClientPassword}>Generate</button></div>
              <span className="field-help">Passwords use bcrypt and cannot be revealed later. Enter a replacement to reset it.</span>
              {fieldErrors.login_password && <span className="error-text" style={{ fontSize: 12, display: "block" }}>{fieldErrors.login_password}</span>}
            </div>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : editingId ? "Save changes" : "Save client"}
            </button>
            <button className="btn-sm" onClick={closeForm}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  // LIST VIEW
  return (
    <div className="content">
      {/* Page Header */}
      <div className="fin-page-header">
        <div className="fin-page-header-left">
          <p className="fin-page-kicker">CLIENT MANAGEMENT</p>
          <h1 className="page-title" style={{ margin: 0 }}>Clients</h1>
          <p className="fin-page-sub">Manage your clients, contacts, projects, and business information.</p>
        </div>
        <div className="fin-page-header-right">
          <button
            type="button"
            className="fin-btn-secondary"
            onClick={() => downloadPdf("/api/reports/clients.pdf", "Ashtech-Clients.pdf")}
          >
            <LuDownload size={15} /> Download PDF
          </button>
          <button
            type="button"
            className="fin-btn-primary"
            onClick={() => setShowForm(true)}
          >
            <LuPlus size={15} /> Add client
          </button>
        </div>
      </div>

      {gateOpen && (
        <div className="reveal-gate">
          <div className="form-title">Confirm with Super Password</div>
          <div className="unlock-row">
            <input
              type="password"
              className="field-input"
              placeholder="Super Password"
              value={revealPass}
              onChange={(e) => setRevealPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitGate()}
            />
            <button
              type="button"
              className="btn-primary"
              style={{ width: "auto", padding: "0 20px" }}
              onClick={submitGate}
              disabled={gating}
            >
              {gating ? "Checking…" : "Confirm"}
            </button>
            <button
              type="button"
              className="btn-sm"
              onClick={() => {
                setGateOpen(false);
                setGateAction(null);
                setRevealPass("");
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {!gateOpen && error && <p className="error-text">{error}</p>}

      {/* Search + Filter Row */}
      <div className="cln-controls-row">
        <div className="cln-search-box">
          <LuSearch size={16} style={{ color: "var(--ui-muted)", flexShrink: 0 }} />
          <input
            type="text"
            className="cln-search-input"
            placeholder="Search by company name, contact, email, country or NTN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="cln-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          className="cln-select"
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Clients Table Card */}
      <div className="cln-card">
        <div className="table-scroll">
          <table className="cln-table">
            <thead>
              <tr>
                <th>COMPANY</th>
                <th>CONTACT</th>
                <th>EMAIL</th>
                <th>COUNTRY</th>
                <th>PROJECTS</th>
                <th>STATUS</th>
                <th style={{ textAlign: "right", paddingRight: 24 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((c) => (
                <tr key={c.id} onClick={() => openClient(c)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="cln-company-cell">
                      <div className="cln-avatar">
                        {(c.company_name || "?").trim().charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="cln-company-name">{c.company_name}</div>
                        <div className="cln-company-ntn">
                          NTN: {c.ntn && c.ntn.trim() ? c.ntn.trim() : "—"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{c.contact_person ?? "—"}</td>
                  <td>{c.email ?? "—"}</td>
                  <td>{c.country ?? "—"}</td>
                  <td>{c.project_count}</td>
                  <td>
                    <span className={`cln-status-badge ${c.status}`}>
                      {c.status === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="cln-actions-cell">
                      <button
                        type="button"
                        className="cln-btn-edit"
                        onClick={() => openGate({ type: "edit", client: c })}
                      >
                        <LuPencil size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        className="cln-btn-delete"
                        onClick={() => openGate({ type: "delete", client: c })}
                      >
                        <LuTrash2 size={13} /> Delete
                      </button>
                      <button
                        type="button"
                        className="cln-btn-chevron"
                        onClick={() => openClient(c)}
                        title="View details"
                      >
                        <LuChevronRight size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredClients.length && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "40px 20px" }}>
                    <div className="empty-note">
                      {search || statusFilter || countryFilter ? "No matching clients found" : "No clients yet"}
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
