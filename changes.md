# Ashtech EMS - Frontend Navigation & Responsiveness Changelog

## Dashboard Financial KPIs Fix
- Removed the strict current-month date filter on Dashboard and Finance summary queries so Dashboard Inflow, Outflow, and Net reflect the actual transaction-derived totals (amount_pkr) used by Finance > Transactions.
- Updated Dashboard shortcut labels to Inflow, Outflow, and Net.

## Projects UI Redesign
- Redesigned Projects list view into a clean container card with PORTFOLIO label, title, subtitle, and action buttons.
- Added live All / Ongoing / Upcoming / Completed filter tabs with counts and real-time search input.
- Added team count badge, horizontal progress bar with percentage, human-readable handover date formatting, and polished status pills while preserving all existing project logic and actions.

## Responsive Sidebar
- Fixed sidebar closing unexpectedly by isolating click-outside event listeners and adding safe event loop tick attachment.
- Added a clearly visible close (`✕`) button inside the sidebar header.
- Added click-outside-to-close behavior that listens to clicks outside the drawer without using any dark or visible background overlay.
- Ensured clicks inside the sidebar, its sections, or its navigation buttons do not close the drawer.
- Kept the right-side slide-over drawer structure intact, opening cleanly from the right edge with proper viewport height and scroll handling.

## Company Header
- Prevented company text from exceeding two lines using structured non-breaking inline spans (`Ashtech Digital` + `Solutions`).
- Removed all ellipsis (`...`) and line-clamp truncation so the full brand name is always visible.
- Configured responsive minimum width and natural wrapping rules to avoid third lines or clipped text.
- Increased company heading visual prominence with stronger typography hierarchy, deeper contrast, and refined line height.
- Added a prominent vertical brand divider separating the company block from desktop navigation tabs, plus an improved navbar bottom divider.
- Fixed logo and text clipping from the bottom by setting proper flex alignments, removing parent overflow restrictions, and specifying proportional heights.

## Desktop Navigation
- Preserved existing horizontal navigation, Settings icon, and non-wrapping Sign Out button on screens above `md` (768px).
- Kept mobile toggle button and sidebar drawer completely hidden on desktop.

## Validation
- Verified with TypeScript build (`tsc -b && vite build`): built cleanly with 0 errors.
- Verified with linter (`oxlint`): passed with 0 errors.

---

## Mobile UI: Button Sizes, Summary Font & Clients Table Overflow

### `frontend-app/src/index.css`

**Buttons in `content-head` (header action area)**
- At `≤ 1000px`: `.content-head .btn-primary` and `.content-head .btn-download` now have `height: 36px`, `font-size: 13px`, and reduced horizontal padding — prevents buttons from breaking or overflowing on tablet/mobile.
- At `≤ 480px`: Both buttons shrink further to `height: 34px`, `font-size: 12px`, `padding: 0 10px`.

**Summary value (inflow / outflow / net money figures)**
- Added `word-break: break-word` to `.summary-value` to prevent long numbers breaking the layout on any screen.
- At `≤ 1000px`: `.summary-value` font-size reduced to `16px`, summary card padding reduced to `12px`.
- At `≤ 480px`: `.summary-value` font-size further reduced to `13px`; summary-row gap tightened.

**Utility class**
- Added `.table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 10px; }` — a reusable horizontal scroll wrapper for wide tables.

### `frontend-app/src/pages/Clients.tsx`

**Clients list table**
- Wrapped the main clients list `<table>` in `<div className="table-scroll">` so the 7-column table scrolls horizontally instead of overflowing or squishing on mobile.

**Client detail — Projects table**
- Wrapped the projects `<table>` in the client detail view with `<div className="table-scroll">`.

**Client detail — Transactions table**
- Wrapped the transactions `<table>` in the client detail view with `<div className="table-scroll">`.

---

## Add Employee Section: Input Validation & Number-Field Behavior

### Phone Number Validation
- Configured the phone number field to only accept valid phone characters, immediately rejecting alphabetic characters and random words.
- Implemented format validation ensuring phone numbers follow expected application formats with a valid digit length between 10 and 15 digits.
- Added clear, contextual validation error feedback displayed directly below the field and in the submission summary.
- Blocked form submission until a valid phone number is entered.
- Added corresponding backend validation to reject invalid phone number formats and prevent bypass.

### Email Validation
- Implemented email format validation requiring valid domain structure, user identifier, and top-level domain.
- Rejected malformed patterns such as inputs without at-signs or missing domain extensions.
- Displayed specific error messages when an invalid email format is detected.
- Prevented form submission with invalid email addresses and enforced backend format validation.

### CNIC Validation and Numbers-Only Database Storage
- Enforced numbers-only entry for the CNIC field, automatically blocking any letters or non-numeric characters.
- Structured input formatting to present standard grouped formatting for readability on screen as display-only.
- Guaranteed that all formatting characters, dashes, and spaces are stripped prior to submission so the database receives and encrypts exclusively the 13-digit numeric string for future employee username authentication.
- Required full 13-digit completion before allowing form submission and blocked invalid lengths.
- Added backend validation ensuring only exact 13-digit numeric CNIC strings are processed, encrypted, and stored.

### Basic Salary — Mouse-Wheel Behavior Fix
- Fixed mouse-wheel scroll behavior on the Basic Salary numeric field so that scrolling over the input while typing or focused does not increment, decrement, or alter the entered salary value.
- Preserved normal page and container vertical scrolling when using the mouse wheel over the field.
- Retained full support for manual typing, selection, and editing.

### Allowances — Mouse-Wheel Behavior Fix
- Applied the mouse-wheel scroll fix to the Allowances numeric field, preventing scroll-wheel actions from modifying the entered allowance amount.
- Ensured normal page scrolling continues uninterrupted while hovering or focusing the input.
- Maintained normal manual keyboard entry and editing capabilities.

### Deductions — Mouse-Wheel Behavior Fix
- Applied the mouse-wheel scroll fix to the Deductions numeric field, ensuring mouse-wheel scroll events do not change the entered deduction figure.
- Kept standard page scroll behavior intact while retaining manual typing and editing functionality.

### Joining Date Future-Date Restriction
- Blocked selection of future dates at the input level by establishing an upper boundary restriction set to the current date.
- Added real-time change validation and form submission checks preventing any future date from being submitted.
- Added backend validation enforcing that the joining date cannot exceed the current date, protecting the database from invalid submissions.

### Designation Number Restriction
- Restricted the Designation field to text only, strictly disallowing numeric characters.
- Added validation displaying a clear notification message whenever numbers are entered in the designation field.
- Prevented form submission when designation contains any digits.
- Added server-side validation rejecting any designation containing numbers.

---

## Employee Authentication & Dashboard Integration

### Employee Password Field & Default Password in Add Employee
- Added a dedicated login password field to the Add Employee form with built-in show and hide password visibility toggle.
- Assigned an automatic default password (`ash@001`) to the field while enabling administrators to specify a custom password upon employee creation.

### Bcrypt Password Hashing & Security
- Integrated one-way bcrypt password hashing for all employee credentials prior to storing them in the database, matching the security standards used for administrator accounts.
- Guaranteed that passwords are never stored or transmitted in plain text, and ensured password hashes are strictly excluded from API responses and data logs.

### CNIC-Based Employee Username
- Designated the employee's 13-digit numeric CNIC as their unique login username, avoiding redundant username fields.
- Guaranteed that employee usernames are stored strictly as numeric digits without hyphens or spaces to ensure reliable authentication.

### Employee Role & Account Relationship
- Activated and assigned the `employee` role in the system role hierarchy to clearly distinguish employee accounts from administrator accounts.
- Established a direct relationship linking employee records to user authentication accounts in the database, allowing immediate authentication upon account creation.
- Configured user accounts to store CNIC and link directly to corresponding employee profiles.

### Unified Login Authentication
- Extended the existing EMS login interface to authenticate both administrators and employees from the same sign-in form without creating a separate login page.
- Allowed users to sign in using either administrative credentials (email/username + password) or employee credentials (13-digit CNIC + password).
- Automatically detected account roles upon authentication and seamlessly routed users to their designated interface.

### Employee Dashboard
- Created a dedicated Employee Dashboard adhering strictly to existing Ashtech EMS visual aesthetics and brand styling.
- Displayed real-time authenticated employee information, including employee code, full name, father's name, designation, department, status, formatted CNIC username, contact details, and joining date.
- Prominently presented an active Employee role badge and integrated a session sign-out action.

### Employee Access Restrictions
- Implemented strict access controls restricting authenticated employees exclusively to the Employee Dashboard and employee-authorized endpoints.
- Isolated employee sessions on the frontend by hiding all administrative navigation tabs, management tables, settings, and financial controls.
- Enforced role-based authorization at the API level across all administrative routes (employees list, creation, edits, deletion, clients, finance, projects, dashboard metrics, reports) to prevent unauthorized URL or direct request access.

### Admin Employee Password Management in Edit Employee
- Extended the existing Edit Employee interface to allow administrators to manage and reset employee login passwords without introducing separate management screens.
- Provided an editable password input with show and hide visibility controls within the edit drawer.
- Handled empty password inputs by preserving the employee's existing credentials, while automatically hashing any newly entered password with bcrypt before updating the database.

---

## Employee Deletion Fix

### Why Deletion Was Failing

When an employee is created, a corresponding user account is inserted into the `users` table to enable CNIC-based login. If any action was taken by that user (for example, a login), the system recorded rows in `audit_logs` with `user_id` pointing to the user's `users.id`. Because `audit_logs.user_id` was defined as `NOT NULL` with a strict foreign key referencing `users.id`, MySQL prevented deletion of the user row as long as any audit log referenced it. The error `ER_ROW_IS_REFERENCED_2` was returned, blocking employee deletion entirely.

### The Foreign-Key Relationship Causing the Problem

The blocking constraint was `audit_logs.user_id → users.id` (previously `NOT NULL`, no delete rule). A similar risk existed on `employee_documents.uploaded_by → users.id`, which was also `NOT NULL` with no delete rule. The `reveal_attempts` table had a strict FK without `CASCADE`, meaning rate-limit records for the user would also block deletion.

### Database Schema Changes Made

Three foreign-key constraints were altered through migrations:

- **`audit_logs.user_id`** changed from `NOT NULL` to `NULL`, and the FK rule changed to `ON DELETE SET NULL`. This means when a user account is deleted, any audit log rows referencing that user have their `user_id` set to `NULL` automatically, preserving the full audit history without any reference to a now-deleted account.
- **`reveal_attempts.user_id`** FK rule changed to `ON DELETE CASCADE`. Reveal-attempt rate-limit records are operational data tied to an active session and have no historical value after the user is gone; they are deleted automatically with the user.
- **`employee_documents.uploaded_by`** changed from `NOT NULL` to `NULL`, and the FK rule changed to `ON DELETE SET NULL`. Document records are preserved; the uploader reference is simply cleared when the uploader account is removed.

The `database_schema.sql` file has been updated to reflect these changes.

### How the Deletion Process Was Changed

The employee DELETE endpoint now runs inside a database transaction so that either the entire deletion succeeds or nothing is changed. The deletion sequence is:

1. Look up the employee and resolve the linked user account.
2. Explicitly set `audit_logs.user_id` to `NULL` for that user inside the transaction (belt-and-suspenders alongside the `ON DELETE SET NULL` FK rule).
3. Delete the user account. The database automatically cascades or nullifies all remaining dependent records (`reveal_attempts` cascades, `employee_documents.uploaded_by` is set null).
4. Null out `transactions.employee_id` for any finance records referencing the employee (salary records are preserved, only the employee link is cleared).
5. Delete the employee record. `employee_documents` and `project_assignments` cascade automatically.
6. Commit the transaction and log the deletion under the acting administrator's account.

If any step fails, the transaction is rolled back and a clear error message is returned to the frontend.

### How Audit History Is Preserved

Audit log rows are never deleted. The `user_id` column is set to `NULL` when the referenced user account is removed. Every other audit field — action, entity type, entity ID, changes JSON, IP address, and timestamp — remains intact. Existing admin accounts and their audit logs are completely unaffected.

### No Foreign-Key Checks Were Disabled

This fix does not use `SET FOREIGN_KEY_CHECKS = 0` or any equivalent workaround. All constraints remain active and enforce referential integrity throughout.

---

## Employee Code in Edit Employee

