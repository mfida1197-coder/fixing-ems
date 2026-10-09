import { useState } from "react";
import { LuBell } from "react-icons/lu";
import type { PortalNotice } from "../hooks/useNavigationNotifications";
export default function PortalNotificationBell({ count, notices, onRead, onLetter }: { count: number; notices: PortalNotice[]; onRead: (notice: PortalNotice) => Promise<void>; onLetter?: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  async function select(notice: PortalNotice) {
    if (notice.type === "official_letter") { onLetter?.(); setOpen(false); return; }
    setError("");
    try { await onRead(notice); } catch { setError("Unable to mark notification read."); }
  }
  return <div className="employee-letter-bell">
    <button type="button" className="app-icon-action-btn" aria-label="Notifications" aria-expanded={open} onClick={() => setOpen((value) => !value)}><LuBell size={18} />{count > 0 && <span className="app-notification-dot" />}</button>
    {open && <div className="employee-letter-notifications"><strong>Notifications</strong>{notices.map((notice) => <button key={`${notice.type}-${notice.id}`} type="button" className={notice.unread ? "portal-notice-unread" : ""} onClick={() => void select(notice)}><span>{notice.title}</span><small>{notice.message}</small></button>)}{!notices.length && <p>No notifications yet.</p>}{error && <p className="error-text">{error}</p>}</div>}
  </div>;
}
