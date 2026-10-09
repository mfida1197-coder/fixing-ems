import { useEffect, useState } from "react";
import { LuFileText, LuDownload, LuCalendarDays } from "react-icons/lu";
import { api, downloadPdf } from "../lib/api";
type Letter = { id: number; letter_type: string; subject: string; issue_date: string; effective_date: string | null; file_name: string; unread: number | boolean; downloaded: number | boolean };
export default function OfficialLetters() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  useEffect(() => {
    api<{ letters: Letter[] }>("/api/employee-letters/me").then(async (result) => {
      setLetters(result.letters);
      const ids = result.letters.filter((letter) => letter.unread).map((letter) => letter.id);
      if (ids.length) {
        try { await api("/api/employee-letters/me/read", { method: "POST", body: JSON.stringify({ ids }) }); setLetters((items) => items.map((item) => ({ ...item, unread: false }))); window.dispatchEvent(new Event("employee-letters-read")); } catch { /* Read state can be retried on the next visit. */ }
      }
    }).catch(() => setError("Unable to load official letters.")).finally(() => setLoading(false));
  }, []);
  async function download(letter: Letter) {
    if (busy !== null) return;
    setBusy(letter.id); setError("");
    try {
      await downloadPdf(`/api/employee-letters/me/${letter.id}/pdf`, letter.file_name);
      setLetters((items) => items.map((item) => item.id === letter.id ? { ...item, downloaded: true, unread: false } : item));
      window.dispatchEvent(new Event("employee-letters-read"));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to download letter."); }
    finally { setBusy(null); }
  }
  return <main className="content"><div className="content-head"><div><h1 className="page-title">Official Letters</h1></div></div>
    {error && <p className="error-text" role="alert">{error}</p>}{loading ? <p>Loading letters…</p> : <div className="official-letter-grid">{letters.map((letter) => <article className="form-card official-letter-card" key={letter.id}>
      <div className="official-letter-heading"><LuFileText size={21} /><h2>{letter.letter_type.charAt(0).toUpperCase() + letter.letter_type.slice(1)} Letter</h2>{Boolean(letter.unread) && <span className="attendance-mode-badge">New</span>}</div>
      <p>{letter.subject}</p><div className="official-letter-dates"><span><LuCalendarDays size={14} /> Issued: {letter.issue_date}</span>{letter.effective_date && <span>Effective: {letter.effective_date}</span>}</div>
      {!letter.downloaded && <button className="btn-sm" disabled={busy !== null} onClick={() => void download(letter)}><LuDownload size={15} /> {busy === letter.id ? "Downloading…" : "Download PDF"}</button>}
    </article>)}{!letters.length && <div className="empty-note">No official letters have been issued to you.</div>}</div>}
  </main>;
}