### Employee Changes
- Added the existing Employee Code field to the Edit Employee form.
- The Admin can view the employee's current Employee Code upon opening the edit drawer/form.
- The Admin can modify the Employee Code and save the updated value directly to the existing employee record.
- Added strict uniqueness validation on both client and server; duplicate Employee Codes belonging to other employees are rejected with a clear conflict message.
- Employee Code cannot be saved empty.
- Modifying the Employee Code updates only the employee identification record and strictly preserves the employee's CNIC, login username (13-digit CNIC), password hash, user account, role, and attendance or financial history.
- The updated Employee Code is displayed consistently across the Employees list, Employee Profile, and Employee Dashboard.

---

## Finance: Invoices / Receipts Attachment & Transaction Details

### Finance Changes
- Added an optional Invoice / Receipt / Document attachment field to the Add Transaction form.
- Supports PDF documents and image formats (JPG, JPEG, PNG, WEBP) up to 10MB in size.
- Uploaded supporting documents are stored on the server under an isolated, secure upload directory with collision-resistant generated filenames.
- Each attachment is associated directly with its specific transaction in the database.
- Transactions can still be created normally without attachments.
- Added a dedicated Transaction Details view accessed by clicking any transaction row in the Finance table.
- Transaction Details view presents the complete transaction record, including transaction type, amount, currency, locked PKR conversion, category, description, transaction date, exact backend creation date and time timestamp, and the administrator who created the entry.
- Added interactive document viewing inside Transaction Details:
  - Image attachments (PNG, JPG, WEBP) are rendered inline with preview controls.
  - PDF attachments can be previewed directly via embedded viewer or opened fullscreen in a new tab.
  - Transactions without attachments display a clean indicator stating that no supporting document was attached.
  - Includes a direct download button for attached invoices/receipts.

### Database Changes
- Altered the `transactions` table to add four nullable metadata columns:
  - `attachment_path`: Stores the sanitized filename/path within the secure upload directory.
  - `attachment_name`: Stores the original uploaded filename for display and download.
  - `attachment_mime`: Stores the verified document MIME type.
  - `attachment_size`: Stores the file size in bytes.
- Existing transactions and historical records were fully preserved without data loss.
- Updated `database_schema.sql` to document the attachment columns in the canonical schema.

### Backend Changes
- Added `multer` file-upload middleware to the Finance router with strict MIME type and file extension whitelisting, along with a 10MB size restriction.
- Implemented automatic temporary file cleanup if transaction validation fails.
- Updated transaction creation to persist attachment metadata and link it to the acting administrator's user ID.
- Updated `GET /api/finance/transactions` to return creation timestamps, creator names, and attachment indicators.
- Added `GET /api/finance/transactions/:id` to retrieve full transaction details.
- Added an authenticated streaming endpoint `GET /api/finance/transactions/:id/attachment` that verifies user credentials and serves files with proper MIME types and Content-Disposition headers while preventing path traversal.
- Updated transaction deletion to automatically clean up the associated attachment file from the filesystem.

---

## Add Form Isolation, Validation & Responsiveness

### Clients
- Added email format validation requiring standard email structure.
- Added country validation restricting the field to alphabetic characters and spaces only.
- Added phone validation rejecting alphabetic characters and verifying digit length between 10 and 15 digits.
- Add Client view now displays only the client creation form; existing client list is hidden while adding.
- Removed Download PDF button from the Add Client view.
- Added Close button to return to the Clients list view.

### Employees
- Add Employee view now displays only the employee creation form; existing employee list is hidden while adding.
- Removed Download PDF button from the Add Employee view.
- Close button returns to the Employees list view.

### Projects
- Added future-date validation restricting the project start date to today or past dates.
- Fixed numeric input mouse-wheel behavior on the Project Value field to prevent scroll wheel value modification while allowing normal page scrolling.
- Add Project view now displays only the project creation form; existing project list is hidden while adding.
- Removed Download PDF button from the Add Project view.
- Close button returns to the Projects list view.

### Finance
- Add Transaction view now displays only the transaction creation form; existing transactions, summary, and filters are hidden while adding.
- Removed Download PDF button from the Add Finance view.
- Close button returns to the Finance list view.
- Displayed transaction creation timestamp in the Transaction Details view using formatted date and time.

### Responsive Design
- Improved responsiveness of all Add forms (Employees, Clients, Projects, Finance) for mobile devices.
- Multi-column form layouts adapt to a single column on smaller viewports.
- Adjusted padding, font sizing to prevent mobile zoom, and ensured action buttons remain easily accessible on mobile screens.

### Backend
- Added email, country, and phone format validations to client creation and update endpoints.
- Added future start-date rejection to project creation and update endpoints.

---

## Employee CNIC Uniqueness & Duplicate Protection

### Employee Creation & Uniqueness
- Enforced CNIC uniqueness during employee creation so two employees can never share the same CNIC.
- Entering a CNIC that already exists in the system is immediately rejected and blocks employee creation.
- The Add Employee form displays a clear, understandable validation message ("An employee with this CNIC already exists.") directly on the CNIC field and keeps the form open so the Admin can correct the input.
- Both unformatted 13-digit numbers and formatted strings (e.g. with dashes) are normalized to exact 13 digits before uniqueness checks.
- Prevented creation of duplicate user/login accounts or partial employee records.

### Edit Employee Behavior
- Allowed existing employees to retain their own CNIC during updates without triggering a duplicate error.
- Updating an employee to a CNIC assigned to another employee is blocked with a conflict validation message.
- Updating an employee to a completely unused valid CNIC is permitted and updates both employee and user authentication credentials.

### Database & Backend Protection
- Added a unique constraint on the CNIC column in the employees database table to provide a second layer of database-level integrity alongside the existing users table constraint.
- Verified existing records and established consistent 13-digit CNIC data before applying the constraint.
- Handled potential duplicate key exceptions on the server and returned specific conflict responses rather than generic server errors.

---

## Employee: Inactive Status, Assigned Project & Role in Profile

### Inactive Employee Status
- Added `inactive` as a selectable status option in both the Add Employee form and the Edit Employee form inside the Employee Profile.
- The status list now includes: `internee`, `probation`, `permanent`, `active`, `inactive`, `resigned`, `terminated`.
- Inactive employees are saved, displayed, and listed correctly without affecting their project assignment, role, or login credentials.

### Project & Role in Employee Details
- The Employee Profile (`GET /api/employees/:id`) now left-joins `project_assignments` (filtered by `removed_at IS NULL` to show only active assignments) and `projects` to return the employee's current project name and their role on that project.
- The `role_on_project` field in `project_assignments` is the existing role value that the Admin enters when assigning an employee to a project via the Projects section.
- The detail view shows a **Role** row (value from `project_assignments.role_on_project`) and a **Project** row (value from `projects.name`).
- When no active assignment exists: **Role** displays "No role assigned" and **Project** displays "No project assigned".
- No new tables, columns, or assignment systems were created. The implementation reads directly from the existing `project_assignments` ↔ `projects` relationship.

---

## Finance: Transaction Numbering & Invoice Generator

### Transaction Number
- Added a unique transaction numbering system using the format `TXN-YYYYMMDD-NNNN`.
- Each transaction is assigned a permanent, unique transaction number upon creation.
- The transaction number is permanently linked to the transaction record, displayed in the Finance table and Transaction Details, and used as the filename for generated invoices.
- Sequence counter automatically handles day rollover, uses database-level row locking with retry handling to guarantee uniqueness, and prevents collision even when historical transactions are deleted.

### Invoice Generator
- Added an optional Invoice / Receipt generation toggle to the Add Transaction form.
- Transactions can be created with or without a generated invoice based on administrator choice.
- Invoices are dynamically compiled as professional A4 PDF receipts using the application's existing `pdfmake` architecture.
- Invoices display the authentic Ashtech Digital Solutions logo mark in the top-left corner paired with the official brand name and web address.
- Invoices clearly distinguish between the Transaction Date and the exact backend database creation timestamp (date and time).
- Invoices include all key transaction metadata: Transaction Number, Type, Category, Amount in original currency, locked PKR conversion value, Exchange Rate (for foreign currencies), Payment Method, Linked Entity (Client, Project, or Employee), Description, and Creator Name.

### Invoice Storage
- Generated invoices are saved directly to the server's secure transactions directory (`uploads/transactions`).
- Invoice filenames strictly match the sanitized transaction number (e.g., `TXN-20260925-0001.pdf`).
- The filename is stored in the transaction's `invoice_path` database column.
- Added a protected streaming endpoint (`GET /api/finance/transactions/:id/invoice`) requiring Super Admin authentication with built-in path traversal safeguards.
- When a transaction is deleted via the reveal-protected deletion endpoint, its associated invoice file on disk is safely cleaned up alongside any uploaded attachment without affecting other transactions.

### Transaction Details
- Updated the Transaction Details view to prominently feature the Transaction Number in a stylized brand badge.
- Added full support for viewing generated invoices alongside uploaded attachments:
  - Desktop view displays an equal 50% split layout with the uploaded attachment on the left and the generated invoice PDF preview on the right.
  - When only an attachment or only an invoice exists, the viewer expands to use the full available container space.
  - When neither exists, a clean placeholder indicator is shown.
- Responsive mobile layout automatically transitions the side-by-side view into a vertical stack (Attachment above, Invoice below) without horizontal overflow.
- Added action controls in the detail header with dedicated download dropdowns and browser viewing links for both attachments and invoices.

### Database
- Applied a schema migration to the `transactions` table adding two nullable columns:
  - `transaction_number`: A unique varchar column storing the human-readable transaction identifier.
  - `invoice_path`: A varchar column storing the relative filename of the generated invoice PDF.
- Canonical schema (`database_schema.sql`) was updated to document both fields.
- All existing historical transactions remain valid and undisturbed.

### Testing
- Verified TypeScript build across both backend (`tsc`) and frontend (`tsc -b && vite build`) with zero compilation errors.
- Verified database columns and constraints using MySQL metadata queries.
- Executed live authenticated API testing against the local server using an authentic Super Admin session:
  - Successfully verified transaction creation with `generate_invoice = true`, validating transaction number assignment, disk storage in `uploads/transactions`, database association, and authenticated PDF streaming.
  - Successfully verified transaction creation with `generate_invoice = false`, confirming normal transaction creation without invoice generation and verifying 404 response on the invoice endpoint.
  - Successfully verified transaction creation containing both an uploaded attachment and a generated invoice, confirming concurrent persistence and distinct retrieval endpoints.
  - Verified reveal-authenticated transaction deletion, confirming automatic cleanup of associated invoice and attachment files from the filesystem while preserving unrelated transaction files.
- Confirmed generated PDF binary structure, styling elements, and embedding of the Ashtech logo image.
- Note on automated browser subagent: Playwright headless browser automation encountered a network download limitation for the local browser driver; UI responsiveness and styling rules were verified through CSS layout audits and frontend build checks.

---

## Finance Accounts, Client NTN & Bank Transfer Details

### Client NTN

- Added an optional NTN (National Tax Number) field to the Client form (both Add and Edit).
- The field accepts numeric characters only — no letters, spaces, dashes, or formatting are allowed.
- The raw numeric value is stored in the database without any formatting.
- NTN is displayed in the Client detail view.
- NTN is exposed via the client API response.
- NTN is intentionally excluded from all invoice and PDF generation.
- Server-side validation enforces numeric-only values; malformed or non-numeric NTNs are rejected.

### Finance Accounts

- Added a dedicated `finance_accounts` table supporting account types: `bank`, `cash`, `digital`, `other`.
- Implemented full Accounts CRUD in the Finance backend:
  - `GET /api/finance/accounts` — lists all accounts with dynamically calculated current balance.
  - `POST /api/finance/accounts` — creates a new account.
  - `PUT /api/finance/accounts/:id` — updates an account (requires Reveal Password via `requireReveal` middleware).
  - `DELETE /api/finance/accounts/:id` — deletes an account (requires Reveal Password; blocked if historical transactions exist to protect audit history).
