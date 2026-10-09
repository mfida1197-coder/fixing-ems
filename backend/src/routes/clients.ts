import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../db";
import { audit } from "../audit";
import { requireAuth, requirePermission, requireSuperPassword, AuthedRequest } from "../middleware/auth";

const router = Router();
router.use(requireAuth, requirePermission("clients:manage"));

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const COUNTRY_REGEX = /^[a-zA-Z\s]+$/;
const PHONE_ALLOWED_REGEX = /^[+0-9\s\-()\\.]+$/;

function validateClientFields(body: any): string | null {
  const { email, country, phone, ntn } = body;

  if (email && email.trim()) {
    if (!EMAIL_REGEX.test(email.trim())) {
      return "Invalid email format. Example: name@example.com";
    }
  }

  if (country && country.trim()) {
    if (!COUNTRY_REGEX.test(country.trim())) {
      return "Country must contain alphabetic characters and spaces only (no numbers or special characters)";
    }
  }

  if (phone && phone.trim()) {
    if (!PHONE_ALLOWED_REGEX.test(phone.trim())) {
      return "Phone must not contain alphabetic characters — use digits only (e.g. 0300-1234567 or +92 300 1234567)";
    }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      return "Phone number must be between 10 and 15 digits";
    }
  }

  if (ntn !== undefined && ntn !== null && String(ntn).trim()) {
    const ntnStr = String(ntn).trim();
    if (!/^\d+$/.test(ntnStr)) {
      return "NTN number must contain digits only (no letters, spaces, dashes, or special characters)";
    }
  }

  return null;
}

router.get("/", async (_req, res) => {
  const [rows] = await pool.execute(
    `SELECT c.id, c.company_name, c.contact_person, c.email, c.phone, c.country, c.ntn, c.status, c.created_at,
            COUNT(p.id) AS project_count, MAX(CASE WHEN u.id IS NULL THEN 0 ELSE 1 END) AS has_client_access
     FROM clients c LEFT JOIN projects p ON p.client_id = c.id
     LEFT JOIN users u ON u.client_id = c.id
     GROUP BY c.id ORDER BY c.id DESC`
  );
  res.json({ clients: rows });
});

router.post("/", async (req: AuthedRequest, res) => {
  const { company_name, contact_person, email, phone, country, ntn, status, login_password } = req.body ?? {};
  if (!company_name) return res.status(400).json({ error: "Company name is required" });

  const validationError = validateClientFields(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  if (!email?.trim()) return res.status(400).json({ error: "Email is required for client login" });
  const password = String(login_password || "").trim();
  if (!password) return res.status(400).json({ error: "Login Password is required" });
  const passwordHash = await bcrypt.hash(password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      `INSERT INTO clients (company_name, contact_person, email, phone, country, ntn, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [company_name, contact_person ?? null, email.trim(), phone?.trim() ?? null, country?.trim() ?? null,
        ntn ? String(ntn).trim() : null, status ?? "active"],
    );
    const id = Number((result as any).insertId);
    const [roles] = await connection.execute("SELECT id FROM roles WHERE name = 'client' AND is_active = 1 LIMIT 1");
    const roleId = Number((roles as any[])[0]?.id);
    if (!roleId) throw new Error("Client role is not configured");
    await connection.execute(
      "INSERT INTO users (role_id, full_name, email, client_id, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      [roleId, contact_person || company_name, email.trim(), id, passwordHash, status === "inactive" ? 0 : 1],
    );
    await connection.commit();
    await audit(req.user!.id, "create", "client", id, { company_name, client_access_created: true }, req.ip ?? null);
    res.status(201).json({ id });
  } catch (error: any) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That email is already used by another account" });
    res.status(500).json({ error: "Unable to create client" });
  } finally { connection.release(); }
});

router.put("/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const validationError = validateClientFields(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const allowed = ["company_name", "contact_person", "email", "phone", "country", "ntn", "status"];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`);
      const val = req.body[key];
      vals.push(val !== null && String(val).trim() !== "" ? String(val).trim() : null);
    }
  }
  if (!sets.length && !String(req.body.login_password || "").trim()) return res.status(400).json({ error: "Nothing to update" });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    if (sets.length) {
      vals.push(req.params.id);
      await connection.execute(`UPDATE clients SET ${sets.join(", ")} WHERE id = ?`, vals);
    }
    const [clientRows] = await connection.execute("SELECT company_name, contact_person, email, status FROM clients WHERE id = ? LIMIT 1", [req.params.id]);
    const client = (clientRows as any[])[0];
    if (!client) { await connection.rollback(); return res.status(404).json({ error: "Client not found" }); }
    const newPassword = typeof req.body.login_password === "string" ? req.body.login_password.trim() : "";
    const [linkedRows] = await connection.execute("SELECT id FROM users WHERE client_id = ? LIMIT 1", [req.params.id]);
    const linkedUser = (linkedRows as any[])[0];
    if (linkedUser) {
      if (newPassword) {
        const hash = await bcrypt.hash(newPassword, 12);
        await connection.execute("UPDATE users SET full_name = ?, email = ?, is_active = ?, password_hash = ? WHERE id = ?",
          [client.contact_person || client.company_name, client.email, client.status === "active" ? 1 : 0, hash, linkedUser.id]);
      } else {
        await connection.execute("UPDATE users SET full_name = ?, email = ?, is_active = ? WHERE id = ?",
          [client.contact_person || client.company_name, client.email, client.status === "active" ? 1 : 0, linkedUser.id]);
      }
    } else if (newPassword) {
      const [roles] = await connection.execute("SELECT id FROM roles WHERE name = 'client' AND is_active = 1 LIMIT 1");
      const roleId = Number((roles as any[])[0]?.id);
      if (!roleId) throw new Error("Client role is not configured");
      if (!client.email) { await connection.rollback(); return res.status(400).json({ error: "A valid client email is required" }); }
      const hash = await bcrypt.hash(newPassword, 12);
      await connection.execute("INSERT INTO users (role_id, full_name, email, client_id, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?)",
        [roleId, client.contact_person || client.company_name, client.email, req.params.id, hash, client.status === "active" ? 1 : 0]);
    }
    await connection.commit();
    await audit(req.user!.id, "update", "client", Number(req.params.id), { fields: sets.map(s => s.split(" ")[0]) }, req.ip ?? null);
    res.json({ ok: true });
  } catch (error: any) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That email is already used by another account" });
    throw error;
  } finally {
    connection.release();
  }
});

router.delete("/:id", requireSuperPassword, async (req: AuthedRequest, res) => {
  const clientId = Number(req.params.id);

  const [txns] = await pool.execute("SELECT COUNT(*) AS c FROM transactions WHERE client_id = ?", [clientId]);
  if ((txns as any[])[0].c > 0) {
    return res.status(400).json({
      error: "This client cannot be deleted because it has existing transactions. Please deactivate the client instead.",
    });
  }

  const [proj] = await pool.execute("SELECT COUNT(*) AS c FROM projects WHERE client_id = ?", [clientId]);
  if ((proj as any[])[0].c > 0) {
    return res.status(400).json({ error: "This client has projects. Delete or reassign them first" });
  }

  try {
    await pool.execute("DELETE FROM clients WHERE id = ?", [clientId]);
    await audit(req.user!.id, "delete", "client", clientId, null, req.ip ?? null);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || (err.message && err.message.includes("foreign key constraint fails"))) {
      return res.status(400).json({
        error: "This client cannot be deleted because it has existing transactions. Please deactivate the client instead.",
      });
    }
    res.status(500).json({ error: err.message || "Failed to delete client" });
  }
});

export default router;
