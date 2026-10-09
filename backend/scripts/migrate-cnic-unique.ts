import { pool } from "../src/db";
import { decrypt } from "../src/crypto";
import bcrypt from "bcrypt";

async function run() {
  console.log("Checking employees table for cnic column...");
  const [cols] = await pool.execute<any[]>("DESCRIBE employees");
  const colNames = (cols as any[]).map(c => c.Field);

  if (!colNames.includes("cnic")) {
    console.log("Adding cnic VARCHAR(13) NULL column to employees table...");
    await pool.execute("ALTER TABLE employees ADD COLUMN cnic VARCHAR(13) NULL AFTER status");
  }

  // Populate cnic from cnic_enc for any rows where cnic IS NULL
  const [rows] = await pool.execute<any[]>("SELECT id, cnic, cnic_enc FROM employees");
  for (const emp of rows as any[]) {
    if (!emp.cnic && emp.cnic_enc) {
      try {
        const decrypted = decrypt(emp.cnic_enc);
        const clean = decrypted.replace(/\D/g, "");
        if (clean.length === 13) {
          console.log(`Populating cnic for employee id ${emp.id}: ${clean}`);
          await pool.execute("UPDATE employees SET cnic = ? WHERE id = ?", [clean, emp.id]);
        }
      } catch (e: any) {
        console.warn(`Could not decrypt CNIC for employee id ${emp.id}:`, e.message);
      }
    }
  }

  // Check for duplicate CNICs before adding unique constraint
  const [dups] = await pool.execute<any[]>(
    "SELECT cnic, COUNT(*) as count FROM employees WHERE cnic IS NOT NULL GROUP BY cnic HAVING count > 1"
  );
  if ((dups as any[]).length > 0) {
    console.error("Duplicate CNICs found in employees table! Cannot add unique constraint:", dups);
    process.exit(1);
  }

  // Check if unique index already exists
  const [indexes] = await pool.execute<any[]>("SHOW INDEX FROM employees WHERE Column_name = 'cnic'");
  const hasUnique = (indexes as any[]).some(i => i.Non_unique === 0);
  if (!hasUnique) {
    console.log("Adding UNIQUE constraint uq_employees_cnic on employees(cnic)...");
    await pool.execute("ALTER TABLE employees ADD CONSTRAINT uq_employees_cnic UNIQUE (cnic)");
  } else {
    console.log("UNIQUE constraint on employees(cnic) already exists.");
  }

  // Check employee user accounts: ensure employee 9 has user account
  const [empsWithoutUser] = await pool.execute<any[]>(
    "SELECT e.id, e.employee_code, e.full_name, e.email, e.cnic, e.user_id FROM employees e WHERE e.cnic IS NOT NULL"
  );
  for (const emp of empsWithoutUser as any[]) {
    const [uRows] = await pool.execute<any[]>("SELECT id FROM users WHERE employee_id = ? OR cnic = ?", [emp.id, emp.cnic]);
    if ((uRows as any[]).length === 0) {
      console.log(`Creating user account for employee id ${emp.id} (CNIC: ${emp.cnic})...`);
      const [roleRows] = await pool.execute<any[]>("SELECT id FROM roles WHERE name = 'employee' LIMIT 1");
      const employeeRoleId = (roleRows as any[])[0]?.id ?? 3;
      const defaultHash = await bcrypt.hash("ash@001", 12);
      const [uRes] = await pool.execute<any[]>(
        "INSERT INTO users (role_id, full_name, email, cnic, employee_id, password_hash, is_active) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
        [employeeRoleId, emp.full_name, emp.email ?? null, emp.cnic, emp.id, defaultHash]
      );
      const newUserId = (uRes as any).insertId;
      await pool.execute("UPDATE employees SET user_id = ? WHERE id = ?", [newUserId, emp.id]);
    } else {
      const uId = (uRows as any[])[0].id;
      await pool.execute("UPDATE users SET cnic = ?, employee_id = ? WHERE id = ?", [emp.cnic, emp.id, uId]);
      await pool.execute("UPDATE employees SET user_id = ? WHERE id = ?", [uId, emp.id]);
    }
  }

  console.log("Migration completed successfully.");
  await pool.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
