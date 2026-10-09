import { useCallback, useEffect, useState } from "react";
import { LuArrowLeft, LuUserPlus, LuUserMinus } from "react-icons/lu";
import { api, downloadPdf, superPasswordHeaders, hasSuperAuthorization } from "../lib/api";
import EmployeeLetters from "./EmployeeLetters";
import { EmployeeAttendanceProfile } from "./AdminAttendanceEmployees";
import { getAttendanceEmployeeOverview } from "../lib/attendanceEmployeesApi";
import type { AttendanceMode } from "../types/attendance";
import { AttendanceModeBadge, StatusBadge } from "../components/StatusBadge";
import { netSalary, salaryValues } from "../lib/salary";

type Detail = {
  id: number; employee_code: string; full_name: string; father_name: string | null;
  email: string | null; phone: string | null; designation: string;
  joining_date: string; leaving_date: string | null; employment_type: string;
  status: string; salary_currency: string;
  basic_salary: number | null; allowances: number | null; deductions: number | null;
  cnic: string | null; address: string | null; bank_name: string | null; bank_account: string | null;
  department_id: number | null;
  assigned_project: string | null;
  assigned_role: string | null;
  system_role: string | null;
};

const STATUSES = ["internee", "probation", "permanent", "active", "inactive", "resigned", "terminated"];

