import { Response, Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db";
import { audit } from "../audit";
import { requireAuth, requirePermission, requireSelectedMode, AuthedRequest } from "../middleware/auth";
import { SuperPasswordError, verifySuperPassword, clearSuperAuthorizations } from "../security/superPassword";

const router = Router();
router.use(requireAuth, requireSelectedMode);

async function changeLoginPassword(userId: number, current: unknown, next: unknown, confirmation: unknown, res: Response, ip: string | null) {
  if (typeof current !== "string" || typeof next !== "string" || typeof confirmation !== "string" || !current || !next || !confirmation) {
    return res.status(400).json({ error: "Current password, new password, and confirmation are required" });
  }
  if (next.length < 10 || next.length > 128) return res.status(400).json({ error: "New password must be between 10 and 128 characters" });
  if (next !== confirmation) return res.status(400).json({ error: "New password and confirmation do not match" });
  if (next === current) return res.status(400).json({ error: "New password must differ from the current password" });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT password_hash FROM users WHERE id = ? LIMIT 1 FOR UPDATE", [userId]);
    const user = (rows as Array<{ password_hash: string }>)[0];
    if (!user) {
      await connection.rollback();
      return res.status(404).json({ error: "User not found" });
    }
    const ok = user.password_hash ? await bcrypt.compare(current, user.password_hash) : false;
    if (!ok) {
      await connection.rollback();
      return res.status(401).json({ error: "Current password is incorrect" });
    }
    const newHash = await bcrypt.hash(next, 12);
    await connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, userId]);
    await audit(userId, "update", "user", userId, { changed: "login_password" }, ip, connection);
    await connection.commit();
    return res.json({ ok: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.post("/change-login-password", async (req: AuthedRequest, res, next) => {
  const { currentPassword, newPassword, confirmPassword } = req.body ?? {};
  try {
    await changeLoginPassword(req.user!.id, currentPassword, newPassword, confirmPassword, res, req.ip ?? null);
  } catch (error) {
    next(error);
  }
});

router.post("/change-super-password", requirePermission("super_password:change"), async (req: AuthedRequest, res, next) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new Super Password are required" });
  }
  if (String(newPassword).length < 10) {
    return res.status(400).json({ error: "New Super Password must be at least 10 characters" });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: "New Super Password must differ from the current one" });
  }

  try {
    await verifySuperPassword(req.user!.id, String(currentPassword), req.ip ?? null);
    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.execute(
      "UPDATE system_security_settings SET super_password_hash = ?, updated_by = ? WHERE id = 1",
      [newHash, req.user!.id],
    );
    await audit(req.user!.id, "update", "system_security", 1, { changed: "super_password_hash" }, req.ip ?? null);
    clearSuperAuthorizations();
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof SuperPasswordError) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
