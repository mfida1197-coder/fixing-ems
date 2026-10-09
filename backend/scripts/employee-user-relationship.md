# Employee–user relationship upgrade — not executed

Live schema/data remain unverified. Do not deploy or run SQL until the exact
host, port, database and read-only inspection account are approved.
Do not apply database_schema.sql to an existing database.

## Inspect first (IDs only; no credentials or personal fields)

```sql
SELECT DATABASE(), @@hostname, @@port, CURRENT_USER(), VERSION();
SHOW CREATE TABLE users;
SHOW CREATE TABLE employees;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('users','employees') AND COLUMN_NAME IN ('id','employee_id','user_id');
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('users','employees') ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
       k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE
FROM information_schema.KEY_COLUMN_USAGE k
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
AND r.TABLE_NAME=k.TABLE_NAME
WHERE k.CONSTRAINT_SCHEMA=DATABASE()
AND (k.TABLE_NAME IN ('users','employees') OR k.REFERENCED_TABLE_NAME IN ('users','employees'));
-- Duplicate claims.
SELECT employee_id, COUNT(*) FROM users WHERE employee_id IS NOT NULL
GROUP BY employee_id HAVING COUNT(*)>1;
SELECT user_id, COUNT(*) FROM employees WHERE user_id IS NOT NULL
GROUP BY user_id HAVING COUNT(*)>1;
-- Orphaned links.
SELECT u.id, u.employee_id FROM users u LEFT JOIN employees e ON e.id=u.employee_id
WHERE u.employee_id IS NOT NULL AND e.id IS NULL;
SELECT e.id, e.user_id FROM employees e LEFT JOIN users u ON u.id=e.user_id
WHERE e.user_id IS NOT NULL AND u.id IS NULL;
-- Disagreements in either direction.
SELECT e.id, e.user_id, u.employee_id FROM employees e JOIN users u ON u.id=e.user_id
WHERE u.employee_id IS NOT NULL AND u.employee_id<>e.id;
SELECT u.id, u.employee_id, e.user_id FROM users u JOIN employees e ON e.id=u.employee_id
WHERE e.user_id IS NOT NULL AND e.user_id<>u.id;
-- All pairs, including reciprocal, one-sided and unlinked records.
SELECT u.id AS user_id, u.employee_id, e.user_id AS reverse_user_id
FROM users u LEFT JOIN employees e ON e.id=u.employee_id;
SELECT e.id AS employee_id, e.user_id, u.employee_id AS canonical_employee_id
FROM employees e LEFT JOIN users u ON u.id=e.user_id;
SELECT pr.id, pr.user_id, pr.employee_id FROM password_reset_requests pr
LEFT JOIN users u ON u.id=pr.user_id
WHERE pr.status='pending' AND (u.id IS NULL OR NOT (u.employee_id <=> pr.employee_id));
```

Inspect column existence before running reverse-link queries; omit them only if
user_id is absent. Conflicts, duplicates, orphans and mismatched pending resets
are STOP conditions. NULL links need review, not guessed accounts or identities.

## Approved upgrade order

1. Stop all application writers/old instances. Back up users/employees, mappings,
   schema metadata and dependent data securely; verify restoration is possible.
2. Manually approve exact reverse-only pairs with one claimant on each side.
   In a transaction, lock those records and recheck conflicts. Reconcile ONLY
   approved pairs; preserve IDs, hashes, roles, existing updated_at and other fields.
   Recheck counts/pairs before COMMIT; otherwise ROLLBACK. No automatic repairs.
3. Verify users.employee_id matches employees.id in type/signedness, permits NULL,
   and has no duplicates/orphans. Add only missing exact constraints after approval:

```sql
ALTER TABLE users ADD UNIQUE KEY uq_users_employee (employee_id);
ALTER TABLE users ADD CONSTRAINT fk_users_employee
 FOREIGN KEY (employee_id) REFERENCES employees(id)
 ON DELETE RESTRICT ON UPDATE RESTRICT;
```

Check existing index/FK shapes, names and policies—not names alone. Unexpected
definitions require review, not automatic column alterations or duplicate FKs.
MySQL DDL implicitly commits: inspect postconditions after each statement and,
on retry, apply only genuinely missing constraints. Never disable FK checks.

4. Rehearse on an approved disposable copy; deploy all canonical consumers together.
   Employee creation inserts employee then user. Explicit password assignment locks
   the employee, reuses its canonical account or creates one; legacy conflicts block it.
   Normal edits preserve existing name/email/CNIC synchronization but not password changes.
   NULL employee_id supports admin-only users. Employees may exist without accounts.
   Employee deletion retains history/self checks and explicitly deletes its account
   first; RESTRICT never cascades accounts. Other existing child FKs still apply.
5. Keep the actual employees.user_id column during initial rollout. Only after all
   consumers, views/triggers/routines/external jobs and old instances are checked,
   archive the old pairs and separately approve obsolete-FK/column removal.
   Dropping user_id is irreversible without restoring a backup.

The old migrate-cnic-unique.ts still depends on user_id and must not be rerun
against the final schema. Previously applied migrations are unchanged.
No SQL, migration, backfill or database operation was executed in this task.
