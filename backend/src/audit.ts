import { Pool, PoolConnection } from "mysql2/promise";
import { pool } from "./db";

export async function audit(
  userId: number,
  action:
    | "create"
    | "update"
    | "delete"
    | "login"
    | "reveal_sensitive"
    | "reveal_failed"
    | "super_password_verified"
    | "super_password_failed",
  entityType: string,
  entityId: number | null = null,
  changes: object | null = null,
  ip: string | null = null,
  database: Pool | PoolConnection = pool,
) {
  await database.execute(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, changes_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, action, entityType, entityId, changes ? JSON.stringify(changes) : null, ip]
  );
}