- Account balance is calculated from transaction history (`initial_balance + SUM of inflow - SUM of outflow`), never stored separately, preventing double-counting on edits or deletions.
- Accounts with linked transactions cannot be deleted; deactivation (s### Finance Frontend: Accounts Navigation & Table

- Added prominent **[ Transactions ] [ Accounts ]** navigation tabs in the Finance header matching EMS design aesthetics.
- Added **[ + Add account ]** button in the top action bar alongside the Download PDF button.
- Added a full Accounts table displaying Account, Identifier, Balance, Status, and Actions (Edit, Deactivate/Activate, Delete).
- Added summary metric cards for Total Accounts Balance, Active Accounts count, and Inactive Accounts count.
- Supported account name presets (`UBL`, `HBL`, `Bank Alfalah`, `Meezan Bank`, `Easypaisa`, `MCB`, `Cash`, `Other`) with custom input for "Other".
- Account number/identifier is manually entered and optional for Cash.
- Added one-click account status toggle (Deactivate / Activate) with Reveal Password security.
- Edit and Delete operations reuse the existing EMS Reveal Password mechanism (`requireReveal` / `ems_reveal_token`).
- Deletion is safely blocked by the backend whenever historical transactions exist, preserving financial audit history.

### Transaction → Account Relationship

- Added an optional `account_id` foreign key column on the `transactions` table linking to `finance_accounts`.
- The transaction creation form exposes a **Finance Account (optional)** dropdown populated with active accounts.
- Historical transactions without an account remain safe and appear as "Unassigned" in Transaction Details.
- Dynamic balance calculations on the backend automatically update: `Inflow` adds to balance, `Outflow` subtracts from balance.

### Bank Transfer Details

- When `payment_method = bank_transfer`, the transaction form conditionally shows:
  - **Bank Name**: a dropdown pre-populated with common Pakistani banks plus an **Other** option for manual entry.
  - **Account Number (optional)**: string field preserving leading zeros and accepting valid characters.
- Custom bank names automatically capitalize only the first character (`"bank xyz"` → `"Bank xyz"`).
- Bank transfer details are kept distinct from the company's internal Finance Account.

### Client NTN Validation & Storage

- Added optional numeric-only NTN field to the Client model, validating no letters, spaces, or dashes.
- NTN is stored unformatted in the database and displayed in Client Details; excluded from invoices.

### Build & Test Verification

- Frontend build (`tsc -b && vite build`): 0 errors.
- Backend TypeScript compilation (`tsc`): 0 errors.
- End-to-end verified via automated flow: account creation (`UBL`, `HBL`, `Cash`), editing, deactivation/reactivation, inflow (+100,000 → balance 100,000), outflow (-30,000 → balance 70,000), and transaction delete balance restoration. Safe deletion protection confirmed.
- Backend (`tsc`): 0 errors.

---

## Client Deletion, Finance Account Reveal Session, and Sorting Filters

- **Client Deletion Foreign-Key Fix**:
  - Added pre-deletion validation checking for referencing transactions in `transactions.client_id`.
  - Blocked deletion if historical transactions exist and returned a clean application-level message: *"This client cannot be deleted because it has existing transactions. Please deactivate the client instead."*
  - Added frontend error display on detail view and list view so the clean message is rendered instead of raw MySQL errors.
  - Allowed normal deletion when the client has no transaction history.

- **Finance Account Reveal Password Session Validation**:
  - Diagnosed root cause of *"Reveal session expired"* error: request header case variation and duplicate headers (`x-reveal-token` and `X-Reveal-Token`) resulting in comma-joined tokens failing JWT verification.
  - Updated backend `requireReveal` middleware to support comma-separated tokens, array inputs, and numeric user ID comparisons.
  - Updated frontend `api.ts` to normalize headers, avoid duplicate tokens, and clear expired reveal session tokens from session storage automatically on 403.

- **Finance Account Deactivate & Delete Actions**:
  - Reused existing Reveal Password system without bypassing security.
  - Fixed account deactivation (`Active` → `Inactive`) and reactivation (`Inactive` → `Active`) using the unlocked reveal session.
  - Blocked account deletion when transaction history exists with a clean user message: *"This account cannot be deleted because it has transaction history. Please deactivate the account instead."*
  - Allowed deletion of accounts that have zero transaction history after reveal password unlock.

- **Sorting Filter (No Dates Displayed)**:
  - Added sorting control dropdown (`Newest → Oldest` default, `Oldest → Newest`) to Clients list, Finance Accounts list, and Finance Transactions list.
  - Ensured sorting operates on internal timestamps/IDs while strictly displaying NO creation dates, timestamps, or date columns in the UI for Clients and Accounts.
- Preserved transaction date business-specific ordering for Finance Transactions with ascending/descending options.

---

## EMS + AMS Integration — Phase 1: Super Password and Role Foundation

### Security and Authorization
- Replaced the active Reveal Password/token workflow with a singleton, bcrypt-hashed Super Password stored in MySQL.
- Protected operations now require the Super Password for each individual request; no privileged unlock token or timed browser session is stored.
- Added centralized role-permission mapping so current Admin access can be narrowed later without rewriting every route.
- Enabled the existing `admin` system role while preserving `super_admin` as the only role allowed to promote employees, change the Super Password, or retrieve Recent Activity.
- Added failed-attempt throttling and audit events for Super Password verification without logging password values.

### Employee-to-Admin Promotion
- Added Super Admin-only promotion for an existing linked employee account.
- Promotion retains the same EMS user/employee relationship and changes only the user's authorization role.
- Added the existing reveal-style confirmation UI for the Super Password and did not add Admin demotion.
- Added protection preventing a linked Admin/Super Admin from deleting their own employee account.

### Dashboard and Settings
- Split Recent Activity into a dedicated backend endpoint restricted to `super_admin` and conditionally rendered it only for Super Admin users.
- Admin users can access the current EMS management areas but cannot call the Recent Activity API directly.
- Replaced the Reveal Password settings form with a Super Admin-only Super Password change form.

### Database and Migration
- Added `system_security_settings` for the singleton Super Password hash.
- Added `super_password_attempts` for throttling and security history.
- Extended audit action values for successful and failed Super Password checks.
- Initialized the Super Password from the earliest active Super Admin's existing Reveal Password hash; no plaintext password was created or stored.
- Updated the canonical schema and Super Admin seed script. Legacy Reveal columns/tables remain non-destructively for compatibility but are no longer used by the application.

### Verification
- Backend TypeScript compilation passed with zero errors.
- Frontend TypeScript compilation and Vite production build passed with zero errors.
- Frontend lint completed with no errors and two pre-existing React hook dependency warnings.
- Verified role/API boundaries: Admin can load the business dashboard; Admin and Employee receive `403` for Recent Activity; Employee receives `403` for Super Password verification; Admin receives `403` for changing the Super Password; protected promotion without a Super Password receives `403`.
- Verified the additive migration and live MySQL role/table/audit schema state.

---

## EMS + AMS Integration — Phase 2: Dual Mode Login

### Login and Session Modes
- Added signed session modes for `employee`, `admin`, and `selection_required` while retaining the EMS user, role, and authentication system as the authority.
- Normal employees now enter the Employee Dashboard directly after login.
- Promoted employees with a linked Admin account must choose **Continue as Employee** or **Continue as Admin** after every fresh login.
- Mode choice is session-only. It is not persisted as a remembered preference, and an already selected session cannot switch modes without signing out and logging in again.
- Added a dedicated `POST /api/auth/select-mode` endpoint that verifies current role/account state before issuing the selected-mode token.
- Added current-account and current-role database revalidation to authenticated requests so a stale token cannot retain access after an account is disabled or its role changes.

### Secure Authorization Boundaries
- Employee mode uses the effective `employee` permission set even when the underlying account is an Admin.
- Selection-only sessions cannot access either employee self-service data or Admin management APIs until a mode is chosen.
- Admin mode uses the existing centralized Admin permission set and retains the Phase 1 restrictions on Recent Activity and Super Password management.
- Invalid, forged, or signature-tampered mode claims are rejected; client-side state is not trusted for authorization.

### Frontend
- Added an EMS-branded responsive mode-selection screen with Employee and Admin choices plus Sign Out.
- Updated application routing to render the employee experience from the signed session mode instead of the underlying system role.
- Updated login/session types and reset saved navigation state on every fresh login and mode selection.
- Kept the mode-selection UI within the EMS React/TypeScript application; no AMS authentication or account code was copied.

### Database
- No Phase 2 schema migration or AMS data migration was required.
- The existing EMS `users.role_id` and `users.employee_id` relationship remains the source for detecting dual-mode accounts.

### Verification
- Backend TypeScript compilation passed with zero errors.
- Frontend TypeScript compilation and Vite production build passed with zero errors.
- Frontend lint completed with no errors and the same two pre-existing React hook dependency warnings.
- Live API tests passed for normal Employee, Super Admin, selection-only, Employee-mode Admin, and Admin-mode Admin sessions.
- Verified that Employee mode is denied the Dashboard, Clients, Projects, Finance, and Recent Activity APIs, while retaining self-profile access.
- Verified that Admin mode can access the current management areas but is denied super-admin-only Recent Activity and Super Password changes.
- Verified that invalid modes, repeated mode selection, normal-employee elevation attempts, and JWT mode-claim tampering are rejected.
- Verified that every fresh linked-Admin login returns to mode selection and that an issued Admin token loses Admin access immediately if the database role is restored to Employee.
- Browser-tested the rendered EMS login, direct Employee Dashboard routing, dual-mode chooser, fresh-login reset, and Admin Dashboard routing.
- A linked employee account was promoted only temporarily for isolated testing and was restored to its exact original Employee role; final database state was rechecked.

---

## EMS + AMS Integration — Phase 3: Attendance MySQL Foundation

### Normalized MySQL Architecture
- Added additive MySQL tables for `organization_attendance_settings`, `employee_attendance_settings`, `attendance_sessions`, `attendance_breaks`, `holidays`, and `leave_requests`.
- Attendance records reference the existing authoritative EMS `employees` table; no duplicate attendance employee/account tables were introduced.
- Attendance sessions support multiple records for the same employee and work date, preserving the required remote multi-session model.
- Breaks are normalized as child records of attendance sessions instead of copying AMS JSON break arrays.
- Open, completed, and incomplete states are represented explicitly for both sessions and breaks so incomplete history is preserved rather than deleted.
- Historical attendance sessions and leave requests restrict employee deletion to prevent silent history loss; non-historical employee attendance settings cascade with the employee.

### Settings, Leave, Holidays, and Time
- Added typed employee attendance mode (`gps` or `remote`) and weekly/monthly targets stored as integer minutes to avoid floating-point hour calculations.
- Added a singleton organization attendance configuration with `Asia/Karachi` as the explicit timezone.
- Office latitude, longitude, and radius are nullable as one validated bundle; no AMS coordinates or hardcoded 100-metre radius were copied into EMS.
- Added full-day and short-hours leave structures with database checks for date order, same-day short leave, and valid time brackets.
- Added manual holiday storage with unique dates and no seeded weekends or automatic holidays.
- Attendance sessions store UTC datetimes alongside an explicit office-local `work_date` and timezone snapshot.

### TypeScript Foundation
- Added strict TypeScript attendance models for settings, sessions, breaks, holidays, leave, and GPS validation results.
- Added reusable validation for organization settings, employee targets/modes, GPS coordinates, ISO dates, local times, and leave requests.
- Added attendance time helpers for UTC SQL values and timezone-aware work-date resolution.
- Added a settings service that returns typed organization/employee settings, initializes missing employee defaults safely, and refuses GPS use until the complete office location bundle is configured.
- No attendance API routes or frontend attendance UI were added in this phase.

### Migration and Verification
- Added a rerunnable attendance-foundation migration with table-shape verification and safe backfill of default attendance settings for existing EMS employees.
- Applied the migration to the live EMS MySQL database twice successfully to verify idempotency.
- Added a dedicated verification script covering table engines, foreign keys, deletion rules, indexes, seeded row counts, timezone boundaries, validation, multiple same-day sessions, normalized breaks, incomplete records, leave constraints, manual holidays, and database constraint rejection.
- All verification records run inside a transaction and are rolled back; no test attendance, leave, break, holiday, or employee records remain.
- Confirmed that no AMS attendance/history data was imported.
- Backend TypeScript compilation passed with zero errors.
- Frontend TypeScript compilation and Vite production build passed with zero errors.
- Frontend lint completed with zero errors and the same two pre-existing React hook dependency warnings.

---

## EMS + AMS Integration — Phase 4: Attendance Backend

### Authoritative Service and APIs
- Added one TypeScript attendance service/calculation layer for state transitions, daily totals, weekly/monthly targets, and calendar/date status; routes do not duplicate attendance calculations.
- Added employee self-service APIs for current state, check-in, break-out, break-in, check-out, bounded history, calendar summaries, and weekly/monthly summaries.
- Added read-only Admin/Super Admin employee attendance APIs for future employee attendance views; no manual edit, delete, or on-behalf-of attendance actions were added.
- Employee self-service identity always comes from the authenticated EMS user and selected Phase 2 mode. Arbitrary employee IDs are accepted only by permission-protected Admin read routes.

### Attendance Rules and Calculations
- Implemented explicit session transitions and structured state errors. Check-out with an open break is rejected rather than silently closing or rewriting the break.
- Remote attendance retains multiple completed sessions on one work date. Normalized completed breaks are subtracted consistently, while open/incomplete history remains preserved.
- Uses server-generated UTC event times and the Phase 3 `Asia/Karachi` work-date helper. Cross-midnight sessions remain attached to the check-in work date.
- Daily aggregation retains every session and exposes completed/open/incomplete counts, spans, completed break time, completed worked time, current-session time, and break state.
- Weekly/monthly aggregation uses employee targets and safely returns an unconfigured/null progress value for zero targets.
- Approved short-hour leave is exposed separately and does not alter actual worked time because the deduction rule remains unapproved/ambiguous.

### GPS, Calendar, and Concurrency
- GPS/office actions validate supplied coordinates on the server with Haversine distance and the configured office radius, including boundary tolerance. Missing office configuration fails closed with a structured service error.
- No continuous location tracking or GPS event storage was added; the Phase 3 schema has no justified location-history fields.
- Calendar status derives from configured holidays, approved full-day/short-hour leave, aggregated attendance, incomplete state, and future dates. Weekends are not automatically holidays and absence creates no fake attendance rows.
- Added transactional row locking plus database unique generated-key constraints for one open session per employee and one open break per session, protecting against double submission across application instances.
- The Phase 4 constraint migration was applied twice successfully. The canonical schema and fresh-install foundation migration include the same constraints.

### Employee Lifecycle Safety
- New EMS employees receive default remote attendance settings.
- Permanent employee deletion now returns a clean `409 EMPLOYEE_HAS_ATTENDANCE_HISTORY` response when attendance or leave history exists; historical foreign keys remain restrictive.

### Verification
- Added isolated service verification covering remote multi-session attendance, multiple breaks and subtraction, invalid transitions, GPS inside/outside/exact boundary and missing configuration, concurrency races, Karachi midnight/cross-midnight behavior, incomplete-history preservation, daily/weekly/monthly calculations, zero targets, and calendar precedence.
- Added live API verification covering unauthenticated access, own-employee access, IDOR denial, bounded date ranges, tampered JWTs, selection-required sessions, and promoted Admin behavior in Employee versus Admin mode.
- Verification data and temporary role changes were cleaned up; the Phase 3 no-import/zero-attendance baseline still passes.
- Backend TypeScript compilation passed. Frontend TypeScript compilation and Vite production build passed without Phase 4 frontend changes. Frontend lint has zero errors and the same two existing hook-dependency warnings.
- Live regression checks passed for health, EMS login, employee self-profile, Super Admin dashboard/employees/clients/projects/finance, Super Admin-only Recent Activity, employee access denials, and Super Password role protection.

### Deferred Decisions
- A payroll/attendance formula for approved short-hour leave remains intentionally unresolved; Phase 4 reports the leave duration separately and never deducts it from worked time.
- An old open session or explicitly incomplete session blocks a new check-in with a non-destructive structured error. Resolving that history requires a separately approved future correction workflow.
- GPS/office mode permits one session per work date, matching the approved office behavior; remote mode is the multi-session mode.

---

## EMS + AMS Integration — Phase 5: Employee Attendance UI

### Employee Attendance Experience
- Added a TypeScript/TSX employee Attendance page inside the existing EMS shell, branding, navigation, and responsive mobile sidebar without replacing or reducing the Employee Dashboard/self-profile.
- Added organized typed frontend API helpers and response models for the approved Phase 4 current-state, action, history, calendar, and summary endpoints; React only formats backend-calculated durations and progress.
- Added an Asia/Karachi date/time presentation, explicit current-state messaging, a display-only live working timer restored from backend state after refresh, daily summary cards, weekly/monthly progress, calendar, and bounded 90-day history.

### GPS / Office Workflow
- GPS/office employees see one daily session with normalized child breaks. Working state offers Break Out and Check Out; break state offers only Break In; checkout is unavailable during an active break.
- Browser geolocation is requested only for an attendance action and sent in the Phase 4 coordinate envelope. The server remains authoritative for radius validity; no frontend distance decision or continuous tracking was added.
- Completed GPS/office attendance clearly marks the day complete and never renders Check In Again. Multiple Break Out/Break In cycles remain visible beneath the same session.
- Added employee-facing messages for denied/unavailable/timed-out browser location and structured backend errors including outside radius, missing GPS configuration, invalid state, missing settings, and unresolved attendance.

### Remote Workflow
- Remote employees retain multiple independent sessions per work date and receive Check In Again after a completed session.
- Today's Sessions and history render every backend session separately, including multiple normalized breaks within each session, without collapsing rows by work date.
- Daily worked time, completed break time, session count, weekly/monthly totals, targets, and progress are displayed from backend aggregates. Zero targets render a neutral No target set state.

### Calendar, History, and Styling
- Added semantic calendar states for present, absent, configured holiday, full-day leave, short leave, incomplete, current/pending, and future/no data; weekends receive no special client-side rule.
- Incomplete sessions/breaks remain visible with a non-destructive action-required warning and no edit/delete/correction controls.
- Adapted the useful AMS attendance hierarchy into maintainable EMS CSS with scoped attendance variables and desktop, tablet, and mobile layouts; no Tailwind attendance code or system-wide dark mode was added.

### Verification
- Browser-tested the exact GPS example as one 09:00–17:00 session with three completed breaks, 1h 05m backend break time, 6h 55m backend worked time, and no second-session action after checkout.
- Browser-tested the exact remote example as three separate same-day sessions, including a break in Session #2, Check In Again, and the backend 7h 05m aggregate.
- Verified live employee actions and browser refresh recovery in working, active-break, and completed states. Verified mocked in-radius GPS actions, three GPS break cycles, outside-radius messaging, and missing-configuration messaging.
- Verified desktop rendering plus 768px tablet and 390px mobile layouts with no horizontal overflow; browser console produced no warnings or errors.
- Backend and frontend TypeScript compilation, the Vite production build, and frontend lint passed. Lint retains only the two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Re-ran the Phase 3 foundation, Phase 4 attendance service, and live attendance API verification suites successfully, including authentication, mode/role boundaries, GPS/state/concurrency, aggregation, calendar, and cleanup checks.
- All temporary Phase 5 employees, sessions, breaks, credentials, office coordinates, and mocked browser location state were removed after verification. No backend correction was required.

### Deferred Scope
- Leave request/approval and holiday management remain Phase 6.
- Admin attendance dashboards and employee attendance administration remain Phases 7 and 8.
- The unresolved short-hour leave payroll/worked-time formula remains unchanged; Phase 5 only displays the backend-provided calendar status and actual worked time.

---

## EMS + AMS Integration — Phase 6: Leave + Holiday Management

### Leave Backend and Workflow
- Added a typed leave service and EMS routes for employees to create/list/view only their own full-day and short-hour requests; employee identity and initial `pending` status are always derived server-side.
- Added server validation for date order, same-day short hours, start-before-end, maximum 366-day ranges, reason length, and pending/approved overlap conflicts. Full-day requests conflict with any covered leave and short-hour requests conflict with covering full-day or overlapping short-hour requests.
- Added Admin/Super Admin management filtering and atomic, row-locked `pending` to `approved` or `rejected` decisions. Final decisions cannot be reversed or double-submitted.
- Approved short-hour leave remains separately represented and does not add to or subtract from actual attendance worked time.

### Holiday Backend and Calendar Integration
- Added typed holiday list/create/update/delete services and routes using the existing Phase 3 `holidays` table, unique holiday dates, EMS permissions, transactions, and clear duplicate/not-found errors.
- Preserved the rule that no weekday or weekend is automatically a holiday and no public-holiday dataset is seeded or imported.
- Leave decisions and holiday mutations flow through the existing Phase 4 calendar calculation; no fake attendance rows or frontend attendance calculations were introduced.

### Permissions, Audit, and UI
- Added centralized `leave:manage` and `holidays:manage` permissions for Admin/Super Admin while Employee mode remains ownership-scoped self-service only.
- Promoted Admins in Employee mode cannot review leave or manage holidays; Admin mode cannot use employee self-service leave routes. Recent Activity remains Super Admin-only and no Phase 6 action requires Super Password.
- Added atomic audit events for leave approval/rejection and holiday create/update/delete without auditing routine list reads.
- Added responsive TypeScript/TSX Employee Leave, Admin Leave Management, and Holiday Management pages inside the EMS shell. Forms adapt between full-day and short-hour fields, status is conveyed with text and semantic styling, and management actions appear only on pending requests.
- Added organized typed frontend API helpers and shared leave-request cards; no AMS Tailwind components or authentication code were copied.

### Verification
- Added database-backed Phase 6 service verification for validation, duplicate/overlap handling, pending/approved/rejected calendar behavior, concurrent decisions, short-hour separation, holiday CRUD/duplicates/calendar effects, weekend behavior, ownership, management filtering, audit events, and cleanup.
- Added live API verification for unauthenticated access, normal Employee, promoted Admin in Employee/Admin modes, Admin, and Super Admin; verified server-authoritative ownership/status, decision conflicts, holiday permissions, and the Recent Activity boundary.
- Browser-verified Employee Leave, adaptive short-hour fields, Admin Leave Management, and Holiday Management on desktop and 390px mobile layouts. No temporary business records remain.
- Backend/frontend TypeScript compilation and the Vite production build passed. Frontend lint has zero errors and retains only the two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Re-ran Phase 3 foundation, Phase 4 service, and Phase 4 live API suites successfully. Updated the Phase 3 verification-only empty-table assertion because legitimate Phase 4/5 EMS attendance records now exist; no schema or business data was changed by that correction.

### Deferred Scope and Known Rule
- Leave requests targeting a configured holiday are not assigned payroll consequences; existing Phase 4 holiday precedence remains authoritative.
- The short-hour payroll/target formula remains intentionally unresolved. Phase 6 records and displays approved short leave without changing worked duration.
- Admin attendance analytics, employee attendance administration, manual attendance correction, and dark mode remain deferred to later approved phases.

---

## EMS + AMS Integration — Phase 7: Admin Attendance Dashboard

### Authoritative Analytics Backend
- Added a typed Admin/Super Admin attendance-dashboard endpoint and reusable analytics service on top of the approved Phase 4 calculations. The service performs bounded bulk reads for active EMS employees, sessions, breaks, holidays, and approved leave rather than issuing per-employee queries.
- Added KPI data for active employees, today's present/absent state, and pending leave. Attendance is counted once per employee, so remote multi-session days do not inflate employee-level totals.
- Added server-derived 7-day, 30-day, 60-day, and 6-month overview buckets plus Team Status counts/percentages using existing attendance, leave, holiday, incomplete, pending, future-date, and absence rules.
- Added a daily 24-hour timeline response that preserves remote sessions independently and represents GPS/office breaks as gaps within one session. Incomplete attendance remains visible without inventing an unverified worked interval.
- Active attendance population is defined by `employees.status = 'active'`; resigned, terminated, or otherwise inactive employees are excluded. No schema migration or new database index was required for the approved Phase 7 query sizes.

### Permissions and UI
- Added centralized `attendance:analytics` permission for Admin/Super Admin. Router-wide Phase 2 mode enforcement keeps normal Employees and promoted Admins in Employee mode out of the analytics API; Recent Activity remains Super Admin-only.
- Added a separate responsive Attendance Dashboard to the existing Admin/Super Admin EMS navigation without replacing or changing the business Dashboard.
- Added typed frontend response models and one organized API helper. React renders backend totals and status counts without recalculating authoritative attendance state.
- Added EMS-styled KPI cards, stacked overview, Team Status ring/legend, date navigation, period selector, search/status filters, Sync, and a horizontally contained 24-hour timeline. Desktop, 768px tablet, and 390px mobile layouts were verified without page-level overflow.
- Added a clear Attendance Report entry point that explicitly defers report generation/download and its audit workflow to Phase 9; no fake report was generated.

### Verification
- Added an isolated five-employee analytics verification fixture covering a GPS employee with three breaks, a remote employee with three sessions, an employee with no attendance, an approved full-day leave, and incomplete attendance. It also verifies current-day pending semantics, past absence, configured holidays, inactive exclusion, break-adjusted working segments, overview buckets, and fixture cleanup.
- Added live API authorization verification for unauthenticated access, normal Employee, promoted Admin in Employee/Admin modes, Super Admin, invalid date/period validation, and the Recent Activity boundary.
- Re-ran the Phase 3 foundation, Phase 4 service/API, and Phase 6 leave/holiday service/API suites successfully. The Phase 7 API suite also passed against a clean temporary backend process after the shared development server's existing login rate limit was exhausted by consecutive suites.
- Backend TypeScript compilation, frontend TypeScript/Vite production build, frontend lint, API health, and live browser console checks passed. Lint retains only the two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Verified that no Phase 7 fixture users, employees, holidays, sessions, breaks, or leave records remain. The AMS codebase was used read-only and was not modified.

### Deferred Scope
- Attendance employee profiles and detailed employee administration remain Phase 8.
- Actual attendance report generation/download remains Phase 9.
- Manual attendance correction, new attendance rules, and dark mode remain outside Phase 7.

---

## EMS + AMS Integration — Phase 8: Attendance Employees Directory + Individual Profile

### Attendance Employees Directory
- Added a dedicated Attendance → Employees directory for Admin/Super Admin without changing the canonical HR Employees module. The directory includes every EMS employee, clearly distinguishes inactive historical employees, and supports bounded work-date selection plus name/code/designation, attendance mode, employment status, and attendance-state filters.
- Added an efficient bulk backend read that loads employee/settings/project/account data and attendance/break data in bounded queries rather than performing per-employee API or database loops.
- Directory rows use Phase 4 calculations for current state, selected-day worked time, session counts, and weekly target progress. Remote multi-session data is aggregated without inflating the employee count.

### Individual Attendance Profile
- Added a read-only individual attendance profile with canonical EMS employee/project information, selected-date navigation, current state, backend-calculated daily/weekly/monthly summaries, calendar, bounded history, approved/pending/rejected leave history, and incomplete-attendance warnings.
- Remote profiles retain every same-day session and each session's normalized child breaks. GPS/office profiles present the single daily session and its multiple child breaks without suggesting another daily check-in.
- Existing canonical EMS employee details remain sourced from the existing protected employee endpoint; Phase 8 does not duplicate employee master data or add attendance-side employee editing/deletion.

### Attendance and Organization Settings
- Added Admin/Super Admin management of employee attendance mode and weekly/monthly targets using the existing Phase 3 settings table. Hour values are converted to validated integer minutes at the API boundary.
- Attendance mode/target changes affect future behavior only. Existing session, break, leave, and calendar history is not rewritten, reclassified, deleted, or migrated.
- Added organization GPS configuration to the existing EMS Settings page using the Phase 3 singleton organization table: latitude, longitude, and allowed radius may be saved as one validated bundle or explicitly cleared.
- Added server validation for coordinate bounds, finite target values, and practical target/radius limits. GPS configuration remains fail-closed when incomplete; no continuous location tracking or AMS coordinates were introduced.

### Permissions, Audit, and Navigation
- Added centralized `attendance:settings:manage` permission for Admin/Super Admin. Existing router mode enforcement denies the attendance directory, profiles, and settings to Employees and to promoted Admins operating in Employee mode.
- Added transactional row locking and audit events for employee attendance-setting changes and organization GPS-setting changes, including non-secret before/after metadata. Ordinary directory/profile reads are not audit-flooded.
- Kept Recent Activity Super Admin-only and did not expand Super Password requirements.
- Added a single internal Attendance section navigation for Dashboard, Employees, Leave Requests, and Holidays, avoiding duplicate top-level destinations while leaving the main HR Employees navigation unchanged.

### API and UI
- Added typed Admin/Super Admin APIs for the attendance employee directory, employee attendance profile, employee attendance settings update, and organization attendance settings read/update.
- Added strict TypeScript frontend models and one organized attendance-employees API module; no raw attendance fetch logic is scattered through UI components.
- Added responsive EMS-styled directory, profile, settings forms, session/break details, summaries, progress, calendar, leave history, loading/error/empty states, and incomplete-history warnings. The AMS application was used only as a read-only visual/behavioral reference.

### Verification
- Added service verification with five employees covering GPS one-session/three-break behavior, remote three-session behavior, leave, incomplete attendance, inactive historical employees, profile semantics, Remote → GPS → Remote setting changes, exact history preservation, target-minute storage, organization GPS validation, and audit events.
- Added live API verification for unauthenticated denial, Employee denial, promoted Admin denial in Employee mode, Admin-mode directory/profile/settings access, validation failures, Super Admin access, and the Recent Activity boundary.
- Re-ran the Phase 3 foundation, Phase 4 attendance service/API, Phase 6 leave/holiday service/API, and Phase 7 analytics service/API suites successfully. All Phase 8 fixtures and temporary organization coordinates were removed/restored.
- Backend and frontend TypeScript production builds passed. Frontend lint has zero errors and retains only the two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Browser-verified the directory, individual profile, organization GPS settings, internal Attendance navigation, desktop, 768px tablet, and 390px mobile layouts without page-level overflow or console errors. EMS backend health and frontend availability remain green.

### Database and Deferred Scope
- No new Phase 8 tables, columns, indexes, migrations, or AMS data were added. Phase 8 uses the approved Phase 3 schema and Phase 4 calculations.
- Manual attendance correction, on-behalf-of attendance actions, employee deletion from attendance, and new calculation rules remain excluded.
- Actual attendance report generation/download remains Phase 9. System-wide dark mode remains Phase 10. Neither phase was started.

---

## EMS + AMS Integration — Phase 9: Attendance Reports + Audit Integration

### Attendance Reports Backend
- Added a typed attendance-report validation, service, and PDF layer behind the centralized `attendance:reports` permission for Admin Mode and Super Admin.
- Reports support required start/end dates, All Employees or one canonical EMS employee, attendance mode, attendance status, and employment status. Date ranges are server-validated and bounded to 366 days; preview pages are bounded to at most 100 rows.
- The service uses one bounded employee/settings query plus bounded session/break, approved-leave, and holiday queries. It does not perform employee × date database/API queries and does not retrieve salary, CNIC, bank, or other unrelated sensitive data.
- Employee-day status and time values reuse the approved Phase 4 `calculateDailyAttendance` and `calculateCalendar` functions. Weekends are not automatic holidays, short leave remains separate from worked time, and incomplete/open records receive no invented verified duration.

### Report Semantics, Preview, and PDF
- Added backend-generated summary totals for employees, employee-days, present, absent, full-day leave, short leave, holidays, incomplete, pending/current, future/no-data, verified worked time, and completed break time.
- Remote employees count once per employee-day while retaining every independent session and the gaps between them. GPS/office attendance remains one daily session with normalized child breaks and break-excluded worked time.
- Added a responsive Reports view within the existing Attendance section, with filter generation, loading/error/empty states, summary cards, paginated employee-day rows, and expandable server-provided session/break details.
- Connected both Phase 7 Dashboard report actions to the real Reports view and removed all Phase 9 placeholder messaging.
- Added a real server-generated A4 PDF using the existing EMS `pdfmake`/`buildPdf` architecture. It contains EMS identity, applied filters, generated timestamp, summary, employee-day rows, truthful session/break details, and page numbers with controlled filenames and no persisted temporary server files.

### Permissions and Audit
- Added `attendance:reports` to the centralized Admin/Super Admin permission set. Normal Employees and promoted Admins in Employee Mode are denied by the existing authenticated mode/permission middleware.
- Successful PDF generation creates one `attendance_report` audit event with actor, date range, employee/all filter, mode/status/employment filters, generated timestamp, and employee-day count. PDF binary, credentials, and sensitive employee information are not logged.
- Confirmed existing audit coverage for leave approval/rejection, holiday create/update/delete, employee attendance mode/target changes, and organization GPS-setting changes; no duplicate events were added.
- Attendance report activity flows through the existing Recent Activity endpoint for Super Admin. Admin remains denied access to Recent Activity and no Super Password requirement was added.

### GPS Settings UX Improvement
- Added an optional Fetch Current Location action to the existing organization attendance location form. It performs one browser geolocation request, fills latitude/longitude only, reports approximate accuracy, and still requires the existing explicit Save action.
- Manual latitude/longitude editing remains available and the allowed employee check-in radius remains a separately editable value clearly labelled in metres. Fetched accuracy is informational and is never used or stored as the radius.
- Added clear permission-denied, unavailable, timeout, unsupported-browser, and invalid-coordinate messaging. Fetching does not call the settings API and therefore creates no audit event.
- Preserved backend coordinate/radius validation, organization-settings authorization, save audit behavior, and Phase 4/5 server-authoritative point-in-time GPS check-in rules. No continuous tracking or map dependency was added.

### Verification
- Added a six-employee report fixture covering GPS with one session/three breaks, remote with three sessions, absence, approved full-day leave, approved short leave with actual attendance, incomplete attendance, and an explicitly configured holiday.
- Verified employee-day counting, remote gap exclusion, GPS break subtraction, short-leave separation, incomplete-duration safety, employee/status filters, bounded validation, pagination, and cleanup.
- Generated and rendered a real two-page A4 verification PDF. Visual inspection confirmed the title, range, filters, summary, rows, truthful remote sessions, GPS breaks, page numbers, multi-page continuation, and absence of clipping or sensitive HR data. The temporary PDF/rendered pages were removed afterward.
- API verification passed for unauthenticated, normal Employee, promoted Admin Employee/Admin modes, and Super Admin report/GPS access; invalid dates/employee IDs/coordinates/radii; PDF content type; report/configuration audit events; and the Recent Activity boundary.
- Browser verification passed for desktop, 768px tablet, and 390px mobile report/filter/preview layouts with no page-level overflow or console errors. GPS form verification covered success with accuracy, permission denial, unavailable, timeout, unsupported browser, manual entry, frontend validation, non-persistence before Save, and explicit-save messaging.
- Re-ran Phase 3 foundation, Phase 4 service/API, Phase 6 leave/holiday service/API, Phase 7 analytics service/API, and Phase 8 attendance-employees service/API suites successfully. Backend and frontend production builds passed; frontend lint has zero errors and the same two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- All Phase 9 fixture users, employees, sessions, breaks, leave, holidays, audit records, generated PDF artifacts, and temporary AMS database copy were removed. Original organization GPS values were restored.

### Dependencies, Database, and Deferred Scope
- No dependency was added; Phase 9 reuses the existing EMS PDF stack and browser geolocation API.
- No database table, column, index, migration, or AMS data change was required.
- Manual attendance correction/edit/delete, payroll treatment, short-hour target deductions, continuous GPS tracking, maps, Phase 10 visual overhaul/dark mode, and Phase 11 final exhaustive validation remain unimplemented.

---

## POST-PHASE-9 FINANCE / INVOICE CORRECTIONS

### Finance Authorization Boundaries
- Removed `finance:manage` from the Admin role and retained it for Super Admin only through the centralized backend and frontend permission maps. Promoted Admins in Admin Mode are denied finance APIs, reports containing finance details, the Finance navigation/page, dashboard finance cards, and client/project finance details.
- Dashboard finance data is now queried and returned only for callers with the finance permission. Admin dashboard payloads omit finance entirely while Super Admin behavior remains unchanged.
- Client and project operational access remains available to Admin, but client transaction history, finance summaries, and finance-bearing client/project PDF actions are hidden and protected. Recent Activity and all attendance permissions remain unchanged.

### Finance Accounts and Transaction Entry
- Preserved Account Type as the existing payment/delivery category while making Account Name a true free-form invoice-facing label with the exact placeholder `This is what will be shown in the invoice`.
- Kept Bank Name as a separate actual-bank field with a predefined list and an Other/custom option. The selected EMS receiving account remains separate from the client/sender account number.
- Removed the Employee selector and employee requirement from new finance transactions. New rows store `employee_id = NULL` while `created_by` continues to identify the authenticated actor.
- Added client-dependent project options with immediate reset on client change. The backend independently validates that the submitted project belongs to the submitted client and rejects forged mismatches.
- Clarified that the transaction-specific account number is the client's/sender's account number; receiving-account identity is sourced from the selected EMS finance account.

### Invoice Architecture and Numbering
- Added a specialized, server-generated client invoice layer using the existing pdfmake stack instead of treating a transaction receipt as an invoice.
- Added persisted invoice snapshots for invoice number, pair sequence, Karachi issue date, currency, subtotal, fixed 5% sales tax, tax amount, and invoice total. The existing transaction amount remains the actual amount paid, and the remaining balance is calculated from persisted invoice values.
- Implemented `ASH-{CLIENT_INITIALS}-{PROJECT_INITIALS}-{SEQUENCE}` invoice numbers with deterministic initials and a transactionally locked per-client/per-project sequence table. A unique database index provides an additional collision safeguard under concurrent creation.
- Kept Client NTN in the canonical existing client field and renders it in the invoice's Bill To section.
- Invoice search accepts the prominent invoice number while retaining search by the legacy internal transaction reference. Invoice downloads and previews use the exact invoice number as the PDF filename.

### Invoice Content and Payment Semantics
- The invoice presents EMS identity and branding, invoice number/date, Bill To and NTN, Billed By, project/service, currency, subtotal, 5% tax, total, amount paid, remaining balance, payment method, payment note, and professional footer content.
- `SENT TO` means the selected EMS account's Account Name plus Bank Name. The EMS receiving account number is intentionally excluded from the client invoice.
- The client/sender account number is shown separately where applicable and is never written to audit metadata. Invoice creation is limited to qualifying client-payment inflows with the required canonical client, project, and receiving-account data.

### Database and Legacy Compatibility
- Added an idempotent additive migration for nullable invoice snapshot columns, the unique invoice-number index, and the `invoice_sequences` table. Existing transaction columns, rows, attachments, and legacy invoice/receipt files are preserved without backfill or destructive alteration.
- Updated the checked-in schema to document Account Name, Bank Name, the transaction-specific sender account number, invoice snapshots, and sequence locking.
- Legacy transactions without an invoice number continue to display and download safely using their internal `TXN-...` reference; no old financial record was rewritten.

### Verification
- Backend TypeScript compilation and frontend TypeScript/Vite production build passed. Frontend lint passed with zero errors and retains the same two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Added an isolated API verification covering money/initial calculations, Admin finance denial, Admin dashboard/client/report redaction, preserved Admin attendance access, exact Account Name/Bank Name storage, forged project/client rejection, exact invoice numbering, persisted 5% tax snapshot, actual paid/remaining semantics, sender-account separation, null employee attribution, concurrent unique sequencing, invoice and legacy-reference search, PDF response filenames, preview behavior, and audit-data exclusion.
- The verification generated `ASH-TN-AM-0001`, then concurrently allocated `0002` and `0003` for the same client/project pair. All temporary database fixtures and generated server invoice files were removed.
- Rendered and visually inspected the generated one-page A4 invoice against the supplied Dr Taha Nazir invoice reference. The result showed the required branding, identifiers, NTN, service, totals, payment information, `SENT TO` semantics, separate client/sender account, footer, and no EMS account number, clipping, or overflow.
- Live browser inspection confirmed the Super Admin Finance experience, updated account and transaction forms, invoice search/reference presentation, and client-to-project filtering. The user elected to perform the remaining manual/regression checks independently, so no further runtime checks were executed.

### Deferred Scope
- The current approved model creates one persisted invoice snapshot for one qualifying client-payment transaction. Multi-payment allocation against a single invoice remains a future business-model decision and was not invented in this checkpoint.
- Phase 10 was not started. System-wide dark mode/visual overhaul and Phase 11 exhaustive validation remain deferred.

### Approved Follow-up: Admin Finance Access Restored
- Restored `finance:manage` to Admin in both centralized backend and frontend permission maps while retaining all invoice, account, form, PDF, tax, numbering, schema, and legacy-compatibility changes from this checkpoint.
- Admin can again see Finance navigation, transactions, dashboard finance totals, client finance details, and finance-bearing reports. Recent Activity remains Super Admin-only, and Employee/Employee Mode finance restrictions remain unchanged.

---

## POST-PHASE-9 AUTH / LETTER / FINANCE CORRECTIONS

### Admin Transaction Access
- Preserved the current manually restored behavior: Admin in Admin Mode and Super Admin retain Finance/Transactions/Accounts access, dashboard finance totals, finance-bearing client/report access, and invoice search/download. Employee and Employee Mode remain denied; Recent Activity remains Super Admin-only.

### Forgot Password and Reset Review
- Added a public Login-page request flow using CNIC, new password, and confirmation. Responses are deliberately generic, requests are rate-limited, the proposed password is bcrypt-hashed immediately, and plaintext passwords are never persisted, returned, or audited.
- Added one-pending-request enforcement and Admin/Super Admin review under Employees. Approval atomically installs the pending hash; rejection preserves the current password. Row locking prevents conflicting concurrent decisions and finalized requests discard their pending hash.
- Added centralized `password_resets:manage` permission and safe audit events for approve/reject decisions without passwords, hashes, or sensitive reset material. Promoted Admins in Employee Mode and normal Employees are denied management access.

### Employee Official Letters
- Added Hiring, Promotion, and Termination letter composition to Employee Profile with editable subject/body, relevant effective-date/designation/note fields, preview, generation/download, and immutable per-employee history.
- Added a server-side A4 PDF generator based on the supplied Ashtech letterhead: branded logo/contact header, subtle watermark, registration footer, professional typography, repeatable multi-page layout, and canonical filenames. Preview creates no history/audit record; generation snapshots only necessary employee/letter details and does not mutate employee designation or employment status.
- Added centralized `employee_letters:manage` permission, Admin/Super Admin mode enforcement, safe generation audit metadata, protected history on employee deletion, and no normal Employee access.

### Finance and Invoice Corrections
- Kept Account Name as the invoice-facing EMS receiving-account label and Bank Name as its actual bank. Add Transaction now captures a transaction-specific Sender Bank plus the client's/sender's Account Number; selecting Other exposes a required custom bank name.
- Preserved client-dependent project filtering and server-side client/project ownership validation. Invoice subtotal is now derived exclusively from the selected project's canonical Project Total/currency; manual subtotal entry is removed and payment currency must match the project.
- Preserved fixed 5% sales tax, persisted invoice snapshots, Amount Paid from the transaction payment, Remaining Balance from the authoritative invoice total, deterministic invoice numbering, case-insensitive invoice search, exact-number PDF filenames, Client NTN, and legacy transaction compatibility.
- Updated Payment Information to show `Bank Transfer (Sender Bank)` plus the client sender account number. `SENT TO` shows only the selected EMS Account Name and Bank Name; the EMS receiving account number is intentionally omitted.

### Backend, Database, UI, and Verification
- Added typed password-reset and employee-letter routes/services, the official-letter PDF generator, an idempotent additive migration, checked-in schema definitions, permissions, route mounting, and targeted verification scripts. Existing `transactions.bank_name` is reused as the sender-bank snapshot; no second overlapping finance column was introduced.
- Added TypeScript/TSX reset management and employee-letter interfaces plus focused responsive EMS styles. No AMS source, Phase 10 styling, authentication architecture, Super Password scope, attendance calculations, or existing financial history was changed.
- Verified reset non-enumeration, hashing, duplicate requests, approval/rejection, concurrent decisions, old/new login behavior, mode/role boundaries, audit secrecy, all three letter types, history, deterministic filenames, no employee mutation, Admin finance access, account/bank separation, Other-bank payloads, forged client/project rejection, project-derived totals, 5% tax, sender details, concurrent invoice numbering, search, and PDF responses.
- Backend TypeScript, frontend TypeScript, Vite production build, migration rerun, finance/API verification, and the new auth/letter API suite passed. Rendered and visually inspected all three official letters, a three-page long letter, and the reference-aligned invoice; headers, watermarks, footers, totals, payment fields, dates, and margins were verified without clipping.
- Phase 4, 6, 7, 8, and 9 service regressions passed when run without shared-fixture concurrency. The legacy Phase 3 foundation script still assumes organization GPS is unconfigured, while the current live EMS configuration contains intentional GPS values; no production setting was changed to satisfy that stale assertion.

### Known Boundary
- One invoice snapshot remains associated with one qualifying client-payment transaction. Multi-payment allocation against a single invoice is still an unresolved future business-model decision. Phase 10 was not started.

---

## POST-PHASE-9 REQUESTS / APPLICATIONS / DOCUMENT / FINANCE CORRECTIONS

### Centralized Employee Applications
- Replaced the employee-facing Leave navigation destination with an Applications workspace containing separate Leave Application and General Application tabs. The approved leave backend, status workflow, and attendance/calendar calculations remain unchanged.
- Added authenticated general applications with server-derived employee identity, category, subject, application date, multiline body, draft PDF preview, employee-owned history, status, review details, and downloadable Ashtech-letterhead PDF. Employee identifiers supplied by the client are never trusted.
- Added pending → approved/rejected management with transactional row locking, final-state enforcement, Admin/Super Admin permission checks, promoted-Admin mode isolation, ownership-protected employee reads/PDFs, and safe decision audit metadata that excludes application bodies.

### Requests Workspace and Duplicate-Workflow Removal
- Added one Admin/Super Admin Requests destination with Leave Requests, Applications, Password Resets, and Employee Letters tabs.
- Removed Leave Requests from the Attendance subnavigation and Password Reset Requests from Employees. Moved official-letter composition to Requests while retaining read-only letter history on Employee Profile.
- Preserved Super Admin-only Recent Activity, ordinary Admin access to approved request-management actions, existing Super Password boundaries, and Employee/Employee Mode denial for management endpoints.

### Authenticated Change Password
- Added an Employee Account destination using the existing EMS settings architecture. Login-password changes now require current password, new password, and confirmation; validate length/match/difference; lock the user row; verify bcrypt server-side; atomically replace the hash; and write only non-secret audit metadata.
- Kept authenticated password change separate from the public Forgot Password request/review workflow. Passwords and hashes are never returned or audited.

### Official Document Corrections
- Standardized official employee-letter and general-application PDFs on A4 Ashtech letterhead with approximately 26.8 mm left/right body margins, branded header, subtle watermark, registration footer, and multi-page-safe content flow.
- Long-letter verification produced three pages without text clipping or body overflow. Letter generation remains document-only and does not mutate designation, role, status, or other employee master data.

### Finance and Invoice Corrections
- Preserved Finance, transactions, accounts, dashboard finance totals, finance-bearing client/report access, and invoice access for Admin in Admin Mode and Super Admin. Employee and Employee Mode remain denied; Recent Activity remains Super Admin-only.
- Made 5% sales tax optional per generated invoice and enabled by default. The server persists the explicit tax-applied decision together with rate, amount, subtotal, and total. Tax-off invoices store zero tax and omit the Sales Tax row from the PDF rather than displaying a misleading zero-tax line.
- Kept sender payment presentation as `Bank Transfer (HBL)` with the sender bank emphasized, retained the client/sender account number, removed the separate receiving-bank line, and continued excluding the Ashtech receiving account number.
- Removed the obsolete transaction-number system from active backend/frontend DTOs, search, creation, display, PDF naming/content, checked-in schema, verification, and legacy add-column migration. Invoice number is the only user-facing invoice reference; non-invoice transactions expose no substitute identifier. The technical primary key remains internal.
- Added an idempotent migration that creates general applications, adds/backfills the invoice tax-applied flag, verifies no foreign-key dependency on the obsolete transaction-number column, drops its indexes/column, and confirms the transaction row count is unchanged. It was run twice successfully and preserved all six existing transaction rows.

### UI and Responsiveness
- Added typed TSX/API organization for employee applications, management applications, Requests, letter selection, and Employee Account without introducing raw fetch scattering or changing the EMS shell/branding.
- Added scoped responsive styles for tabbed request workflows, application composition/history/review, employee selection, and the optional-tax control. The local browser verified the responsive Admin Requests navigation and Leave/Application views.

### Verification
- Added a dedicated applications/password verification covering unauthenticated denial, employee ownership/IDOR, PDF preview/download, promoted Admin Employee/Admin modes, concurrent conflicting decisions, authenticated current-password verification, confirmation validation, atomic hash replacement, and audit secrecy.
- Expanded invoice verification for default tax-on and explicit tax-off money calculation/persistence/PDF behavior while retaining exact numbering, concurrent sequence locking, forged client/project rejection, Admin finance access, invoice search/download, sender/receiver separation, and audit secrecy.
- Rendered and visually inspected application, tax-on invoice, tax-off invoice, all three employee letter types, and a three-page long official letter. The tax-off PDF contains no Sales Tax row; invoices show `Bank Transfer (HBL)`, no separate receiving-bank row, and no Ashtech receiving account number.
- Backend TypeScript compilation, frontend TypeScript/Vite production build, and frontend lint passed. Lint has zero errors and retains only the two pre-existing hook-dependency warnings in EmployeeProfile and Finance.
- Re-ran Phase 4 attendance, Phase 6 leave/holiday, Phase 7 analytics, Phase 8 attendance-employees, and Phase 9 report service/API suites successfully, including authentication, dual mode, attendance invariants, calendar rules, permissions, report PDFs, GPS settings, and Recent Activity boundaries.

### Scope Boundary
- `attendance-system/` remained read-only. No AMS data was migrated, no attendance calculation or schema was redesigned, and no manual attendance correction or new payroll rule was introduced.
- Phase 10 was not started.

---

## PHASE 10 — AMS UI TAKEOVER / EMS WORKFLOW PRESERVATION

### Design System and Navigation
- Applied the AMS visual language across EMS with the approved paper/ink/orange palette, tighter borders, soft shadows, compact typography, semantic badges, dark-theme tokens, and consistent card/form surfaces. The AMS project remained read-only and no Tailwind dependency was introduced.
- Preserved the EMS application shell and its mobile sidebar/drawer behavior while recoloring desktop navigation and sidebar active/hover states to match AMS. Main navigation is ordered Dashboard, Attendance, Employees, Clients, Projects, Finance, Requests.
- Added a persistent light/dark theme toggle backed by local storage. Shared inputs, tables, buttons, request surfaces, attendance screens, employee pages, and information cards inherit the theme.
- Employee sessions now open Attendance by default after login or sign-out state reset. Existing Employee Dashboard/profile and Applications destinations remain available without reducing employee information.

### Attendance UI
- Reworked employee Attendance around the AMS Check In composition: centered date/time/state card, authoritative action controls, live display-only timer, session/break cards, calendar/history, and backend-derived summaries.
- Preserved the approved GPS/Office single-session and Remote multi-session behavior. No frontend attendance calculation, session rule, GPS validation rule, or Phase 4 API contract was changed.
- Recreated AMS weekly/monthly target progress as responsive SVG rings using backend progress values and neutral zero-target handling.
- Replaced the admin overview bars with the AMS-style orange line/area graph, retained the AMS team-status ring, and restyled KPI cards, timeline, Holidays, and Reports. Attendance subnavigation remains exactly Dashboard, Holidays, Reports; employee attendance details live in Main Employees.

### Employees, Requests, and Core Pages
- Rebuilt Main Employees as a compact AMS directory with avatar, name, employee code/designation, Status, and Attendance Mode while retaining canonical EMS employee actions and APIs.
- Integrated attendance into the canonical Employee Profile and converted employee/HR information from flat rows to responsive AMS-style information cards. The self-profile uses the same card language and keeps login/security within the employee dashboard instead of adding a duplicate Account tab.
- Restyled Requests and General Applications with AMS tabs, composition/review cards, status treatments, responsive empty states, and mobile-safe layouts while preserving all workflows and permissions.
- Extended the shared AMS card language to summary, finance, dashboard, and detail surfaces without changing client, project, finance, invoice, or request behavior.

### Responsive, Accessibility, and Verification
- Preserved the EMS sidebar as the mobile navigation mechanism rather than copying the AMS popup menu. Layouts stack at tablet/mobile breakpoints and the 390px inspection reported no document-level horizontal overflow.
- Kept semantic headings, tab labels, status text in addition to color, labelled controls, focus-visible states, and readable light/dark contrast.
- Frontend TypeScript/Vite production build and backend TypeScript build passed. Frontend lint passed with zero errors and one pre-existing `Finance.tsx` hook-dependency warning.
- Browser verification covered the dark desktop admin Attendance dashboard, AMS line/ring graphs, Employees directory, employee-profile information cards, Requests/Applications, and the narrow mobile layout. Earlier Phase 10 checks also covered desktop, 768px, and 390px Attendance/Employees/Holidays/Reports states without page-level overflow.

### Scope Boundary
- This phase changed presentation and navigation placement only. Authentication, dual mode, Super Password, permissions, Recent Activity restrictions, finance/invoice behavior, attendance calculations, leave/holiday rules, and databases were not redesigned.
- `attendance-system/` remained untouched and reference-only. Phase 11 was not started.

---

## PHASE 10 — FINAL VISUAL & DASHBOARD INTERACTION CORRECTION

### AMS Palette and Control Corrections
- Replaced the remaining brown-heavy and light-only leaks with shared AMS-derived paper/light and neutral-dark tokens for page, navbar, surface, elevated surface, input, hover, border, text, orange accent, and semantic status colors.
- Normalized primary, secondary, ghost, destructive, icon, and tab controls around a consistent 40px rhythm with aligned padding, borders, typography, focus-visible, hover, active, and disabled states.
- Corrected Requests/Leave Management and Holidays so their toolbars, filters, cards, empty states, count/status treatments, and form surfaces use the shared theme in both modes instead of white or locally hardcoded colors.
- Added a reusable lightweight icon-button treatment and converted Finance transaction Delete actions to accessible trash icons without changing confirmation, authorization, Super Password, or deletion behavior.

### Navbar, Login, and Dashboard Interaction
- Added the authenticated user's real name/role/avatar to the desktop navbar and aligned theme, settings, and Sign Out controls while retaining the EMS navigation order and responsive sidebar drawer.
- Added an AMS-style unauthenticated login navbar and corrected the centered login card, labels, inputs, company contrast, theme control, and light/dark surfaces without changing authentication.
- Converted existing Dashboard KPI cards into semantic keyboard-accessible shortcuts with hover, pressed, focus-visible, and status-accent feedback. Active Employees opens Employees filtered to active; Clients and Projects open their existing destinations; Inflow, Outflow, and Net open Finance Transactions with Inflows, Outflows, and All visibly selected.
- Added clean SPA history state for tabs and shortcut filters so browser Back restores the preceding EMS view rather than leaving the application; destination filters remain manually changeable.

### Shared Attendance Analytics
- Reused/refactored the Phase 7 Attendance Overview and Team Status presentation for the main Admin/Super Admin Dashboard while continuing to consume authoritative `/api/attendance/dashboard` data.
- Preserved Admin-mode boundaries: normal Employee and promoted Admin Employee Mode navigation does not render the main Admin Dashboard analytics. No attendance calculations, permissions, or backend contracts changed.

### Affected Pages and Verification
- Corrected shared styling across Dashboard, Attendance, Employees/Employee Profile, Requests/Leave Management, Holidays, Finance, navbar, responsive sidebar, and Login.
- Browser-verified Dashboard KPI shortcuts, visible destination filters, manual filter changes, keyboard activation, browser Back, Attendance analytics, Finance icon actions, light/dark switching, navbar identity, Login light/dark, and representative Attendance, Employees/Profile, Requests, Holidays, and Finance layouts.
- Verified desktop behavior plus 768px and 390px responsive states; checked representative pages for page-level horizontal overflow and confirmed mobile analytics stack vertically.
- Frontend TypeScript/Vite production build passed. Frontend lint passed with zero errors; only the pre-existing `Finance.tsx` hook-dependency warning remains. Browser console inspection reported no warnings or errors.

### Scope Boundary
- No backend, database, authentication, permission, attendance-calculation, finance-calculation, invoice-calculation, request-workflow, or password-workflow changes were made. No dependency was added, `attendance-system/` remained read-only, and Phase 11 was not started.

---

## POST-PHASE-10 — ATTENDANCE ABSENCE FINALIZATION

- Added a persisted `attendance_day_statuses` outcome per employee/work date. Past missing attendance and forgotten checkout finalize as `absent`; for the current work date, active employees with no check-in are also classified `absent` while genuine open sessions remain current/working. Completed attendance, approved full-day leave, and configured holidays retain their authoritative statuses.
- Forgotten checkout evidence is preserved: the original session/check-in and breaks remain, the session becomes explicitly `incomplete`, and checkout stays `NULL` with no fabricated worked time.
- Unified dashboard KPI counts, Attendance Employee Directory filters, calendar/profile data, and reports around the same finalized backend status. The Today Absents KPI now opens the existing directory on the selected date with Absent active; Total Employees shows all active employees with corrected past-date badges.
- Added the Add Employee `GPS / Office Employee` checkbox. It stores `gps` or default `remote` in the existing `employee_attendance_settings.attendance_mode`; organization GPS coordinates/radius remain authoritative.

---

## FINANCE ACCOUNTS — BALANCES, HISTORY & TRANSFERS

- Finance Account balances remain derived from initial balance plus linked transaction history and now refresh immediately after transaction creation/deletion. Inflows add and outflows subtract using the existing transaction currency/locked-PKR values.
- Accounts are clickable and expose account details plus dated transaction/transfer history, invoice number, description, client/project, signed amount, PKR value where applicable, and authoritative running balance.
- Added atomic same-currency EMS account transfers in a dedicated `finance_account_transfers` table. Each transfer debits the source history, credits the destination history, is audited, and is excluded from company inflow/outflow totals.
- Backend/frontend builds and focused Finance account verification passed, including balance restoration after transaction deletion and unchanged overall totals after an internal transfer.

---

## FINANCE — DYNAMIC TRANSACTIONS, GENERAL RECEIPTS & SALARY PAYMENTS

- Made Add Transaction context-aware: inflows use a Receiving EMS Account; outflows use Pay From EMS Account and omit sender-bank fields; client/project fields appear only for client payments; Other categories require a custom label and hidden stale values are cleared.
- Extended the existing invoice/receipt pipeline to generate numbered documents for valid client and non-client inflows/outflows without inventing missing client/project data.
- Added eligible employee selection for Salary outflows. The backend reuses the Employee Details net formula (`basic + allowances - deductions`), stores that final salary plus optional bonus separately, and records their sum as the transaction amount debited from the selected EMS account.
- Added the minimal transaction detail columns for custom category and salary/bonus snapshots. Relevant backend/frontend TypeScript and production builds passed.

---

## PROJECT PROGRESS + CLIENT PORTAL

- Added required expected handover dates to project creation/editing and a durable `project_progress_updates` history with current percentage, progress bar, latest update, and full timeline in Project Details.
- Extended the existing bcrypt/JWT authentication system with client-linked user accounts. Admin/Super Admin can generate or reset a client password using the approved normalized name/country/phone format; only its bcrypt hash is stored and plaintext is returned once to the administrator.
- Added a restricted, read-only Client Portal showing only the authenticated client's projects, expected handover dates, current progress, and update history. Ownership is enforced by backend queries and client responses never include project assignments or employees.
- Focused verification passed for client login, generated password format, own-project visibility, cross-client IDOR denial, read-only permissions, progress history, and expected handover data.

- Client login passwords now live inside Create/Edit Client with manual entry, standard generation, and show/hide controls; edits replace the bcrypt hash because existing hashes cannot be revealed.
- Added client-owned project Requirements/Additions with append-only version history. Clients can create/edit only on their own projects, while Admin/Super Admin Project Details shows current text and all previous versions.

## CLIENT PORTAL — PROJECT TRANSACTIONS

- Client Project Details now shows only the project's date, invoice number, category, description, amount/currency, and available invoice/receipt actions. Backend ownership checks restrict transaction records and document downloads to projects belonging to the authenticated client; internal Finance details are not returned.
- Removed the Client login selector. The existing single login form now automatically routes valid Admin, Employee, promoted Admin, and Client accounts according to their authenticated role; promoted-Admin mode selection is unchanged.

## CHAT MISSION 1 — BACKEND FOUNDATION

- Added normalized MySQL chat groups, memberships/read state, and persisted messages; membership-protected bounded REST APIs; Admin/Super Admin group management; and JWT-authenticated Socket.IO rooms that save to MySQL before broadcasting. Clients are excluded and no Chat frontend was added.

## CHAT MISSION 2 — FRONTEND

- Added Employee/Admin/Super Admin Chat navigation and a responsive themed group-conversation UI using the existing bounded history/read APIs and one JWT-authenticated Socket.IO connection for deduplicated real-time messages. Clients remain excluded; group management stays deferred.

## CHAT MISSION 3 — GROUP MANAGEMENT

- Added Admin/Super Admin-only create, rename, searchable member selection, member viewing/add/remove controls inside Chat, plus reconnect/read/unread and message deduplication polish. Employee chat remains messaging-only and clients remain excluded.

## CHAT TIMEZONE CORRECTION

- Chat timestamps now serialize from MySQL's UTC epoch and render explicitly in Asia/Karachi, removing the duplicate UTC+5 conversion for messages and group-list times without rewriting historical records.

## NAVIGATION NOTIFICATION BADGES

- Added per-user Chat unread badges backed by existing group read state and Socket.IO, plus persisted per-user Requests read state for new Admin work and Employee decisions. Desktop/mobile badges hide at zero and refresh after reads, login, real-time chat events, or lightweight request polling.

## CHAT ATTACHMENTS & MESSAGE CONTROLS

- Added actual-role CEO/Admin sender and member badges with letter avatars, secure membership-protected Chat attachments (images, MP4, PDF, DOCX) backed by S3-compatible storage or an explicitly configured persistent volume, upload progress/previews, and persisted metadata.
- Added owner-only text editing/deletion with real-time Socket.IO synchronization and confirmations for message deletion/member removal. Navigation unread counts now render as small orange dots without changing existing read-state logic.

## CHAT TEXT-ONLY & GROUP DETAILS UPDATE

- Removed Chat attachments/storage and role badges. Messages are text-only, may be edited once, and deletion now leaves a synchronized “This message was deleted” tombstone.
- Added group bubbles/descriptions, clickable view-only details for all members, Admin management, persisted member-removal activity messages, and Super Admin-only group deletion protected by confirmation, Super Password, cascade cleanup, and audit logging.

## CHAT GROUP DETAILS UI & BUBBLE COLORS

- Corrected Group Details/Create Group to use one responsive modal scroll area with naturally flowing members, search results, and actions. Added persisted preset/custom bubble colors with live readable previews across the group list, conversation header, and details view.

## UNIFIED TRANSACTION PDF TEMPLATE

- Newly generated client invoices, receipts, and payment vouchers now share the approved invoice layout, branding, typography, spacing, header, and footer while retaining document-specific titles and only applicable transaction details. Existing documents and finance calculations remain unchanged.

## CHAT UI REDESIGN

- Refined Chat to the reference-style responsive two-column layout with compose icon, polished groups/messages, clickable group header, Karachi date separators, and animated group-loading spinner.
- Preserved search, unread/read state, real-time delivery, custom group bubbles, and edit/delete behavior while aligning action icons before the final timestamp.

## AUTHENTICATED DOCUMENTS & AMS CLEANUP

- Removed URL/query JWT authentication; protected Finance and Client Portal documents now use Authorization-header fetches and temporary browser blob URLs, while JWTs omit email, CNIC, and name claims.
- Corrected Finance client resolution through project ownership and safely removed the exact AMS project (ID 2), transaction 28, and verified dependent rows without orphans.

## Employee Portal — Dashboard, Attendance & Projects

- Restructured My Profile into Dashboard with Personal Info, Attendance summary, and Projects only; added personal-information icons using existing theme styles.
- Employee Attendance now focuses on Check In/Out, required breaks, today's sessions and hours logged; shared/Admin attendance calculations unchanged.
- Added Employee Projects navigation and assigned-project details/progress. Backend enforces current assignment, excludes handed-over projects, and exposes no transactions or financial information.
- Backend TypeScript passed; frontend type check reports the existing unused `setSortOrder` in Clients.tsx.

## Employee Dashboard & Applications UI correction

- Dashboard now uses responsive Personal Info / Attendance / Projects tabs, displaying only the selected section.
- Employee Applications styling updated with compact tabs/buttons, a New Leave Request action, status summary cards and responsive layout; existing request logic unchanged.

## Employee Portal — focused visual polish

- Improved assigned-project cards/details and compact accent progress presentation; no changes to project access or exposed data.
- Corrected Applications action sizing/placement, tabs, icon summary cards and request-history styling.
- Dashboard Attendance now shows Check In, Check Out, Hours Logged and Breaks, reusing today's session cards; removed weekly/monthly summary from this tab. All affected layouts are responsive; backend/Admin attendance unchanged.

## Employee Attendance structure & Settings

## Client Portal layout refresh

- Login keeps EMS Portal branding/layout; Forgot Password moved beneath Password/right-aligned, with React input icons and accessible Show/Hide password toggle. Authentication/reset behavior unchanged; no Remember Me added.

- Super Password verification now grants a fixed, backend-enforced 10-minute JWT-session authorization; actions do not extend it. Unique login JWT IDs, logout revocation, mode/role checks and password-change invalidation preserve isolation/security. Existing gates skip valid authorization; expired edits reuse a styled verification prompt without resending/storing passwords. Grants are process-local/fail-closed on server restart. Targeted security/backend checks passed; frontend retains existing Clients.tsx unused-variable error.

- Removed Created At/Created By from transaction details display only; added the existing blur-on-wheel guard to the project exchange-rate input, preserving manual editing, scrolling and conversion logic.

- Added cross-currency client project payments: actual transaction/PKR accounting preserved, with frozen project-applied amount/currency and project PKR rate. Billing (including project lists) sums applied amounts with legacy same-currency fallback; locked overpayment validation compares project-currency credit. Add Transaction previews conversion and stored receipts display both actual/applied amounts. Additive migration applied; targeted A–F/SQL/backend checks passed; frontend retains existing Clients.tsx unused-variable error.

- Official Letter PDFs now regenerate on demand/in memory from immutable issued snapshots; new issuance stores no PDF file. Employee one-time/locking and Admin repeat downloads preserved; email uses the same generated Buffer, existing notifications/files remain unchanged. Legacy file fallback retained only for incomplete snapshots; focused no-file/ownership/concurrency/Admin/email checks and backend type check passed.

- Added employee/client email-sent notices only after provider success using resolved recipients, sharing existing letter notification API/polling/bell/read presentation. Added Client bell; existing letter navigation and unread state preserved. Minimal shared portal_notifications migration applied because letter records cannot represent client/email notices; authenticated recipient isolation and focused failure/scoping checks passed. Backend check passed; frontend retains existing Clients.tsx unused-variable error.

## Official Letter delivery & PDF margins

- Fixed bounded PDF letterhead/footer widths and application body flow; PDF skill checks verified three-page application/official-letter margins without changing document design.
- Admin Send to Employee now atomically records issuance/read/download metadata with the stored official PDF and idempotency key; Preview, email and unrestricted Admin history downloads preserved.
- Added Employee Official Letters, polling bell notifications and unread sidebar dot. Read state is separate from server-enforced one-time downloads; ownership/mode checks and row locking prevent IDOR and simultaneous repeats, while aborted delivery remains downloadable.
- Delivery migration applied; backend type check and focused mocked delivery tests passed. Frontend type check retains the existing Clients.tsx unused setSortOrder error. Stored letters require persistent uploads/employee-letters/ storage; server delivery cannot confirm a user's local file save.

- Attendance Report Preview/PDF now group daily and session/break details per employee with shared server work/status summaries and existing employee_attendance_settings weekly/monthly targets (no invented daily/custom-range target). Preview pagination keeps employee sections intact; focused grouping checks and four-page PDF visual QA passed (PDF skill). Backend type check passed; frontend retains the existing Clients.tsx unused-variable error.

- Transaction documents now place optional Transaction ID below Document Number (without lower duplication). Finance list replaces PKR Value with icon-styled Payment Method and adds Transaction ID; new payments use Cash/Bank Transfer, preserving legacy records.

## Assigned-project progress & requirement attachments

- Assigned employees can submit progress through the existing project history and view client requirements; authenticated creator is retained internally and omitted from client progress responses.
- Client requirements accept optional validated PDF/image attachments under uploads/transactions/, with nullable metadata migration and ownership/assignment-protected Admin, employee and client file access.
- Backend type check and focused mocked workflow/security/file checks passed; frontend type check reports the existing Clients.tsx unused setSortOrder error.

- Refined Admin Email composer into a compact professional mail-style layout with improved hierarchy, reduced oversized surfaces, compact attachment controls, responsive behavior, and preserved email functionality.

- Refined Admin Email compose UI with improved visual hierarchy, semantic accent colors, React Icons, recipient grouping, attachment styling, primary send action, and responsive layout without changing email functionality.

- Client Invoices now show all available invoices/receipts directly with project labels, preserving authenticated viewing/downloads and isolation. Progress Updates refined with project grouping, current progress bars, icons and an update timeline using existing project history.

- Refined Client Project Details UI with improved section hierarchy, React Icons, semantic color treatments, progress styling, billing summary presentation, progress updates, transaction presentation, requirements styling, and responsive behavior without changing project functionality.

- Corrected Dashboard to full-width responsive two-column desktop / one-column small-screen project cards, with incomplete rows left-aligned. Progress Updates now reads actual project history via existing ownership-enforced client APIs; no duplicate update system.

- Reused Admin/Employee sidebar/topbar styling with Dashboard, Invoices and Progress Updates navigation, sidebar-only Sign Out, and responsive left drawer.
- Polished client-safe Dashboard project cards/progress; preserved existing project details, document access and isolation. Invoices reuse existing project documents; Progress Updates is a navigation shell only.

- Simplified the main Employee Attendance UI by reducing redundant status text, tightening the clock/action area, and simplifying the Check In, Check Out, Hours Logged, and Breaks summary while preserving attendance behavior.

- Polished the main Employee Attendance page with improved visual hierarchy, React Icons, semantic status styling, attendance action styling, responsive summary information, and consistent Ashtech portal aesthetics without changing attendance behavior.

- Improved Employee Dashboard Attendance visual hierarchy with KPI cards, progress styling, Recent Activity presentation, and Independent Work Session styling while preserving existing attendance behavior and responsive layout.

- Standalone Attendance now focuses on live clock/check-in/break/check-out with compact hours/session information; Dashboard Attendance contains bounded history statistics, weekly/monthly Work Progress, Recent Activity and existing independent sessions.
- Restored Employee sidebar Settings with the existing authenticated own-password change form. Responsive presentation updated; attendance calculations and Admin behavior unchanged.

- Removed duplicate Admin/Employee top-right Sign Out buttons; existing topbar alignment, sidebar Sign Out and logout logic preserved. Client Portal unchanged.

- Added subtle dark-mode-only Email control/attachment shadows using the existing central shadow variable; disabled borders, focus states, light mode, layout and email behavior preserved.

- Redesigned Attendance Report PDF hierarchy, employee summaries, compact session/break tables, repeated continuation headers and page-numbered footer. Attendance calculations/data unchanged; backend checks and read-only current-report PDF visual verification added using the PDF skill.

- Admin fixes: new holidays reject past Asia/Karachi dates; employee statuses match the live DB (active/resigned/terminated), with atomic employee/login/settings/audit creation; future project scheduling enabled with date-order validation; Account Type limited to Bank/Cash while custom bank providers and historical account data remain intact.

- Fixed Clients.tsx frontend production compile blocker.

- Standardized Finance back navigation with React Icons; aligned detail actions and polished shared tab/icon treatment. Existing Finance functionality preserved.

- Standardized Admin Attendance/Employee/Client/Project back and creation buttons using existing Finance styles and React Icons; restored theme-based orange secondary/action accents. Danger actions and existing functionality unchanged.

- Replaced unused Admin topbar search with theme-consistent Quick Add shortcuts opening existing Employee, Client, Project and Transaction creation forms; outside-click/Escape dismissal included.

- Refined Quick Add to compact navbar sizing with soft theme-based orange surface/border accents; dropdown and navigation behavior unchanged.

- Removed Admin Quick Add and its unused wiring/styles. Standardized ADMIN PORTAL / EMPLOYEE PORTAL / CLIENT PORTAL labels with shared orange typography, dimensions and responsive topbar spacing; existing controls preserved.

- Fixed Finance account cross-currency movements with admin-entered account PKR rates and frozen account amount/currency/rate (additive migration); account balances/history use the same authoritative values. Project conversion and PKR reporting remain separate. Corrected Paid From/Received In labels and inward-responsive Financial Overview tooltip. ASH-PAY-000075 has no historical USD rate: original retained; affected account balance/history show a manual-rate warning rather than a fabricated amount.

- Accounts KPI now displays account balances grouped by currency, with compact totals and a lightweight overflow list; unknown historical rates remain flagged. Underlying accounting unchanged.

- Added Admin Payroll: salary-configured active employees, monthly Pending/Paid status, currency-grouped totals, Pay Now prefill and View Transaction through existing Finance. Successful transaction atomically links/freezes salary snapshots with employee/month uniqueness; protected transaction deletion returns payroll to unpaid. Existing account/currency conversion reused; no attendance deductions or payslips. Additive payroll migration applied; focused rollback-based DB checks passed.

- Locked employee-linked Salary transaction currency in Finance UI (including custom codes); existing backend currency mismatch rejection/account conversion preserved. Added Super Admin-only Demote to Employee beside existing promotion flow, reusing Super Password authorization and audit; role-only atomic update preserves employee/history data, and existing per-request DB role checks revoke Admin API access.

- Added shared 220ms fade/8px page-entry transition across Admin, Employee and Client content, including heading-based detail/back navigation. Persistent shell and page state remain unchanged; reduced-motion preference respected; no dependency added.
