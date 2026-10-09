import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { downloadPdf } from "../lib/api";
import { getMyApplications, openApplicationPreview, submitApplication } from "../lib/applicationApi";
import type { ApplicationPayload, GeneralApplication } from "../lib/applicationApi";

const CATEGORIES = ["General Request", "Work From Home", "Equipment", "Payroll", "HR", "Other"];
const today = () => new Date().toLocaleDateString("en-CA");

export default function GeneralApplications() {
  const [items, setItems] = useState<GeneralApplication[]>([]);
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [applicationDate, setApplicationDate] = useState(today());
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => setItems((await getMyApplications()).applications), []);
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load applications")); }, [load]);

  function payload(): ApplicationPayload {
    return { category, subject: subject.trim(), application_date: applicationDate, body: body.trim() };
  }

  function validate() {
    if (!category.trim() || subject.trim().length < 3 || !applicationDate || body.trim().length < 10) return "Complete the application type, subject, date, and message.";
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true); setError(""); setSuccess("");
    try {
      await submitApplication(payload());
      setSubject(""); setBody(""); setCategory(CATEGORIES[0]); setApplicationDate(today());
      await load();
      setSuccess("Application submitted for review.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to submit application"); }
    finally { setBusy(false); }
  }

  async function preview() {
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true); setError("");
    try { await openApplicationPreview(payload()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to preview application"); }
    finally { setBusy(false); }
  }

  return <div className="application-layout">
    <section className="leave-form-card">
      <div className="leave-section-heading"><p className="attendance-kicker">New application</p><h2>Write to management</h2><p>Your identity is taken securely from your employee account.</p></div>
      <form className="leave-form" onSubmit={submit}>
        <div className="leave-form-grid">
          <label>Application type<select className="field-input" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Date<input className="field-input" type="date" max={today()} value={applicationDate} onChange={(event) => setApplicationDate(event.target.value)} /></label>
        </div>
        <label>Subject<input className="field-input" maxLength={200} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A concise subject" /></label>
        <label>Application<textarea className="field-input application-body" rows={10} maxLength={12000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your application here…" /></label>
        {error && <p className="attendance-action-error">{error}</p>}{success && <p className="attendance-success">{success}</p>}
        <div className="inline-actions"><button type="button" className="btn-download" disabled={busy} onClick={preview}>Preview PDF</button><button className="btn-primary" disabled={busy}>{busy ? "Working…" : "Submit application"}</button></div>
      </form>
    </section>
    <section className="leave-list-section">
      <div className="leave-section-heading"><p className="attendance-kicker">My applications</p><h2>Application history</h2></div>
      <div className="application-history">{items.map((item) => <article className="application-card" key={item.id}><div><span className={`leave-status leave-status-${item.status}`}>{item.status}</span><h3>{item.subject}</h3><p>{item.category} · {String(item.application_date).slice(0, 10)}</p><small>Submitted {new Date(item.submitted_at).toLocaleString("en-PK")}{item.reviewed_by_name ? ` · Reviewed by ${item.reviewed_by_name}` : ""}</small>{item.review_note && <div className="application-note">Review note: {item.review_note}</div>}</div><button className="btn-sm" onClick={() => downloadPdf(`/api/applications/me/${item.id}/pdf`, `Application-${item.id}.pdf`)}>Download PDF</button></article>)}{!items.length && <p className="leave-empty">No applications have been submitted.</p>}</div>
    </section>
  </div>;
}
