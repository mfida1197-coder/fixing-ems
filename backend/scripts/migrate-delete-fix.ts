/**
 * Migration: Fix employee deletion FK constraints
 *
 * 1. Make audit_logs.user_id nullable so audit history is preserved when a user is deleted.
 * 2. Change audit_logs FK to ON DELETE SET NULL (preserves the log row, clears the user ref).
 * 3. Change reveal_attempts FK to ON DELETE CASCADE (rate-limit records have no value after user deleted).
 *
 * Run once: npx ts-node scripts/migrate-delete-fix.ts
 */

import { pool } from "../src/db";

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    console.log("Step 1: Drop old audit_logs FK (audit_logs_ibfk_1)…");
    await conn.execute(`ALTER TABLE audit_logs DROP FOREIGN KEY audit_logs_ibfk_1`);

    console.log("Step 2: Make audit_logs.user_id nullable…");
    await conn.execute(`ALTER TABLE audit_logs MODIFY COLUMN user_id INT UNSIGNED NULL`);

    console.log("Step 3: Re-add audit_logs FK with ON DELETE SET NULL…");
    await conn.execute(`
      ALTER TABLE audit_logs
        ADD CONSTRAINT audit_logs_ibfk_1
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
    `);

    // Handle reveal_attempts — find actual constraint name first
    const [raFks]: any = await conn.execute(`
      SELECT CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'reveal_attempts'
        AND REFERENCED_TABLE_NAME = 'users'
    `);

    if (raFks.length > 0) {
      const raConstraint = raFks[0].CONSTRAINT_NAME;
      console.log(`Step 4: Drop reveal_attempts FK (${raConstraint})…`);
      await conn.execute(`ALTER TABLE reveal_attempts DROP FOREIGN KEY ${raConstraint}`);

      console.log("Step 5: Re-add reveal_attempts FK with ON DELETE CASCADE…");
      await conn.execute(`
        ALTER TABLE reveal_attempts
          ADD CONSTRAINT ${raConstraint}
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE
      `);
    } else {
      console.log("Step 4-5: No reveal_attempts FK found — skipping.");
    }

    await conn.commit();
    console.log("✅ Migration complete.");
  } catch (err) {
    await conn.rollback();
    console.error("❌ Migration failed — rolled back:", err);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

run();
