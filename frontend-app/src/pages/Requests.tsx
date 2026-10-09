import { useState } from "react";
import LeaveManagement from "./LeaveManagement";
import GeneralApplicationManagement from "./GeneralApplicationManagement";
import PasswordResetRequests from "./PasswordResetRequests";
import EmployeeLetterManagement from "./EmployeeLetterManagement";

type View = "leave" | "applications" | "passwords" | "letters";
export default function Requests() {
  const [view, setView] = useState<View>("leave");
  const tabs: Array<[View, string]> = [["leave", "Leave Requests"], ["applications", "Applications"], ["passwords", "Password Resets"], ["letters", "Employee Letters"]];
  return <main className="content requests-page"><div className="content-head"><div><h1 className="page-title">Requests</h1><p className="page-sub">One secure workspace for employee requests and official documents.</p></div></div><nav className="request-tabs" aria-label="Request management">{tabs.map(([id, label]) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}>{label}</button>)}</nav>{view === "leave" && <LeaveManagement />}{view === "applications" && <GeneralApplicationManagement />}{view === "passwords" && <PasswordResetRequests />}{view === "letters" && <EmployeeLetterManagement />}</main>;
}
