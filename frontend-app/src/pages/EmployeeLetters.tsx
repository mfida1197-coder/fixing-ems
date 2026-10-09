import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuSend } from "react-icons/lu";
import { api, BASE, downloadPdf } from "../lib/api";
import { getEmailAccounts } from "../lib/emailApi";
import type { EmailAccount } from "../lib/emailApi";

type LetterType = "hiring" | "promotion" | "termination";

type EmployeeForLetter = {
  id: number;
  employee_code: string;
  full_name: string;
  designation: string;
  joining_date: string;
  assigned_project: string | null;
};

type LetterHistory = {
  id: number;
  letter_type: LetterType;
  issue_date: string;
  effective_date: string;
  subject: string;
  new_designation: string | null;
  notes: string | null;
  file_name: string;
  created_at: string;
  created_by_name: string | null;
};

function today(): string {
  return new Date().toLocaleDateString("en-CA");
}

function defaultContent(type: LetterType, employee: EmployeeForLetter): { subject: string; body: string } {
  if (type === "hiring") {
    return {
      subject: `Appointment as ${employee.designation}`,
      body: `We are pleased to confirm your appointment as ${employee.designation} at Ashtech Digital Solutions${employee.assigned_project ? ` for the ${employee.assigned_project} project` : ""}.\n\nYour appointment will take effect on the date stated below and will be governed by the company's applicable policies and agreed employment terms. We look forward to your professional contribution and wish you success in your role.`,
    };
  }
  if (type === "promotion") {
    return {
      subject: "Promotion Confirmation",
      body: `We are pleased to recognize your performance and contribution to Ashtech Digital Solutions. This letter confirms your promotion from your current position of ${employee.designation} to the new designation stated below.\n\nAll other employment terms remain subject to the company's applicable policies and any separately approved compensation documentation. We congratulate you and look forward to your continued contribution.`,
    };
  }
  return {
    subject: "Termination of Employment",
    body: `This letter formally confirms the termination of your employment with Ashtech Digital Solutions from the effective date stated below.\n\nPlease complete any required handover and return company property in accordance with company policy. Any final administrative matters will be handled separately through the appropriate process.`,
  };
}

