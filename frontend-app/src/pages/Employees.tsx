import { useCallback, useEffect, useState } from "react";
import { api, downloadPdf } from "../lib/api";
import EmployeeProfile from "./EmployeeProfile";
import { LuPlus } from "react-icons/lu";
import { netSalary, salaryValues } from "../lib/salary";
import { getAttendanceEmployees } from "../lib/attendanceEmployeesApi";
import type { AttendanceMode } from "../types/attendance";
import { AttendanceModeBadge, StatusBadge } from "../components/StatusBadge";

type EmployeeRow = {
  id: number; employee_code: string; full_name: string; designation: string;
  status: string; joining_date: string; department: string | null;
  attendance_mode?: AttendanceMode;
};

const STATUSES = ["active", "resigned", "terminated"];

const emptyForm = {
  employee_code: "", full_name: "", father_name: "", email: "", phone: "",
  designation: "", joining_date: "", status: "active", cnic: "", address: "",
  bank_name: "", bank_account: "", salary_currency: "PKR",
  basic_salary: "", allowances: "", deductions: "",
  password: "ash@001",
  attendance_mode: "remote",
};

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function isValidPhone(p: string): boolean {
  if (!p.trim()) return true;
  const digits = p.replace(/\D/g, "");
  return /^[+]?[\d\s\-()]+$/.test(p.trim()) && digits.length >= 10 && digits.length <= 15;
}

function isValidEmail(e: string): boolean {
  if (!e.trim()) return true;
  return EMAIL_REGEX.test(e.trim());
}

function formatCnic(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
}

