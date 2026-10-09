import { useState } from "react";
import { LuPlus } from "react-icons/lu";
import Leave from "./Leave";
import GeneralApplications from "./GeneralApplications";

export default function Applications() {
  const [view, setView] = useState<"leave" | "general">("leave");
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  return <main className="content applications-page">
    <div className="content-head"><div><h1 className="page-title">Applications</h1></div><button type="button" className="btn-primary applications-new-request" onClick={() => { setView("leave"); setShowLeaveForm(true); }}><LuPlus size={18} /> New Leave Request</button></div>
    <nav className="profile-section-tabs employee-dashboard-tabs" aria-label="Employee application types"><button type="button" aria-pressed={view === "leave"} className={view === "leave" ? "active" : ""} onClick={() => setView("leave")}>Leave Requests</button><button type="button" aria-pressed={view === "general"} className={view === "general" ? "active" : ""} onClick={() => setView("general")}>Other Applications</button></nav>
    {view === "leave" ? <Leave embedded showRequestForm={showLeaveForm} onCloseRequestForm={() => setShowLeaveForm(false)} /> : <GeneralApplications />}
  </main>;
}