export default function EmployeeLetters({ employee, readOnly = false }: { employee: EmployeeForLetter; readOnly?: boolean }) {
  const initial = useMemo(() => defaultContent("hiring", employee), [employee]);
  const [letters, setLetters] = useState<LetterHistory[]>([]);
  const [type, setType] = useState<LetterType>("hiring");
  const [issueDate, setIssueDate] = useState(today());
  const [effectiveDate, setEffectiveDate] = useState(String(employee.joining_date).slice(0, 10) || today());
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [newDesignation, setNewDesignation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailModal, setEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailAccounts, setEmailAccounts] = useState<EmailAccount[]>([]);
  const [senderAccount, setSenderAccount] = useState("primary");
  const issueAttempt = useRef<{ payload: string; key: string } | null>(null);
  const issuing = useRef(false);
  const [issuedLetter, setIssuedLetter] = useState<{ id: number; payload: string } | null>(null);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [feedback, setFeedback] = useState("");

  async function openEmail() {
    const problem = validate();
    if (problem) return setError(problem);
    setError(""); setFeedback("");
    try {
      const [current, accounts] = await Promise.all([api<{ employee: { email: string | null } }>(`/api/employees/${employee.id}`), getEmailAccounts()]);
      if (!current.employee.email) return setError("Employee email is not available. Add an email in Employee Details before sending.");
      setEmailTo(current.employee.email); setEmailAccounts(accounts.accounts); setEmailSubject(subject); setEmailMessage(`Dear ${employee.full_name},\n\nPlease find your official ${type} letter attached.\n\nAshtech Digital Solutions`); setEmailModal(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to prepare email"); }
  }
  async function sendLetterEmail() {
    setBusy(true); setError("");
    try { await api("/api/employee-letters/send-email", { method: "POST", body: JSON.stringify({ ...payload(), ...(issuedLetter?.payload === JSON.stringify(payload()) ? { letter_id: issuedLetter.id } : {}), senderAccount, emailSubject, emailMessage }) }); setEmailModal(false); setFeedback("Email sent successfully."); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to send letter"); }
    finally { setBusy(false); }
  }

  const load = useCallback(async () => {
    const data = await api<{ letters: LetterHistory[] }>(`/api/employee-letters/employee/${employee.id}`);
    setLetters(data.letters);
  }, [employee.id]);

  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load letter history")); }, [load]);

  function changeType(nextType: LetterType) {
    const copy = defaultContent(nextType, employee);
    setType(nextType);
    setSubject(copy.subject);
    setBody(copy.body);
    setNewDesignation("");
    setNotes("");
    setEffectiveDate(nextType === "hiring" ? String(employee.joining_date).slice(0, 10) : today());
  }

  function payload() {
    return {
      employee_id: employee.id,
      letter_type: type,
      issue_date: issueDate,
      effective_date: effectiveDate,
      subject: subject.trim(),
      body: body.trim(),
      new_designation: type === "promotion" ? newDesignation.trim() : null,
      notes: notes.trim() || null,
    };
  }

  function validate(): string | null {
    if (!issueDate || !effectiveDate) return "Issue date and effective date are required";
    if (!subject.trim()) return "Subject is required";
    if (!body.trim()) return "Letter body is required";
    if (type === "promotion" && !newDesignation.trim()) return "New designation is required for a promotion letter";
    return null;
  }

  async function preview() {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const token = sessionStorage.getItem("ems_token");
      const response = await fetch(`${BASE}/api/employee-letters/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error || "Unable to preview the letter");
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to preview the letter");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (issuing.current) return;
    const problem = validate();
    if (problem) return setError(problem);
    issuing.current = true;
    setBusy(true);
    setError("");
    try {
      const serialized = JSON.stringify(payload());
      if (issueAttempt.current?.payload !== serialized) issueAttempt.current = { payload: serialized, key: crypto.randomUUID() };
      const created = await api<{ id: number; file_name: string }>("/api/employee-letters", {
        method: "POST",
        body: JSON.stringify({ ...payload(), issuance_key: issueAttempt.current.key }),
      });
      setIssuedLetter({ id: created.id, payload: serialized });
      setFeedback("Official letter sent to employee.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the letter to employee");
    } finally {
      issuing.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="employee-letters-layout">
      {!readOnly && <section className="form-card letter-compose-card">
        <div className="form-title">Create Official Letter</div>
        <div className="letter-employee-summary">
          <strong>{employee.full_name}</strong>
          <span>{employee.employee_code} · {employee.designation}{employee.assigned_project ? ` · ${employee.assigned_project}` : ""}</span>
        </div>
        <div className="form-grid letter-form-grid">
          <div>
            <label className="field-label">Letter Type</label>
            <select className="field-input" value={type} onChange={(event) => changeType(event.target.value as LetterType)}>
              <option value="hiring">Hiring Letter</option>
              <option value="promotion">Promotion Letter</option>
              <option value="termination">Termination Letter</option>
            </select>
          </div>
          <div><label className="field-label">Issue Date</label><input type="date" className="field-input" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></div>
          <div><label className="field-label">Effective Date</label><input type="date" className="field-input" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></div>
          {type === "promotion" && (
            <div><label className="field-label">New Designation</label><input className="field-input" maxLength={100} value={newDesignation} onChange={(event) => setNewDesignation(event.target.value)} /></div>
          )}
        </div>
        <label className="field-label">Subject</label>
        <input className="field-input" maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} />
        <label className="field-label">Letter Body</label>
        <textarea className="field-input letter-body-input" rows={12} maxLength={12000} value={body} onChange={(event) => setBody(event.target.value)} />
        <label className="field-label">Optional Notes</label>
        <textarea className="field-input" rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
        <p className="field-help">Generating a letter does not change the employee's designation, role, status, or employment record.</p>
        {error && <p className="error-text">{error}</p>}
        <div className="inline-actions">
          <button className="btn-download" disabled={busy} onClick={preview}>Preview PDF</button>
          <button className="btn-primary letter-generate-button" disabled={busy} onClick={generate}><LuSend size={16} />{busy ? "Working…" : "Send to Employee"}</button>
          <button className="btn-sm" disabled={busy} onClick={openEmail}>Send via Email</button>
        </div>
        {feedback && <p role="status">{feedback}</p>}
      </section>}

      {emailModal && <div className="email-modal-backdrop"><section className="form-card email-modal" role="dialog" aria-modal="true" aria-label="Send Employee Letter"><div className="form-title">Send Employee Letter</div>
        <label className="field-label">To</label><input className="field-input" readOnly value={emailTo} />
        <label className="field-label">From</label><select className="field-input" value={senderAccount} onChange={e => setSenderAccount(e.target.value)}>{emailAccounts.map(a => <option key={a.slot} value={a.slot} disabled={a.status !== "connected"}>{a.slot === "primary" ? "Primary / Account 1" : "Secondary / Account 2"} — {a.email || "Not Connected"}</option>)}</select>
        <label className="field-label">Subject</label><input className="field-input" maxLength={200} value={emailSubject} onChange={e => setEmailSubject(e.target.value)} />
        <label className="field-label">Message</label><textarea className="field-input" rows={6} value={emailMessage} onChange={e => setEmailMessage(e.target.value)} /><p className="field-help">Attachment: official {type} letter PDF</p>
        {error && <p className="error-text">{error}</p>}<div className="inline-actions"><button className="btn-primary" style={{ width: "auto", padding: "0 24px" }} disabled={busy || !emailAccounts.some(a => a.slot === senderAccount && a.status === "connected")} onClick={sendLetterEmail}>{busy ? "Sending…" : "Send Email"}</button><button className="btn-sm" disabled={busy} onClick={() => setEmailModal(false)}>Cancel</button></div>
      </section></div>}

      <section className="form-card letter-history-card">
        <div className="form-title">Letter History</div>
        <div className="letter-history-list">
          {letters.map((letter) => (
            <article className="letter-history-item" key={letter.id}>
              <div>
                <strong>{letter.letter_type.replace(/^./, (value) => value.toUpperCase())} Letter</strong>
                <div>{letter.subject}</div>
                <small>Issued {String(letter.issue_date).slice(0, 10)} · Effective {String(letter.effective_date).slice(0, 10)}</small>
                <small>Created by {letter.created_by_name || "Former administrator"} on {new Date(letter.created_at).toLocaleString("en-PK")}</small>
              </div>
              <button className="btn-sm" onClick={() => downloadPdf(`/api/employee-letters/${letter.id}/pdf`, letter.file_name)}>Download</button>
            </article>
          ))}
          {!letters.length && <div className="empty-note">No official letters generated for this employee.</div>}
        </div>
      </section>
    </div>
  );
}