export default function Employees({ currentUserRole, onOpenSettings, initialStatus, navigationKey }: { currentUserRole: string; onOpenSettings: () => void; initialStatus?: string; navigationKey?: number }) {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState<"all" | AttendanceMode>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (initialStatus && STATUSES.includes(initialStatus)) {
      setStatusFilter(initialStatus);
      setSearch("");
      setModeFilter("all");
    }
  }, [initialStatus, navigationKey]);

  const today = new Date().toLocaleDateString("en-CA");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, attendance] = await Promise.all([
        api<{ employees: EmployeeRow[] }>("/api/employees"),
        getAttendanceEmployees(today).catch(() => null),
      ]);
      const modes = new Map(attendance?.employees.map((employee) => [employee.employeeId, employee.attendanceMode]));
      setEmployees(data.employees.map((employee) => ({ ...employee, attendance_mode: modes.get(employee.id) })));
    } finally {
      setLoading(false);
    }
  }, [today]);
  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  function set(key: keyof typeof emptyForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const net = netSalary(form.basic_salary, form.allowances, form.deductions);

  function resetForm() {
    setForm({ ...emptyForm });
    setFieldErrors({});
    setError("");
  }

  async function save() {
    setError("");
    const newErrors: Record<string, string> = {};

    if (!form.employee_code.trim()) {
      newErrors.employee_code = "Employee code is required";
    }

    if (!form.full_name.trim()) {
      newErrors.full_name = "Full name is required";
    }

    if (!form.designation.trim()) {
      newErrors.designation = "Designation is required";
    } else if (/\d/.test(form.designation)) {
      newErrors.designation = "Designation cannot contain numbers (text only)";
    }

    if (!form.joining_date) {
      newErrors.joining_date = "Joining date is required";
    } else if (form.joining_date > today) {
      newErrors.joining_date = "Joining date cannot be a future date";
    }

    const cleanCnic = form.cnic.replace(/\D/g, "");
    if (!cleanCnic || cleanCnic.length !== 13) {
      newErrors.cnic = "CNIC is required and must be exactly 13 digits";
    }

    if (form.phone.trim() && !isValidPhone(form.phone)) {
      newErrors.phone = "Please enter a valid phone number (10-15 digits, e.g. 0300-1234567 or +92 300 1234567)";
    }

    if (form.email.trim() && !isValidEmail(form.email)) {
      newErrors.email = "Please enter a valid email address (e.g. name@example.com)";
    }

    let salary;
    try { salary = salaryValues(form); }
    catch (caught) { return setError(caught instanceof Error ? caught.message : "Invalid salary"); }
    if (Object.keys(newErrors).length > 0) {
      setFieldErrors(newErrors);
      setError(Object.values(newErrors)[0]);
      return;
    }

    setSaving(true);
    try {
      await api("/api/employees", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          cnic: cleanCnic,
          password: form.password?.trim() || "ash@001",
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          ...salary,
        }),
      });
      resetForm();
      setShowForm(false);
      await load();
    } catch (e: any) {
      setError(e.message);
      if (e.message && e.message.toLowerCase().includes("cnic")) {
        setFieldErrors(prev => ({ ...prev, cnic: e.message }));
      } else if (e.message && e.message.toLowerCase().includes("employee code")) {
        setFieldErrors(prev => ({ ...prev, employee_code: e.message }));
      }
    } finally {
      setSaving(false);
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  if (selectedId) {
    return <EmployeeProfile id={selectedId} currentUserRole={currentUserRole} onOpenSettings={onOpenSettings} onBack={() => { setSelectedId(null); load(); }} />;
  }

  // ADD FORM VIEW — show only the form, not the table
  if (showForm) {
    return (
      <div className="content">
        <div className="content-head">
          <h1 className="page-title">Add employee</h1>
          <button className="btn-sm" onClick={() => { resetForm(); setShowForm(false); }}>Close</button>
        </div>

        <div className="form-card">
          <div className="form-title">New employee</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Employee code *</label>
              <input
                className="field-input"
                value={form.employee_code}
                onChange={(e) => {
                  set("employee_code", e.target.value);
                  if (fieldErrors.employee_code) setFieldErrors(prev => ({ ...prev, employee_code: "" }));
                }}
                placeholder="ASH-001"
              />
              {fieldErrors.employee_code && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.employee_code}</span>}
            </div>

            <div>
              <label className="field-label">Full name *</label>
              <input
                className="field-input"
                value={form.full_name}
                onChange={(e) => {
                  set("full_name", e.target.value);
                  if (fieldErrors.full_name) setFieldErrors(prev => ({ ...prev, full_name: "" }));
                }}
              />
              {fieldErrors.full_name && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.full_name}</span>}
            </div>

            <div>
              <label className="field-label">Father's name</label>
              <input className="field-input" value={form.father_name} onChange={(e) => set("father_name", e.target.value)} />
            </div>

            <div>
              <label className="field-label">Designation *</label>
              <input
                className="field-input"
                value={form.designation}
                onChange={(e) => {
                  const val = e.target.value;
                  set("designation", val);
                  if (/\d/.test(val)) {
                    setFieldErrors(prev => ({ ...prev, designation: "Designation cannot contain numbers (text only)" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, designation: "" }));
                  }
                }}
                placeholder="e.g. Software Developer"
              />
              {fieldErrors.designation && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.designation}</span>}
            </div>

            <div>
              <label className="field-label">Status</label>
              <select className="field-input" value={form.status} onChange={(e) => set("status", e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <label className="employee-attendance-mode-toggle">
              <input
                type="checkbox"
                checked={form.attendance_mode === "gps"}
                onChange={(event) => set("attendance_mode", event.target.checked ? "gps" : "remote")}
              />
              <span><strong>GPS / Office Employee</strong><small>Require office location validation for attendance check-in.</small></span>
            </label>

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
                  // Reject random words or alphabetic characters: allow digits, +, spaces, hyphens, parentheses only
                  if (/^[+0-9\s\-()]*$/.test(val)) {
                    set("phone", val);
                    if (val.trim() && !isValidPhone(val)) {
                      setFieldErrors(prev => ({ ...prev, phone: "Please enter a valid phone number (10-15 digits, e.g. 0300-1234567)" }));
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
              <label className="field-label">Joining date *</label>
              <input
                type="date"
                className="field-input"
                max={today}
                value={form.joining_date}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val && val > today) {
                    setFieldErrors(prev => ({ ...prev, joining_date: "Joining date cannot be a future date" }));
                    return;
                  }
                  setFieldErrors(prev => ({ ...prev, joining_date: "" }));
                  set("joining_date", val);
                }}
              />
              {fieldErrors.joining_date && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.joining_date}</span>}
            </div>

            <div>
              <label className="field-label">CNIC *</label>
              <input
                className="field-input"
                value={formatCnic(form.cnic)}
                onChange={(e) => {
                  // Numbers only, capped at 13 digits; dashes are display-only
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
                  set("cnic", digits);
                  if (digits.length > 0 && digits.length < 13) {
                    setFieldErrors(prev => ({ ...prev, cnic: "CNIC must be exactly 13 digits (numbers only)" }));
                  } else {
                    setFieldErrors(prev => ({ ...prev, cnic: "" }));
                  }
                }}
                placeholder="37405-1234567-1"
                maxLength={15}
              />
              {fieldErrors.cnic && <span className="error-text" style={{ fontSize: "12px", display: "block" }}>{fieldErrors.cnic}</span>}
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="field-label">Login password *</label>
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  style={{ background: "none", border: "none", color: "var(--ui-accent)", fontSize: "12px", cursor: "pointer", padding: "0 2px", fontWeight: 600 }}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                className="field-input"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="ash@001"
              />
              <span style={{ fontSize: "11px", color: "var(--ui-muted)", marginTop: "2px", display: "block" }}>
                Default: ash@001 · Stored as bcrypt hash
              </span>
            </div>

            <div>
              <label className="field-label">Address</label>
              <input className="field-input" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </div>

            <div>
              <label className="field-label">Bank name</label>
              <input className="field-input" value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
            </div>

            <div>
              <label className="field-label">Bank account</label>
              <input className="field-input" value={form.bank_account} onChange={(e) => set("bank_account", e.target.value)} />
            </div>

            <div>
              <label className="field-label">Basic salary</label>
              <input
                type="number"
                className="field-input"
                value={form.basic_salary}
                onWheel={handleWheel}
                onChange={(e) => set("basic_salary", e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Allowances</label>
              <input
                type="number"
                className="field-input"
                value={form.allowances}
                onWheel={handleWheel}
                onChange={(e) => set("allowances", e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Deductions</label>
              <input
                type="number"
                className="field-input"
                value={form.deductions}
                onWheel={handleWheel}
                onChange={(e) => set("deductions", e.target.value)}
              />
            </div>

            <div>
              <label className="field-label">Salary currency</label>
              <select className="field-input" value={form.salary_currency} onChange={(e) => set("salary_currency", e.target.value)}>
                {["PKR", "USD", "AED", "EUR", "GBP", "SAR"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {(form.basic_salary || form.allowances || form.deductions) && (
            <div className="net-preview">Net salary: {form.salary_currency} {net.toLocaleString()}</div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save employee"}
            </button>
            <button className="btn-sm" style={{ marginTop: 0 }} onClick={() => { resetForm(); setShowForm(false); }}>Close</button>
          </div>
        </div>
      </div>
  );
  }

  // LIST VIEW
  const query = search.trim().toLowerCase();
  const filteredEmployees = employees.filter((employee) => {
    const matchesSearch = !query || [employee.full_name, employee.employee_code, employee.designation, employee.department ?? ""]
      .some((value) => value.toLowerCase().includes(query));
    const matchesStatus = statusFilter === "all" || employee.status === statusFilter;
    const matchesMode = modeFilter === "all" || employee.attendance_mode === modeFilter;
    return matchesSearch && matchesStatus && matchesMode;
  });

  return (
    <div className="content">
      <div className="content-head">
        <h1 className="page-title">Employees</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-download" onClick={() => downloadPdf("/api/reports/employees.pdf", "Ashtech-Employees.pdf")}>
            ⬇ Download PDF
          </button>
          <button className="fin-btn-primary"
            onClick={() => setShowForm(true)}>
            <LuPlus size={15} aria-hidden="true" /> Add employee
          </button>
        </div>
      </div>

      <div className="employee-directory-filters" aria-label="Employee filters">
        <label className="employee-search"><span className="sr-only">Search employees</span><input className="field-input" type="search" placeholder="Search by name, ID, designation or department" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label><span className="sr-only">Filter by status</span><select className="field-input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        <label><span className="sr-only">Filter by attendance mode</span><select className="field-input" value={modeFilter} onChange={(event) => setModeFilter(event.target.value as "all" | AttendanceMode)}><option value="all">All attendance modes</option><option value="remote">Remote</option><option value="gps">GPS / Office</option></select></label>
      </div>

      {error && <p className="error-text">{error}</p>}
      <section className="employee-directory" aria-label="Employee directory">
        <div className="employee-directory-header" aria-hidden="true"><span>Employee</span><span>Status</span><span>Attendance Mode</span><span /></div>
        {loading ? <div className="empty-note">Loading employees…</div> : filteredEmployees.map((employee) => (
          <button type="button" className="employee-directory-row" key={employee.id} onClick={() => setSelectedId(employee.id)}>
            <span className="employee-directory-person">
              <span className="employee-avatar" aria-hidden="true">{employee.full_name.trim().charAt(0).toUpperCase()}</span>
              <span><strong>{employee.full_name}</strong><small>{employee.employee_code} · {employee.designation}</small></span>
            </span>
            <span><StatusBadge value={employee.status} /></span>
            <span><AttendanceModeBadge mode={employee.attendance_mode} /></span>
            <span className="employee-row-arrow" aria-hidden="true">›</span>
          </button>
        ))}
        {!loading && !filteredEmployees.length && <div className="empty-note">{employees.length ? "No employees match these filters." : "No employees yet — add your first one"}</div>}
      </section>
    </div>
  );
}
