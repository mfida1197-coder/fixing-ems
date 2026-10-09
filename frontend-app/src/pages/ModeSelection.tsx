import { useState } from "react";
import { api } from "../lib/api";
import type { AuthResponse, AuthUser, SessionMode } from "../types/auth";

export default function ModeSelection({
  user,
  onSelected,
  onSignOut,
}: {
  user: AuthUser;
  onSelected: (user: AuthUser) => void;
  onSignOut: () => void;
}) {
  const [busyMode, setBusyMode] = useState<SessionMode | null>(null);
  const [error, setError] = useState("");

  async function selectMode(mode: "employee" | "admin") {
    setBusyMode(mode);
    setError("");
    try {
      const response = await api<AuthResponse>("/api/auth/select-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      sessionStorage.setItem("ems_token", response.token);
      sessionStorage.removeItem("ems_tab");
      sessionStorage.removeItem("ems_employee_tab");
      onSelected(response.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyMode(null);
    }
  }

  return (
    <main className="mode-select-wrap">
      <section className="mode-select-box" aria-labelledby="mode-select-title">
        <img src="/logo.png" alt="Ashtech Digital Solutions" className="mode-select-logo" />
        <p className="mode-select-welcome">Welcome, {user.name}</p>
        <h1 id="mode-select-title" className="login-title">Choose how to continue</h1>
        <p className="page-sub mode-select-copy">
          Your account has both employee and administrator access. Choose a mode for this login session.
        </p>

        <div className="mode-select-grid">
          <button
            type="button"
            className="mode-choice"
            onClick={() => selectMode("employee")}
            disabled={busyMode !== null}
          >
            <span className="mode-choice-title">Continue as Employee</span>
            <span className="mode-choice-copy">View your employee dashboard, profile, project and personal information.</span>
          </button>
          <button
            type="button"
            className="mode-choice mode-choice-primary"
            onClick={() => selectMode("admin")}
            disabled={busyMode !== null}
          >
            <span className="mode-choice-title">Continue as Admin</span>
            <span className="mode-choice-copy">Open the EMS management areas available to administrators.</span>
          </button>
        </div>

        {busyMode && <p className="mode-select-status">Opening {busyMode} mode…</p>}
        {error && <p className="error-text">{error}</p>}
        <button type="button" className="btn-ghost mode-select-signout" onClick={onSignOut} disabled={busyMode !== null}>
          Sign Out
        </button>
      </section>
    </main>
  );
}
