import { useEffect, useRef, useState } from "react";
import { api, installSuperPasswordPrompt } from "../lib/api";
export default function SuperPasswordAuthorization() {
  const [open, setOpen] = useState(false), [password, setPassword] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void; promise: Promise<void> } | null>(null);
  useEffect(() => {
    installSuperPasswordPrompt(() => {
      if (pending.current) return pending.current.promise;
      let resolve!: () => void, reject!: (error: Error) => void;
      const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      pending.current = { resolve, reject, promise }; setPassword(""); setError(""); setOpen(true); return promise;
    });
    return () => { installSuperPasswordPrompt(null); pending.current?.reject(new Error("Session ended")); pending.current = null; };
  }, []);
  async function confirm() {
    if (!password || busy) return;
    setBusy(true); setError("");
    try {
      await api("/api/security/super-password/verify", { method: "POST", body: JSON.stringify({ password }) });
      setPassword(""); setOpen(false); pending.current?.resolve(); pending.current = null;
    } catch (caught) { setPassword(""); setError(caught instanceof Error ? caught.message : "Verification failed"); }
    finally { setBusy(false); }
  }
  if (!open) return null;
  return <div className="email-modal-backdrop"><section className="form-card email-modal" role="dialog" aria-modal="true" aria-label="Confirm with Super Password"><div className="form-title">Confirm with Super Password</div><div className="unlock-row"><input autoFocus type="password" className="field-input" placeholder="Super Password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void confirm(); }} /><button className="btn-primary" disabled={busy} onClick={() => void confirm()}>{busy ? "Checking…" : "Confirm"}</button><button className="btn-sm" disabled={busy} onClick={() => { setOpen(false); setPassword(""); pending.current?.reject(new Error("Authorization cancelled")); pending.current = null; }}>Cancel</button></div>{error && <p className="error-text">{error}</p>}</section></div>;
}