export default function EmployeeProfile({ id, currentUserRole, onBack, onOpenSettings }: { id: number; currentUserRole: string; onBack: () => void; onOpenSettings: () => void }) {
  const [emp, setEmp] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [profileSection, setProfileSection] = useState<"overview" | "attendance" | "letters">("overview");
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode | null>(null);
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [gateAction, setGateAction] = useState<"edit" | "delete" | "promote" | null>(null);
  const [revealPass, setRevealPass] = useState("");
  const [edit, setEdit] = useState<any>({});

  const load = useCallback(async () => {
    const [detail, attendance] = await Promise.all([
      api<{ employee: Detail }>(`/api/employees/${id}`),
      getAttendanceEmployeeOverview(id, new Date().toLocaleDateString("en-CA")).catch(() => null),
    ]);
    setEmp(detail.employee);
    setAttendanceMode(attendance?.settings.attendanceMode ?? null);
  }, [id]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  function beginEdit() {
    if (!emp) return;
    setEdit({
      employee_code: emp.employee_code ?? "",
      full_name: emp.full_name ?? "", father_name: emp.father_name ?? "",
      email: emp.email ?? "", phone: emp.phone ?? "", designation: emp.designation ?? "",
      joining_date: String(emp.joining_date).slice(0, 10), status: emp.status,
      cnic: emp.cnic ?? "", address: emp.address ?? "",
      bank_name: emp.bank_name ?? "", bank_account: emp.bank_account ?? "",
      salary_currency: emp.salary_currency ?? "PKR",
      basic_salary: emp.basic_salary ?? "", allowances: emp.allowances ?? "", deductions: emp.deductions ?? "",
      password: "",
    });
  }

  async function requestGate(action: "edit" | "delete" | "promote") {
    setError("");
    if (await hasSuperAuthorization()) {
      try { if (action === "edit") { beginEdit(); setEditMode(true); } else if (action === "delete") await doDelete(""); else await promoteToAdmin(""); }
      catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); }
      return;
    }
    setGateAction(action);
    setGateOpen(true);
  }

  async function submitGate() {
    if (!revealPass) return setError("Enter the Super Password");
    setBusy(true);
    setError("");
    try {
      await api("/api/security/super-password/verify", {
        method: "POST",
        body: JSON.stringify({ password: revealPass }),
      });
      setGateOpen(false);
      setRevealPass("");
      if (gateAction === "edit") { beginEdit(); setEditMode(true); }
      else if (gateAction === "delete") { await doDelete(revealPass); setRevealPass(""); }
      else if (gateAction === "promote") { await promoteToAdmin(revealPass); setRevealPass(""); }
      setGateAction(null);
    } catch (e: any) {
      setRevealPass("");
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function setE(key: string, value: string) {
    setEdit((f: any) => ({ ...f, [key]: value }));
  }

  async function saveEdit() {
    setError("");
    const today = new Date().toLocaleDateString("en-CA");
    if (!edit.employee_code || !String(edit.employee_code).trim()) {
      return setError("Employee code cannot be empty");
    }
    if (edit.designation && /\d/.test(edit.designation)) {
      return setError("Designation cannot contain numbers (text only)");
    }
    if (edit.joining_date && edit.joining_date > today) {
      return setError("Joining date cannot be a future date");
    }
    const cleanCnic = edit.cnic ? String(edit.cnic).replace(/\D/g, "") : null;
    if (cleanCnic && cleanCnic.length !== 13) {
      return setError("CNIC must be exactly 13 digits (numbers only)");
    }
    const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (edit.email && edit.email.trim() && !EMAIL_REGEX.test(edit.email.trim())) {
      return setError("Please enter a valid email address (e.g. name@example.com)");
    }
    if (edit.phone && edit.phone.trim()) {
      const cleanPhone = edit.phone.replace(/\D/g, "");
      if (!/^[+]?[\d\s\-()]+$/.test(edit.phone.trim()) || cleanPhone.length < 10 || cleanPhone.length > 15) {
        return setError("Please enter a valid phone number (10-15 digits, e.g. 0300-1234567)");
      }
    }

    let salary;
    try { salary = salaryValues(edit); }
    catch (caught) { return setError(caught instanceof Error ? caught.message : "Invalid salary"); }
    setBusy(true);
    try {
      await api(`/api/employees/${id}`, {
        method: "PUT",
        headers: superPasswordHeaders(revealPass),
        body: JSON.stringify({
          ...edit,
          employee_code: String(edit.employee_code).trim(),
          cnic: cleanCnic,
          password: edit.password && String(edit.password).trim() ? String(edit.password).trim() : undefined,
          father_name: edit.father_name || null,
          email: edit.email?.trim() || null,
          phone: edit.phone?.trim() || null,
          ...salary,
        }),
      });
      setEditMode(false);
      setRevealPass("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(superPassword: string) {
    if (!confirm(`Delete ${emp?.full_name}? This cannot be undone.`)) return;
    try {
      await api(`/api/employees/${id}`, { method: "DELETE", headers: superPasswordHeaders(superPassword) });
      onBack();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function promoteToAdmin(superPassword: string) {
    try {
      const demoting = emp?.system_role === "admin";
      if (demoting && !window.confirm("Remove Admin privileges and return this user to Employee access? Employee data and history will remain unchanged.")) return;
      await api(`/api/employees/${id}/${demoting ? "demote" : "promote"}`, {
        method: "POST",
        headers: superPasswordHeaders(superPassword),
      });
      await load();
    } catch (e: any) {
      setRevealPass("");
      setError(e.message);
    }
  }

  if (!emp) return <div className="content">{error && <p className="error-text">{error}</p>}</div>;

  const net = netSalary(emp.basic_salary, emp.allowances, emp.deductions);
  const editNet = netSalary(edit.basic_salary, edit.allowances, edit.deductions);

  const rows: [string, string][] = [
    ["Employee code", emp.employee_code],
    ["Full name", emp.full_name],
    ["Father's name", emp.father_name ?? "—"],
    ["Designation", emp.designation],
    ["Status", emp.status],
    ["Role", emp.assigned_role ?? "No role assigned"],
    ["System access", emp.system_role === "admin" ? "Admin + Employee" : "Employee"],
    ["Project", emp.assigned_project ?? "No project assigned"],
    ["Email", emp.email ?? "—"],
    ["Phone", emp.phone ?? "—"],
    ["Joining date", String(emp.joining_date).slice(0, 10)],
    ["CNIC", emp.cnic ?? "—"],
    ["Address", emp.address ?? "—"],
    ["Bank", `${emp.bank_name ?? "—"}${emp.bank_account ? ` · ${emp.bank_account}` : ""}`],
    ["Basic salary", emp.basic_salary != null ? `${emp.salary_currency} ${Number(emp.basic_salary).toLocaleString()}` : "—"],
    ["Allowances", emp.allowances != null ? `${emp.salary_currency} ${Number(emp.allowances).toLocaleString()}` : "—"],
    ["Deductions", emp.deductions != null ? `${emp.salary_currency} ${Number(emp.deductions).toLocaleString()}` : "—"],
    ["Net salary", [emp.basic_salary, emp.allowances, emp.deductions].some(value => value != null) ? `${emp.salary_currency} ${net.toLocaleString()}` : "—"],
  ];

  return (
    <div className="content">
        <button className="fin-btn-secondary fin-back-button portal-back-button" onClick={onBack}><LuArrowLeft size={15} aria-hidden="true" /> Back to employees</button>
      <header className="employee-profile-hero">
        <div className="employee-profile-identity">
          <span className="employee-profile-avatar" aria-hidden="true">{emp.full_name.trim().charAt(0).toUpperCase()}</span>
          <div><p className="attendance-kicker">Employee profile</p><h1 className="page-title">{emp.full_name}</h1><p className="page-sub">{emp.employee_code} · {emp.designation} · {emp.assigned_project ?? "No project assigned"}</p><div className="employee-profile-badges"><StatusBadge value={emp.status} />{attendanceMode && <AttendanceModeBadge mode={attendanceMode} />}</div></div>
        </div>
        <div className="employee-profile-actions">
          <button className="btn-download" onClick={() => downloadPdf(`/api/reports/employee/${id}.pdf`, `Ashtech-Employee-${emp.employee_code}.pdf`)}>
            ⬇ Download PDF
          </button>
          {!editMode && profileSection === "overview" && (
            <div className="detail-actions">
              <button className="btn-sm" onClick={() => requestGate("edit")}>Edit</button>
              {currentUserRole === "super_admin" && ["employee", "admin"].includes(emp.system_role ?? "") && (
                <button className="fin-btn-secondary" onClick={() => requestGate("promote")}>{emp.system_role === "admin" ? <LuUserMinus size={15} /> : <LuUserPlus size={15} />}{emp.system_role === "admin" ? "Demote to Employee" : "Make Admin"}</button>
              )}
              <button className="btn-sm btn-sm-danger" onClick={() => requestGate("delete")}>Delete</button>
            </div>
          )}
        </div>
      </header>

      <div className="profile-section-tabs" role="tablist" aria-label="Employee profile sections">
        <button className={profileSection === "overview" ? "active" : ""} onClick={() => setProfileSection("overview")}>Overview</button>
        <button className={profileSection === "attendance" ? "active" : ""} onClick={() => { setProfileSection("attendance"); setEditMode(false); setGateOpen(false); }}>Attendance</button>
        <button className={profileSection === "letters" ? "active" : ""} onClick={() => { setProfileSection("letters"); setEditMode(false); setGateOpen(false); }}>Letters</button>
      </div>

      {profileSection === "overview" && gateOpen && (
        <div className="reveal-gate">
          <div className="form-title">Confirm with Super Password</div>
          <div className="unlock-row">
            <input type="password" className="field-input" placeholder="Super Password"
              value={revealPass} onChange={(e) => setRevealPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitGate()} />
            <button className="btn-primary" style={{ width: "auto", padding: "0 20px" }} onClick={submitGate} disabled={busy}>
              {busy ? "Checking…" : "Confirm"}
            </button>
            <button className="btn-sm" onClick={() => { setGateOpen(false); setGateAction(null); setRevealPass(""); setError(""); }}>Cancel</button>
          </div>
          {error && <p className="error-text">{error}</p>}
          <p className="unlock-note">Required for this protected operation only.</p>
        </div>
      )}

      {profileSection === "letters" ? (
        <EmployeeLetters employee={emp} readOnly />
      ) : profileSection === "attendance" ? (
        <EmployeeAttendanceProfile employeeId={id} onOpenSettings={onOpenSettings} embedded />
      ) : editMode ? (
        <div className="form-card">
          <div className="form-title">Edit employee</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Employee code</label>
              <input className="field-input" value={edit.employee_code} onChange={(e) => setE("employee_code", e.target.value)} placeholder="ASH-001" />
              <span style={{ fontSize: "11px", color: "var(--ui-muted)", marginTop: "2px", display: "block" }}>Changing this does not affect login credentials</span>
            </div>
            <div><label className="field-label">Full name</label>
              <input className="field-input" value={edit.full_name} onChange={(e) => setE("full_name", e.target.value)} /></div>
            <div><label className="field-label">Father's name</label>
              <input className="field-input" value={edit.father_name} onChange={(e) => setE("father_name", e.target.value)} /></div>
            <div><label className="field-label">Designation</label>
              <input className="field-input" value={edit.designation} onChange={(e) => setE("designation", e.target.value)} /></div>
            <div><label className="field-label">Status</label>
              <select className="field-input" value={edit.status} onChange={(e) => setE("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><label className="field-label">Email</label>
              <input className="field-input" value={edit.email} onChange={(e) => setE("email", e.target.value)} /></div>
            <div><label className="field-label">Phone</label>
              <input className="field-input" value={edit.phone} onChange={(e) => setE("phone", e.target.value)} /></div>
            <div><label className="field-label">Joining date</label>
              <input type="date" className="field-input" max={new Date().toLocaleDateString("en-CA")} value={edit.joining_date} onChange={(e) => setE("joining_date", e.target.value)} /></div>
            <div><label className="field-label">CNIC</label>
              <input className="field-input" value={edit.cnic} onChange={(e) => setE("cnic", e.target.value)} placeholder="3740512345671" /></div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="field-label">Login password</label>
                <button
                  type="button"
                  onClick={() => setShowEditPassword(s => !s)}
                  style={{ background: "none", border: "none", color: "var(--ui-accent)", fontSize: "12px", cursor: "pointer", padding: "0 2px", fontWeight: 600 }}
                >
                  {showEditPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                className="field-input"
                type={showEditPassword ? "text" : "password"}
                value={edit.password ?? ""}
                onChange={(e) => setE("password", e.target.value)}
                placeholder="Leave blank to keep unchanged"
              />
              <span style={{ fontSize: "11px", color: "var(--ui-muted)", marginTop: "2px", display: "block" }}>
                Set new password for CNIC login · Stored as bcrypt hash
              </span>
            </div>
            <div><label className="field-label">Address</label>
              <input className="field-input" value={edit.address} onChange={(e) => setE("address", e.target.value)} /></div>
            <div><label className="field-label">Bank name</label>
              <input className="field-input" value={edit.bank_name} onChange={(e) => setE("bank_name", e.target.value)} /></div>
            <div><label className="field-label">Bank account</label>
              <input className="field-input" value={edit.bank_account} onChange={(e) => setE("bank_account", e.target.value)} /></div>
            <div><label className="field-label">Basic salary</label>
              <input type="number" className="field-input" value={edit.basic_salary} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setE("basic_salary", e.target.value)} /></div>
            <div><label className="field-label">Allowances</label>
              <input type="number" className="field-input" value={edit.allowances} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setE("allowances", e.target.value)} /></div>
            <div><label className="field-label">Deductions</label>
              <input type="number" className="field-input" value={edit.deductions} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setE("deductions", e.target.value)} /></div>
            <div><label className="field-label">Salary currency</label>
              <select className="field-input" value={edit.salary_currency} onChange={(e) => setE("salary_currency", e.target.value)}>
                {["PKR", "USD", "AED", "EUR", "GBP", "SAR"].map((c) => <option key={c}>{c}</option>)}
              </select></div>
          </div>
          <div className="net-preview">Net salary: {edit.salary_currency} {editNet.toLocaleString()}</div>
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} onClick={saveEdit} disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </button>
            <button className="btn-sm" onClick={() => { setEditMode(false); setRevealPass(""); setError(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="detail-grid">
          {rows.map(([label, value]) => (
            <div className="detail-row" key={label}>
              <div className="detail-label">{label}</div>
              <div className="detail-value">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
