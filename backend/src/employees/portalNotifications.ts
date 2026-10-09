import { pool } from "../db";
import type { AuthedRequest } from "../middleware/auth";
import type { RequestHandler } from "express";

export async function notifyEmailSent(kind: "employee" | "client", id: number) {
  await pool.execute("INSERT INTO portal_notifications (employee_id, client_id, notification_type, created_at) VALUES (?, ?, 'email_sent', UTC_TIMESTAMP(6))", [kind === "employee" ? id : null, kind === "client" ? id : null]);
}
function ownership(user: NonNullable<AuthedRequest["user"]>) {
  if (user.mode === "employee") return { sql: "employee_id = (SELECT employee_id FROM users WHERE id = ?)", id: user.id };
  if (user.role === "client" && user.client_id) return { sql: "client_id = ? AND employee_id IS NULL", id: user.client_id };
  return null;
}
export const getPortalNotifications: RequestHandler = async (request, res, next) => {
  const user = (request as AuthedRequest).user!;
  const own = ownership(user);
  if (!own) return res.status(403).json({ error: "Forbidden" });
  try {
    const [emails] = await pool.execute(`SELECT id, notification_type AS type, (read_at IS NULL) AS unread FROM portal_notifications WHERE ${own.sql} AND notification_type = 'email_sent' ORDER BY (read_at IS NULL) DESC, created_at DESC, id DESC LIMIT 20`, [own.id]);
    const [counts] = await pool.execute(`SELECT COUNT(*) AS count FROM portal_notifications WHERE ${own.sql} AND read_at IS NULL`, [own.id]);
    let letters: Array<{ id: number; letter_type: string; subject: string }> = [];
    let letterUnread = 0;
    if (user.mode === "employee") {
      const [rows] = await pool.execute("SELECT l.id, l.letter_type, l.subject FROM employee_letters l JOIN employees e ON e.id = l.employee_id WHERE e.id = (SELECT employee_id FROM users WHERE id = ?) AND l.delivered_at IS NOT NULL AND l.employee_read_at IS NULL ORDER BY l.created_at DESC, l.id DESC LIMIT 20", [user.id]);
      letters = rows as typeof letters;
      const [rowsCount] = await pool.execute("SELECT COUNT(*) AS count FROM employee_letters l JOIN employees e ON e.id = l.employee_id WHERE e.id = (SELECT employee_id FROM users WHERE id = ?) AND l.delivered_at IS NOT NULL AND l.employee_read_at IS NULL", [user.id]);
      letterUnread = Number((rowsCount as Array<{ count: number }>)[0].count);
    }
    res.json({ unread_count: Number((counts as Array<{ count: number }>)[0].count) + letterUnread, letter_unread_count: letterUnread,
      notifications: [...letters.map((letter) => ({ id: letter.id, type: "official_letter", unread: true, title: "New Official Letter", message: `Your ${letter.letter_type.charAt(0).toUpperCase() + letter.letter_type.slice(1)} Letter has been issued.` })), ...(emails as Array<{ id: number; type: string; unread: number }>).map((item) => ({ ...item, unread: Boolean(item.unread), title: "Check your email", message: "Ashtech Digital Solutions has sent you a new email." }))] });
  } catch (error) { next(error); }
};
export const readPortalNotification: RequestHandler = async (request, res, next) => {
  const req = request as AuthedRequest;
  const own = ownership(req.user!);
  if (!own) return res.status(403).json({ error: "Forbidden" });
  const id = Number(req.body?.id);
  if (req.body?.type !== "email_sent" || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid notification" });
  try {
    const [result] = await pool.execute(`UPDATE portal_notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP(6)) WHERE id = ? AND notification_type = 'email_sent' AND ${own.sql}`, [id, own.id]);
    if (!(result as { affectedRows: number }).affectedRows) return res.status(404).json({ error: "Notification not found" });
    res.json({ ok: true });
  } catch (error) { next(error); }
};
