import { useState } from "react";
import { LuMail, LuLockKeyhole, LuEye, LuEyeOff } from "react-icons/lu";
import { api } from "../lib/api";
import type { AuthResponse, AuthUser } from "../types/auth";
import ThemeToggle from "../components/ThemeToggle";

export default function Login({ onLogin, theme, onToggleTheme }: { onLogin: (u: AuthUser) => void; theme: "light" | "dark"; onToggleTheme: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetCnic, setResetCnic] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetLoading, setResetLoading] = useState(false);

  async function submit() {
    if (!email || !password) return setError("Enter your email and password");
    setError("");
    setLoading(true);
    try {
      const data = await api<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      sessionStorage.removeItem("ems_tab");
      sessionStorage.removeItem("ems_employee_tab");
      sessionStorage.setItem("ems_token", data.token);
      onLogin(data.user);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function closeReset() {
    setResetOpen(false);
    setResetCnic("");
    setResetPassword("");
    setResetConfirmation("");
    setResetMessage("");
    setResetError("");
  }

  async function submitReset() {
    const cleanCnic = resetCnic.replace(/\D/g, "");
    if (cleanCnic.length !== 13) return setResetError("Enter a valid 13-digit CNIC");
    if (resetPassword.length < 10) return setResetError("New password must be at least 10 characters");
    if (resetPassword !== resetConfirmation) return setResetError("New password and confirmation do not match");
    setResetError("");
    setResetMessage("");
    setResetLoading(true);
    try {
      const data = await api<{ message: string }>("/api/password-resets/request", {
        method: "POST",
        body: JSON.stringify({
          cnic: cleanCnic,
          new_password: resetPassword,
          confirm_password: resetConfirmation,
        }),
      });
      setResetPassword("");
      setResetConfirmation("");
      setResetCnic("");
      setResetMessage(data.message);
    } catch (caught) {
      setResetPassword("");
      setResetConfirmation("");
      setResetError(caught instanceof Error ? caught.message : "Unable to submit the reset request");
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="login-page">
      <header className="login-topbar">
        <div className="topbar-brand">
          <img src="/logo.png" alt="Ashtech" className="topbar-logo" onError={(event) => { (event.target as HTMLImageElement).style.display = "none"; }} />
          <div className="brand-text"><div className="company-name"><span className="company-name-primary">Ashtech Digital</span>{" "}<span className="company-name-secondary">Solutions</span></div><div className="portal-sub">EMS Portal</div></div>
        </div>
        <ThemeToggle theme={theme} onToggle={onToggleTheme} compact />
      </header>
      <main className="login-wrap">
      <div className="login-box">
        <div className="login-brand-block">
          <img
            src="/logo.png"
            alt="Ashtech Digital Solutions"
            className="login-logo"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="login-company-name">Ashtech Digital Solutions</div>
          <div className="login-portal-name">EMS Portal</div>
        </div>
        <h1 className="login-title">{resetOpen ? "Request password reset" : "Sign in"}</h1>
        <p className="login-subtitle">{resetOpen ? "Create a secure request for administrator review." : "Sign in to continue to your EMS workspace."}</p>
        {resetOpen ? (
          <>
            <p className="login-reset-intro">Submit a new password for Admin review. Your password is never shown to reviewers.</p>
            <label className="field-label">CNIC Number</label>
            <input
              type="text"
              inputMode="numeric"
              value={resetCnic}
              onChange={(e) => setResetCnic(e.target.value.replace(/\D/g, "").slice(0, 13))}
              placeholder="13-digit CNIC"
              className="field-input"
              autoComplete="username"
            />
            <label className="field-label">New Password</label>
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Minimum 10 characters"
              className="field-input"
              autoComplete="new-password"
            />
            <label className="field-label">Confirm New Password</label>
            <input
              type="password"
              value={resetConfirmation}
              onChange={(e) => setResetConfirmation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitReset()}
              placeholder="Repeat the new password"
              className="field-input"
              autoComplete="new-password"
            />
            {resetError && <p className="error-text">{resetError}</p>}
            {resetMessage && <p className="success-text">{resetMessage}</p>}
            <button onClick={submitReset} disabled={resetLoading || Boolean(resetMessage)} className="btn-primary">
              {resetLoading ? "Submitting…" : "Submit for review"}
            </button>
            <button type="button" className="login-link-button" onClick={closeReset}>Back to sign in</button>
          </>
        ) : (
          <>
        <label className="field-label">Email / CNIC</label>
        <div className="login-input-wrap">
        <LuMail className="login-input-icon" size={17} aria-hidden="true" />
        <input
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          className="field-input"
        />
        </div>
        <label className="field-label">Password</label>
        <div className="login-input-wrap login-password-wrap">
        <LuLockKeyhole className="login-input-icon" size={17} aria-hidden="true" />
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Your password"
          className="field-input"
        />
        <button type="button" className="login-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <LuEyeOff size={17} /> : <LuEye size={17} />}</button>
        </div>
        <button
          type="button"
          className="login-link-button login-forgot-password"
          onClick={() => {
            setResetOpen(true);
            setError("");
          }}
        >
          Forgot Password?
        </button>
        {error && <p className="error-text">{error}</p>}
        <button onClick={submit} disabled={loading} className="btn-primary">
          {loading ? "Signing in..." : "Sign in"}
        </button>
          </>
        )}
        <p className="footer-note">Authorized access only · Ashtech Digital Solutions</p>
      </div>
      </main>
    </div>
  );
}
