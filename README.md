# Ashtech EMS

Ashtech EMS is Ashtech Digital Solutions' employee and business management application.
It provides Admin, Employee and Client portals for managing people, attendance, projects and finances.
The portals share a responsive interface with light and dark themes.

## Key Features

**Administration**

- Redesigned dashboard with organization metrics, finance charts and account balances.
- Super Admin-only Recent Activity, employee promotion/demotion and protected actions.
- Employee and client management, salary details and account access.

**Attendance and requests**

- Remote multi-session attendance and GPS/Office check-in with breaks.
- Attendance calendars, employee profiles, summaries and PDF reports.
- Full-day/short-hour leave, holiday management, applications and password-reset requests.
- Official employee letters with previews, downloads, portal notifications and email delivery.

**Projects and finance**

- Project assignments, expected handover dates, progress updates and requirement history.
- Optional sales tax with an editable percentage.
- Transactions, multi-currency payments, project billing and invoice/receipt PDFs.
- Finance accounts, balance history, internal transfers and monthly Payroll.

**Employee and client portals**

- Employee dashboard, attendance actions, applications and assigned project progress.
- Client access to their own projects, billing, documents and requirements.
- Notification bells, theme controls, page transitions and slim, theme-aware scrollbars.
- Admin email composer with two independent Gmail accounts and optional attachments.

## Tech Stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite 7, React Icons, shared CSS; Tailwind/PostCSS packages |
| Backend | Node.js, TypeScript, Express 4 |
| Database | MySQL 8, mysql2 |
| Security | JWT, bcrypt, AES-256-GCM |
| Documents and email | PDFKit, pdfmake, Multer, Google OAuth/Gmail API |

## Getting Started

Prerequisites: MySQL 8, npm and Node.js compatible with Vite's `^20.19.0 || >=22.12.0` requirement.

From the cloned repository root, install dependencies:

```sh
cd backend
npm ci
cd ../frontend-app
npm ci
cd ..
```

Create `backend/.env` from `backend/.env.example` only if it does not already exist:

- macOS/Linux: `cp backend/.env.example backend/.env`
- Windows PowerShell: `Copy-Item backend/.env.example backend/.env`
- Windows Command Prompt: `copy backend\.env.example backend\.env`

Configure `backend/.env` privately. Replace populated example credentials with your own.

| Variables | Purpose |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Database connection |
| `PORT`, `CORS_ORIGIN` | API port and allowed frontend origins |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Session authentication |
| `ENCRYPTION_KEY` | 64-character hexadecimal encryption key |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | Optional Gmail integration |

Set `VITE_API_URL` in `frontend-app/.env.local` to the backend URL. Never place secrets in frontend variables.
For Gmail, enable Gmail API, register the callback ending in `/api/email/oauth/callback`, and connect accounts through Settings.
Preserve the original encryption key when restoring existing data.

For a **fresh, isolated database only**, review and import `database_schema.sql` from the project root:

```text
mysql --user=<schema-owner> --password --execute="SOURCE database_schema.sql"
```

The SQL explicitly selects `ashtech_ems`. It is not a complete, rerunnable upgrade installer.
Its current extensions are supplied by these scripts, run individually after review. Start from the repository root:

```sh
cd backend
node -r ts-node/register scripts/migrate-project-billing.ts
node -r ts-node/register scripts/migrate-project-optional-tax.ts
node -r ts-node/register scripts/migrate-requirement-attachments.ts
node -r ts-node/register scripts/migrate-finance-currency-reference.ts
node -r ts-node/register scripts/migrate-project-payment-conversion.ts
node -r ts-node/register scripts/migrate-payroll.ts
node -r ts-node/register scripts/migrate-employee-letter-delivery.ts
node -r ts-node/register scripts/migrate-portal-notifications.ts
node -r ts-node/register scripts/migrate-company-email.ts
```

Create the initial Super Admin only on a fresh installation:

```sh
npm run seed:admin -- "<full-name>" "<email>" "<login-password>" "<super-password>"
```

Use different passwords of at least 10 characters; protect shell history. The seed can overwrite existing credentials.
**For existing databases, back up data and uploads, review only required migrations, and never blindly run legacy scripts or seeds.**
**Backend startup writes historical attendance statuses; review this behavior before starting against migrated data.**

## Running Locally

Open two terminals at the repository root, then run:

```sh
cd backend
npm run dev
```

```sh
cd frontend-app
npm run dev
```

The backend normally uses port 4000; Vite normally uses 5173. Match the frontend origin in `CORS_ORIGIN`. Health check: `GET /api/health`.
Run `npm run build` in each folder to compile; frontend `npm run lint` and `npm run preview` are also available.

## Project Structure

```text
Ashtech_EMS/
├── database_schema.sql          # Database bootstrap/reference
├── changes.md
├── backend/
│   ├── src/routes/              # Feature APIs
│   ├── src/attendance/          # Attendance services and reports
│   ├── src/finance/             # Billing, payments and payroll
│   ├── src/employees/           # Letters and notifications
│   ├── scripts/                 # Migrations, seed and checks
│   └── uploads/                 # Persistent runtime documents
└── frontend-app/src/
    ├── App.tsx                  # Portal layout and navigation
    ├── index.css                # Shared styles and themes
    ├── pages/
    ├── components/
    └── lib/                     # API helpers
```

## Deployment

- Backend: run `npm run build`, then `npm start` from `backend/`.
- Frontend: build with the production `VITE_API_URL` and host `frontend-app/dist/` as static files.
- Configure HTTPS, CORS, MySQL access and the deployed Google OAuth callback.
- Preserve uploads and encryption configuration; verify PDF logo assets are included in the deployment.
- Rehearse database upgrades on a disposable restore before rollout. Vite preview is for local checks, not production hosting.
- No completed Render or other production deployment is verified by the repository.
"# fixing-ems" 
