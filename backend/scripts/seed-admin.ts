/**
 * Creates the Super Admin user. Run once after loading the schema:
 *   npm run seed:admin -- "Soban Farooq" ceo@ashtechdigitalsolutions.com "LoginPassword" "SuperPassword"
 */
import bcrypt from "bcrypt";
import { pool } from "../src/db";

async function main() {
  const [name, email, loginPass, superPassword] = process.argv.slice(2);
  if (!name || !email || !loginPass || !superPassword) {
    console.error('Usage: npm run seed:admin -- "Full Name" email login_password super_password');
    process.exit(1);
  }
  if (loginPass.length < 10 || superPassword.length < 10) {
    console.error("Both passwords must be at least 10 characters.");
    process.exit(1);
  }
  if (loginPass === superPassword) {
    console.error("Login password and Super Password must be different.");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(loginPass, 12);
  const superPasswordHash = await bcrypt.hash(superPassword, 12);
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    await connection.execute(
      `INSERT INTO users (role_id, full_name, email, password_hash)
       VALUES ((SELECT id FROM roles WHERE name = 'super_admin'), ?, ?, ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), full_name = VALUES(full_name)`,
      [name, email, passwordHash],
    );
    const [rows] = await connection.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    const userId = Number((rows as any[])[0].id);
    await connection.execute(
      `INSERT INTO system_security_settings (id, super_password_hash, updated_by)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE super_password_hash = VALUES(super_password_hash), updated_by = VALUES(updated_by)`,
      [superPasswordHash, userId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  console.log(`Super admin ready: ${email}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
