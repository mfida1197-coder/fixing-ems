import { useEffect, useState } from "react";
import { LuFolderKanban, LuArrowLeft, LuArrowRight, LuCalendarDays, LuTrendingUp } from "react-icons/lu";
import { api, openAuthenticatedFile, downloadFile } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";

type Project = { id: number; name: string; description: string | null; status: string; expected_handover_date: string | null; current_progress: number; latest_update: string | null };
type Details = { project: Project; progress_updates: Array<{ id: number; progress_percent: number; report: string; created_at: string }>; requirements: Array<{ id: number; content: string; attachment_name: string | null }> };

export default function EmployeeProjects({ embedded = false }: { embedded?: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [report, setReport] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<{ projects: Project[] }>("/api/projects/me/assigned").then((data) => setProjects(data.projects))
      .catch(() => setError("Could not load assigned projects.")).finally(() => setLoading(false));
  }, []);
  async function open(id: number) {
    setError("");
    try { const result = await api<Details>(`/api/projects/me/assigned/${id}`); setDetails(result); setProgress(String(result.project.current_progress)); setReport(""); }
    catch { setError("This project is no longer available."); }
  }
  async function saveProgress(event: React.FormEvent) {
    event.preventDefault();
    if (!details || saving) return;
    setError(""); setSaving(true);
    try {
      await api(`/api/projects/${details.project.id}/progress`, { method: "POST", body: JSON.stringify({ progress_percent: Number(progress), report }) });
      const result = await api<Details>(`/api/projects/me/assigned/${details.project.id}`);
      setDetails(result); setReport("");
      setProjects((items) => items.map((item) => item.id === result.project.id ? result.project : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update progress"); }
    finally { setSaving(false); }
  }
  return <section className={`${embedded ? "attendance-section-card" : "content"} employee-projects-page`}>
    <h2 className={embedded ? undefined : "page-title"}><LuFolderKanban size={20} /> Projects</h2>
    {loading && <p>Loading projects…</p>}{error && <p className="error-text">{error}</p>}
    {!loading && !error && projects.length === 0 && <p className="attendance-empty">No currently assigned projects.</p>}
    {details ? <div className="employee-project-details">
      <button type="button" className="btn-ghost employee-project-back" onClick={() => setDetails(null)}><LuArrowLeft size={16} /> Back to Projects</button>
      <div className="attendance-section-card employee-project-detail-card">
        <div className="employee-project-heading"><span className="employee-project-icon"><LuFolderKanban size={24} /></span><h3>{details.project.name}</h3><StatusBadge value={details.project.status} /></div>
        {details.project.description && <p className="employee-project-description">{details.project.description}</p>}
        <div className="employee-project-handover"><LuCalendarDays size={18} /><div><small>Expected handover</small><strong>{details.project.expected_handover_date?.slice(0, 10) || "—"}</strong></div></div>
        <div className="employee-project-progress-block"><div><span><LuTrendingUp size={16} /> Project progress</span><strong>{details.project.current_progress}%</strong></div><progress aria-label="Project progress" className="employee-project-progress" max={100} value={details.project.current_progress} /></div>
      </div>
      {details.progress_updates.length > 0 && <div className="employee-project-update-list">{details.progress_updates.map((update) => <article key={update.id} className="attendance-session"><div><strong>{update.progress_percent}%</strong><small>{String(update.created_at).slice(0, 10)}</small></div><p>{update.report}</p></article>)}</div>}
      <form className="attendance-section-card employee-project-progress-form" onSubmit={saveProgress}><h3>Update Progress</h3><label className="field-label">Progress percentage<input className="field-input" type="number" min={0} max={100} step={1} required value={progress} onChange={(e) => setProgress(e.target.value)} /></label><label className="field-label">Progress update<textarea className="field-input" rows={3} maxLength={4000} required value={report} onChange={(e) => setReport(e.target.value)} /></label><button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Add Progress Update"}</button></form>
      <section className="attendance-section-card employee-project-requirements"><h3>Requirements / Additions</h3>{details.requirements.map((item) => <article className="requirement-card" key={item.id}><p>{item.content}</p>{item.attachment_name && <div className="inline-actions"><button className="btn-sm" onClick={() => void openAuthenticatedFile(`/api/projects/requirements/${item.id}/attachment`).catch(() => setError("Unable to open attachment"))}>Open attachment</button><button className="btn-sm" onClick={() => void downloadFile(`/api/projects/requirements/${item.id}/attachment`, item.attachment_name!).catch(() => setError("Unable to download attachment"))}>Download {item.attachment_name}</button></div>}</article>)}{!details.requirements.length && <p className="empty-note">No requirements or additions yet.</p>}</section>
    </div> : <div className="employee-project-grid">{projects.map((project) => <button className="attendance-section-card employee-project-card" key={project.id} onClick={() => open(project.id)}>
      <div className="employee-project-heading"><span className="employee-project-icon"><LuFolderKanban size={20} /></span><strong>{project.name}</strong><StatusBadge value={project.status} /></div>
      <div className="employee-project-progress-block"><div><span>Progress</span><strong>{project.current_progress}%</strong></div><progress aria-label={`${project.name} progress`} className="employee-project-progress" max={100} value={project.current_progress} /></div><span className="employee-project-link">View Details <LuArrowRight size={16} /></span>
    </button>)}</div>}
  </section>;
}
