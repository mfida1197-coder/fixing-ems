import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AuthUser } from "../types/auth";
import { LuUser, LuMail, LuPhone, LuIdCard, LuBriefcase, LuCalendarDays, LuBuilding, LuBadgeCheck } from "react-icons/lu";
import { AttendanceOverview } from "./Attendance";
import EmployeeProjects from "./EmployeeProjects";
import { StatusBadge } from "../components/StatusBadge";

type EmployeeData = {
  id: number;
  employee_code: string;
  full_name: string;
  father_name: string | null;
  designation: string;
  department: string | null;
  joining_date: string;
  status: string;
  employment_type: string;
  email: string | null;
  phone: string | null;
  cnic: string | null;
  cnic_last4: string | null;
  salary_currency: string;
};

function formatCnic(cnic: string | null): string {
  if (!cnic) return "—";
  const d = String(cnic).replace(/\D/g, "");
  if (d.length === 13) {
    return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
  }
  return cnic;
}

export default function EmployeeDashboard({
  user,
}: {
  user: AuthUser;
}) {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [section, setSection] = useState<"personal" | "attendance" | "projects">("personal");

  useEffect(() => {
    api<{ employee: EmployeeData }>("/api/employees/me")
      .then((data) => setEmployee(data.employee))
      .catch((err) => setError(err.message || "Failed to load employee details"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="content employee-dashboard-tabs-page">
      <div className="content-head" style={{ marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <h1 className="page-title" style={{ margin: 0 }}>Employee Dashboard</h1>
            <span className="pill pill-active" style={{ textTransform: "uppercase", fontSize: "11px", fontWeight: 700 }}>
              Employee
            </span>
          </div>
          <p className="page-sub" style={{ margin: 0 }}>
            Welcome back, {employee?.full_name || user.name}
          </p>
        </div>

      </div>

      <nav className="profile-section-tabs employee-dashboard-tabs" aria-label="Dashboard sections">
        {([{ id: "personal", label: "Personal Info" }, { id: "attendance", label: "Attendance" }, { id: "projects", label: "Projects" }] as const).map((tab) => (
          <button key={tab.id} type="button" className={section === tab.id ? "active" : ""} aria-pressed={section === tab.id} aria-controls="employee-dashboard-section" onClick={() => setSection(tab.id)}>{tab.label}</button>
        ))}
      </nav>
      <div id="employee-dashboard-section">
      {section === "personal" && loading && <p style={{ color: "var(--ui-muted)" }}>Loading your information…</p>}
      {section === "personal" && error && <p className="error-text">{error}</p>}

      {section === "personal" && employee && (
        <div className="employee-self-profile">
          <header className="employee-profile-hero employee-self-profile-hero">
            <div className="employee-profile-identity">
              <span className="employee-profile-avatar" aria-hidden="true">{employee.full_name.trim().charAt(0).toUpperCase()}</span>
              <div><p className="attendance-kicker">Personal Info</p><h2>{employee.full_name}</h2><p>{employee.employee_code} · {employee.designation}</p></div>
            </div>
            <StatusBadge value={employee.status} />
          </header>

          <div className="detail-grid">
            <div className="detail-row">
              <div className="detail-label"><LuIdCard /> Employee Code</div>
              <div className="detail-value">{employee.employee_code}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuUser /> Full Name</div>
              <div className="detail-value">{employee.full_name}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuUser /> Father's Name</div>
              <div className="detail-value">{employee.father_name || "—"}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuIdCard /> CNIC (Username)</div>
              <div className="detail-value" style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {formatCnic(employee.cnic || (employee.cnic_last4 ? `•••••••••${employee.cnic_last4}` : null))}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuBriefcase /> Designation</div>
              <div className="detail-value">{employee.designation}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuBuilding /> Department</div>
              <div className="detail-value">{employee.department || "General"}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuBadgeCheck /> Employment Type</div>
              <div className="detail-value" style={{ textTransform: "capitalize" }}>
                {employee.employment_type.replace("_", " ")}
              </div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuCalendarDays /> Joining Date</div>
              <div className="detail-value">{String(employee.joining_date).slice(0, 10)}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuMail /> Email</div>
              <div className="detail-value">{employee.email || "—"}</div>
            </div>
            <div className="detail-row">
              <div className="detail-label"><LuPhone /> Phone</div>
              <div className="detail-value">{employee.phone || "—"}</div>
            </div>
          </div>
        </div>
      )}
      {section === "attendance" && <AttendanceOverview />}
      {section === "projects" && <EmployeeProjects embedded />}
      </div>
    </div>
  );
}
