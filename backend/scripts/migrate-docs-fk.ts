/**
 * Migration: Make employee_documents.uploaded_by nullable
 *
 * This allows the field to become NULL when the uploader user is deleted,
 * preserving the document record without orphaned FK reference.
 *
 * Run once: npx ts-node scripts/migrate-docs-fk.ts
 */

import { pool } from "../src/db";

async function run() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    console.log("Step 1: Drop employee_documents FK on uploaded_by (employee_documents_ibfk_2)…");
    await conn.execute(`ALTER TABLE employee_documents DROP FOREIGN KEY employee_documents_ibfk_2`);

    console.log("Step 2: Make employee_documents.uploaded_by nullable…");
    await conn.execute(`ALTER TABLE employee_documents MODIFY COLUMN uploaded_by INT UNSIGNED NULL`);

    console.log("Step 3: Re-add FK with ON DELETE SET NULL…");
    await conn.execute(`
      ALTER TABLE employee_documents
        ADD CONSTRAINT employee_documents_ibfk_2
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
        ON DELETE SET NULL
    `);

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
