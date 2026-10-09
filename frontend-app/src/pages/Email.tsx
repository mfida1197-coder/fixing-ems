import { useEffect, useState } from "react";
import { LuMail, LuPenLine, LuUser, LuSearch, LuPaperclip, LuSend } from "react-icons/lu";
import { api } from "../lib/api";
import { getEmailAccounts } from "../lib/emailApi";
import type { EmailAccount, EmailRecipient } from "../lib/emailApi";

export default function Email() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [recipients, setRecipients] = useState<{ clients: EmailRecipient[]; employees: EmailRecipient[] }>({ clients: [], employees: [] });
  const [sender, setSender] = useState("primary");
  const [kind, setKind] = useState("client");
  const [recipientId, setRecipientId] = useState("");
  const [search, setSearch] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => { Promise.all([getEmailAccounts(), api<typeof recipients>("/api/email/recipients")]).then(([a, r]) => { setAccounts(a.accounts); setRecipients(r); }).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const list = kind === "client" ? recipients.clients : recipients.employees;
  const recipient = list.find(item => String(item.id) === recipientId);
  async function send() {
    setError(""); setSuccess("");
    if (!subject.trim() || !(kind === "manual" ? to.trim() : recipient?.email)) return setError("A recipient email and subject are required");
    if (file && file.size > 10 * 1024 * 1024) return setError("Attachment must be 10 MB or smaller");
    const form = new FormData();
    form.set("senderAccount", sender); form.set("recipientType", kind); form.set("recipientId", recipientId); form.set("to", to); form.set("subject", subject.trim()); form.set("message", message);
    if (file) form.set("attachment", file);
    setBusy(true);
    try { await api("/api/email/send", { method: "POST", body: form }); setSuccess("Email sent successfully."); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to send email"); }
    finally { setBusy(false); }
  }
  return <main className="content email-compose-page"><div className="content-head email-page-heading"><span className="email-heading-icon"><LuMail size={23} /></span><div><h1 className="page-title">Email</h1><p className="page-sub">Compose and send company emails.</p></div></div><section className="form-card email-compose-card"><div className="form-title email-compose-title"><LuPenLine size={19} /> New Email</div>
    {loading ? <p className="empty-note">Loading…</p> : <><div className="form-grid">
      <div><label className="field-label email-from-label"><LuMail size={16} /> From Account</label><select className="field-input" value={sender} onChange={e => setSender(e.target.value)}>{accounts.map(a => <option key={a.slot} value={a.slot} disabled={a.status !== "connected"}>{a.slot === "primary" ? "Primary / Account 1" : "Secondary / Account 2"} — {a.email || "Not Connected"}</option>)}</select></div>
      <div><label className="field-label email-recipient-label"><LuUser size={16} /> Recipient Type</label><select className="field-input" value={kind} onChange={e => { setKind(e.target.value); setRecipientId(""); setSearch(""); setTo(""); }}><option value="client">Client</option><option value="employee">Employee</option><option value="manual">Manual Email</option></select></div>
      {kind !== "manual" && <div><label className="field-label"><LuUser size={14} /> Select {kind}</label><select className="field-input" value={recipientId} onChange={e => setRecipientId(e.target.value)}><option value="">Select {kind}…</option>{list.filter(r => String(r.id) === recipientId || `${r.name} ${r.email || ""}`.toLowerCase().includes(search.toLowerCase())).map(r => <option key={r.id} value={r.id}>{r.name} — {r.email || "No email"}</option>)}</select></div>}
    </div>{kind !== "manual" && <div className="email-recipient-area"><label className="field-label"><LuSearch size={14} /> Search {kind}</label><input className="field-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email…" /></div>}
    <label className="field-label"><LuMail size={14} /> To</label><input type="email" className="field-input" value={kind === "manual" ? to : recipient?.email || ""} readOnly={kind !== "manual"} onChange={e => setTo(e.target.value)} />
    <label className="field-label">Subject</label><input className="field-input" placeholder="Enter email subject…" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} />
    <label className="field-label">Message</label><textarea className="field-input email-message-area" rows={6} maxLength={50000} value={message} onChange={e => setMessage(e.target.value)} />
    <div className="email-attachment-area"><label className="field-label"><LuPaperclip size={16} /> Attachment <span className="field-help">Optional</span></label><input className="field-input" type="file" accept=".pdf,.docx,.jpg,.jpeg,.png,.webp" onChange={e => setFile(e.target.files?.[0] || null)} /><p className="field-help">PDF, DOCX, JPG, PNG, WEBP · Max 10 MB</p></div>
    <div className="email-compose-actions"><button className="btn-primary" disabled={busy || !accounts.some(a => a.slot === sender && a.status === "connected")} onClick={send}><LuSend size={17} />{busy ? "Sending…" : "Send Email"}</button></div></>}
    {error && <p className="error-text" role="alert">{error}</p>}{success && <p className="email-compose-success" role="status">{success}</p>}
  </section></main>;
}
