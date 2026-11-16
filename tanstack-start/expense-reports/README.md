# Outlay: expense reports

Expense reports and approvals for small teams, an open alternative to Expensify, built on Appwrite Sites and Appwrite Function email triggers.

People snap or upload receipts, or forward them by email, and bundle expenses into reports. Approvers sign off, admins mark reports reimbursed, and every step is recorded.

- Expenses with merchant, amount, currency, date, category, description and a receipt (photo, image or PDF, with camera capture on phones).
- Receipts by email: forward a receipt to `receipts@receipts-<project-id>.appwrite.email` and it becomes a draft expense for the sender, with the merchant, total and date filled in where they can be read.
- Reports that bundle drafts for approval. Approvers approve, or reject with a reason, and admins mark approved reports reimbursed. Totals are per currency, and reports export to CSV.
- An audit trail of every create, edit, submission, decision, reimbursement and comment, with who did it.
- Categories with optional per-expense limits. Over-limit expenses are flagged for approvers.
- Roles: owner, admin, approver and member. Members see only their own expenses.
- A dashboard with spend per month and by category, what's awaiting approval, and what you're owed.
- Live updates over Appwrite Realtime, filtered by row permissions.
- Sign-in with an emailed code or a password, picked at setup.

It runs on **Appwrite Cloud** and on **self-hosted Appwrite**. Email triggers are Cloud-only, so on self-hosted Appwrite receipts are uploaded in the app.

## Deploy

1. Create the site from this template in the Appwrite Console.
2. Set the `OUTLAY_SETUP_TOKEN` variable to any passphrase, and mark it secret. A new deploy is public, so `/setup` asks for it before anyone can claim the workspace.
3. Open `/setup` on the site's domain and enter the token.
4. Select **Create resources**, then create the owner account with your company name and currency.

Setup creates everything with the site's own key. You never paste an API key:

| Step | What it creates |
| --- | --- |
| Database | `outlay`, with the `expenses`, `reports`, `events` (audit trail) and `categories` tables, each created with its columns, indexes and permissions in one request |
| Storage | The `receipts` bucket (20 MB per file, private) |
| Team | The empty `workspace` team that the owner joins |
| Function (Cloud only) | `receipts` (Node 22), deployed from the code bundled in this folder (`receipts-function/`). Setup waits for the build. |
| Email trigger (Cloud only) | Turns on the function's email trigger, so `receipts@receipts-<project-id>.appwrite.email` works right away |
| Scopes | Removes the scopes only setup needed from this site |
| Owner account | You, with the sign-in method you pick: an emailed code (the default on Cloud) or a password (the default on self-hosted), plus default expense categories |

Every step is idempotent. You can close the tab and run it again; it only creates what's missing. Once the workspace has an owner, `/setup` redirects to sign-in for good.

After setup, add teammates under **Settings → Team** and give approvers their role.

## Variables

| Variable | Required | Used for |
| --- | --- | --- |
| `OUTLAY_SETUP_TOKEN` | Yes | The passphrase `/setup` asks for |
| `APPWRITE_PUBLIC_ENDPOINT` | Self-hosted only | Your Appwrite's public API URL, when the site reaches Appwrite on an internal address that browsers can't use for Realtime |

Appwrite Sites sets the endpoint, project ID and site ID itself. Variable changes apply after you redeploy.

## Scopes

Appwrite Sites gives every request a short-lived key with the scopes set on the site. Outlay reads those scopes from the key, and `/setup` lists any that are missing. Add them under **Sites → your site → Settings → Build → Scopes**, then select **Check again**. You don't need to redeploy.

| Scope | Kept after setup | Used for |
| --- | --- | --- |
| `users.read`, `users.write` | Yes | Teammates, passwords, and the Realtime JWT |
| `teams.read`, `teams.write` | Yes | The `workspace` team, roles, and workspace settings |
| `rows.read`, `rows.write` | Yes | Expenses, reports, the audit trail and categories |
| `files.read`, `files.write` | Yes | Receipts |
| `functions.read`, `functions.write` | Yes | The receipts-by-email switch, and redeploying the receipts function after an update |
| `databases.read`, `tables.read`, `buckets.read` | Yes | Checking the project under Settings → System |
| `databases.write`, `tables.write`, `buckets.write` | No | Creating the database, tables and bucket |
| `sites.read`, `sites.write` | No | Removing the setup scopes from this site |
| `columns.*`, `indexes.*` | Optional, writes removed | Adding columns to existing tables when a later version needs them |

When a new version of the template needs a resource that setup's scopes create, **Settings → System** lists the scopes to add back, applies the update and removes them again.

The receipts function gets its own 6 scopes: `users.read`, `teams.read`, `rows.read`, `rows.write`, `files.read` and `files.write`.

Signing in, checking a code and sending one don't use the site's key. They go to Appwrite like any client request, with the site's domain as the origin, so Appwrite's own rate limits apply.

## Sign-in

Each workspace picks one method at setup, and admins can switch it under **Settings → General**:

- **Email code.** Appwrite emails a 6-digit code at each sign-in, only to team members and at most once a minute. On self-hosted Appwrite this needs SMTP (`_APP_SMTP_*`) or a custom SMTP server for the project.
- **Password.** Works without email. Admins set a teammate's password when adding them and reset forgotten ones under **Settings → Team**. Everyone can change their own under Settings → General.

Switching can't lock the admin out: moving to passwords asks for theirs first, and moving to codes emails them one to prove delivery works. For hardening, turn off the Appwrite auth methods the workspace doesn't use, but keep JWT, which Realtime needs.

## Security model

- **Row security.** Expenses, reports and audit rows grant read access to their owner. Table permissions add read access for the `owner`, `admin` and `approver` roles, so Realtime events and direct reads respect who can see what.
- **Private receipts.** Receipts are only served through `/api/files/:fileId`, which checks that the viewer can see the expense. Only raster images and PDFs open inline; everything else downloads under a `sandbox` CSP.
- **Idempotent email intake.** Expenses created from email use IDs derived from the `Message-ID`, so a mail server retrying a delivery never creates duplicates.

## Run locally

The app needs the key that Appwrite Sites adds to each request, so run setup on a deployed site first. To work on the UI against that project afterwards, copy `.env.example` to `.env` and fill it in:

```env
APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_API_KEY=<a key with the scopes kept after setup>
OUTLAY_SETUP_TOKEN=<any passphrase>
```

Then run:

```bash
npm install
npm run dev
```

Appwrite Realtime only accepts pages from hostnames the project knows. To get live updates on `localhost`, add a Web platform with the hostname `localhost` to the project.

The receipts function has its own tests:

```bash
cd receipts-function
npm install
npm test
```

## Project layout

- `src/routes`: pages and `/setup` (TanStack Start).
- `src/server`: server code that talks to Appwrite. `schema.server.ts` lists every resource setup creates, with its permissions, and `provision.server.ts` holds the setup steps.
- `receipts-function`: the function that turns forwarded receipts into expenses. The site bundles its code and deploys it, so the template needs nothing outside this folder.
