import { useState } from "react";
import {
  LuLayoutDashboard,
  LuCalendarDays,
  LuFileText,
  LuDownload,
} from "react-icons/lu";
import AdminAttendanceDashboard from "./AdminAttendanceDashboard";
import AdminAttendanceEmployees, { type AttendanceDirectoryPreset } from "./AdminAttendanceEmployees";
import Holidays from "./Holidays";
import AttendanceReports from "./AttendanceReports";

type AttendanceAdminView = "dashboard" | "employees" | "holidays" | "reports";

const TABS: {
  id: AttendanceAdminView;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LuLayoutDashboard },
  { id: "holidays", label: "Holidays", icon: LuCalendarDays },
  { id: "reports", label: "Reports", icon: LuFileText },
];

export default function AttendanceAdminSection({
  onOpenPendingLeave,
  onOpenSettings,
}: {
  onOpenPendingLeave: () => void;
  onOpenSettings: () => void;
}) {
  const [view, setView] = useState<AttendanceAdminView>("dashboard");
  const [directoryPreset, setDirectoryPreset] = useState<AttendanceDirectoryPreset | null>(null);
  const [directoryDate, setDirectoryDate] = useState<string | undefined>();

  function openEmployees(preset: AttendanceDirectoryPreset, date: string) {
    setDirectoryPreset(preset);
    setDirectoryDate(date);
    setView("employees");
  }

  return (
    <div className="attendance-admin-wrapper">
      {view !== "employees" && (
        <header className="attendance-shared-header">
          <div className="admin-attendance-head">
            <div>
              <h1 className="page-title">Attendance Dashboard</h1>
              <p className="page-sub">Monitor your team's attendance, sessions and leave.</p>
            </div>
            <button
              className="btn-download admin-report-entry"
              type="button"
              onClick={() => setView("reports")}
            >
              <LuDownload size={15} style={{ marginRight: 6 }} />
              <span>Download Attendance Report</span>
            </button>
          </div>

          <nav className="attendance-section-nav request-tabs" aria-label="Attendance administration">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={view === id ? "active" : ""}
                onClick={() => setView(id)}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </header>
      )}

      {view === "dashboard" && (
        <AdminAttendanceDashboard
          onOpenReports={() => setView("reports")}
          onOpenEmployees={openEmployees}
          onOpenPendingLeave={onOpenPendingLeave}
        />
      )}
      {view === "employees" && (
        <AdminAttendanceEmployees
          initialDate={directoryDate}
          preset={directoryPreset}
          onBack={() => setView("dashboard")}
          onOpenSettings={onOpenSettings}
        />
      )}
      {view === "holidays" && <Holidays />}
      {view === "reports" && <AttendanceReports />}
    </div>
  );
}
