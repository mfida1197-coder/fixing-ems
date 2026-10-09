import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { connectEmailAccount, getEmailAccounts } from "../lib/emailApi";
import type { EmailAccount } from "../lib/emailApi";
export default function CompanyEmailAccounts() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => getEmailAccounts().then(r => setAccounts(r.accounts)).catch(e => setError(e.message));
  useEffect(() => { void load(); const refresh = () => { void load(); }; window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, []);
  async function action(slot: string, disconnect: boolean) {
    if (disconnect && !confirm("Disconnect this company email account?")) return;
    const popup = disconnect ? null : window.open("", "_blank");
    if (popup) popup.opener = null;
    setBusy(true); setError("");
    try {
      if (disconnect) { await api(`/api/email/accounts/${slot}`, { method: "DELETE" }); await load(); }
      else { const url = await connectEmailAccount(slot); if (popup) popup.location.replace(url); else window.location.assign(url); }
    } catch (e) { popup?.close(); setError(e instanceof Error ? e.message : "Unable to update account"); }
    finally { setBusy(false); }
  }
  return <section className="form-card"><div className="form-title">Company Email Accounts</div><p className="field-help">Connect each company account independently. Select the desired Google account when prompted.</p>
    {accounts.map(a => <div className="form-card" key={a.slot}><strong>{a.slot === "primary" ? "Primary / Account 1" : "Secondary / Account 2"}</strong><p>{a.email || "No account connected"}</p><p className="field-help">{a.status === "connected" ? "Connected" : a.status === "reconnect_required" ? "Reconnect Required" : "Not Connected"}</p><div className="inline-actions"><button className="btn-sm" disabled={busy} onClick={() => action(a.slot, false)}>{a.status === "connected" ? "Change Account" : a.status === "reconnect_required" ? "Reconnect" : "Connect"}</button>{a.email && <button className="btn-sm btn-sm-danger" disabled={busy} onClick={() => action(a.slot, true)}>Disconnect</button>}</div></div>)}
    <button className="btn-sm" disabled={busy} onClick={() => void load()}>Refresh connection status</button>{error && <p className="error-text">{error}</p>}
  </section>;
}
