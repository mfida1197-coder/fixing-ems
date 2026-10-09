import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AuthUser } from "../types/auth";
export type PortalNotice = { id: number; type: "email_sent" | "official_letter"; title: string; message: string; unread: boolean };

export function useNavigationNotifications(user: AuthUser | null) {
  const [requestUnread, setRequestUnread] = useState(0);
  const [letterUnread, setLetterUnread] = useState(0);
  const [letterNotifications, setLetterNotifications] = useState<PortalNotice[]>([]);
  const [portalUnread, setPortalUnread] = useState(0);
  const eligible = Boolean(user && user.mode !== "client" && user.mode !== "selection_required" && user.role !== "client");
  const refreshLetterUnread = useCallback(async () => {
    if (user?.mode !== "employee" && user?.mode !== "client") { setLetterUnread(0); setLetterNotifications([]); setPortalUnread(0); return; }
    try {
      const result = await api<{ unread_count: number; letter_unread_count: number; notifications: PortalNotice[] }>(user.mode === "client" ? "/api/client-portal/notifications" : "/api/employee-letters/me/notifications");
      setLetterUnread(result.letter_unread_count); setPortalUnread(result.unread_count); setLetterNotifications(result.notifications);
    } catch { /* A transient refresh failure must not interrupt navigation. */ }
  }, [user?.id, user?.mode]);
  useEffect(() => {
    setLetterUnread(0); setPortalUnread(0); setLetterNotifications([]);
    void refreshLetterUnread();
    if (user?.mode !== "employee" && user?.mode !== "client") return;
    const refresh = () => void refreshLetterUnread();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("employee-letters-read", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("employee-letters-read", refresh); };
  }, [refreshLetterUnread, user?.mode]);


  const refreshRequestUnread = useCallback(async () => {
    if (!eligible) return setRequestUnread(0);
    try {
      const result = await api<{ unread_count: number }>("/api/request-notifications/summary");
      setRequestUnread(Number(result.unread_count || 0));
    } catch { /* Keep navigation usable during a transient badge refresh failure. */ }
  }, [eligible]);

  const markRequestsRead = useCallback(async () => {
    if (!eligible) return;
    try {
      await api("/api/request-notifications/mark-read", { method: "POST", body: "{}" });
      setRequestUnread(0);
    } catch { /* The next lightweight refresh retries. */ }
  }, [eligible]);


  useEffect(() => {
    if (!eligible) { setRequestUnread(0); return; }
    void refreshRequestUnread();
    const timer = window.setInterval(() => void refreshRequestUnread(), 30_000);
    return () => window.clearInterval(timer);
  }, [eligible, user?.id, user?.mode, refreshRequestUnread]);

  const readEmailNotice = async (notice: PortalNotice) => {
    await api(user?.mode === "client" ? "/api/client-portal/notifications/read" : "/api/employee-letters/me/notifications/read", { method: "POST", body: JSON.stringify({ id: notice.id, type: notice.type }) });
    await refreshLetterUnread();
  };
  return { requestUnread, refreshRequestUnread, markRequestsRead, letterUnread, letterNotifications, portalUnread, readEmailNotice };
}
