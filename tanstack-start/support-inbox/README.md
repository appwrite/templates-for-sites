# Mailroom: support inbox

A shared support inbox for your team, an open alternative to Help Scout, built on Appwrite Sites, Appwrite Function email triggers and Appwrite Messaging.

Customers email your support address, and anything else can open a ticket over HTTP. Your team triages, assigns, tags and replies from one inbox, and replies go out through your own email provider.

- Folders for Unassigned, Mine, All open, Pending, Closed and Spam, with live counts over Appwrite Realtime.
- Customer replies land in the right conversation, through a per-conversation reply-to address, `In-Reply-To`/`References` headers or the `[#123456]` subject token.
- Replies with attachments, internal notes, saved replies with `{{customer.firstName}}` placeholders, and per-agent signatures.
- Assignment, statuses, tags, bulk actions, and search by subject, email or `#ref`.
- Customer profiles with history and notes.
- A tickets API, `POST /api/tickets`, for contact forms, your own backend, alerts and email-provider webhooks.
- Spam scoring from the email trigger, with flagged mail parked in Spam.
- Sign-in with an emailed code or a password, picked at setup.

It runs on **Appwrite Cloud** and on **self-hosted Appwrite**. Email triggers are Cloud-only, so on self-hosted Appwrite tickets come in through the tickets API, including email forwarded by Mailgun or SendGrid.

## Deploy

1. Create the site from this template in the Appwrite Console.
2. Set the `MAILROOM_SETUP_TOKEN` variable to any passphrase, and mark it secret. A new deploy is public, so `/setup` asks for it before anyone can claim the workspace.
3. Open `/setup` on the site's domain and enter the token.
4. Select **Create resources**, then create the owner account.

Setup creates everything with the site's own key. You never paste an API key:

| Step | What it creates |
| --- | --- |
| Database | `mailroom`, with the `conversations`, `messages`, `customers` and `saved_replies` tables, each created with its columns and indexes in one request |
| Storage | The `attachments` bucket (25 MB per file, encrypted) |
| Team | The empty `agents` team that the owner joins |
| Function (Cloud only) | `inbound` (Node 22), deployed from the code bundled in this folder (`inbound-function/`). Setup waits for the build. |
| Email trigger (Cloud only) | Turns on the function's email trigger, so `support@inbound-<project-id>.appwrite.email` works right away |
| Scopes | Removes the scopes only setup needed from this site |
| Owner account | You, with the sign-in method you pick: an emailed code (the default on Cloud) or a password (the default on self-hosted) |

Every step is idempotent. You can close the tab and run it again; it only creates what's missing. Once the workspace has an owner, `/setup` redirects to sign-in for good.

After setup, connect an email provider under **Settings → Email** so replies go out, then add teammates under **Settings → Team**.

## Variables

| Variable | Required | Used for |
| --- | --- | --- |
| `MAILROOM_SETUP_TOKEN` | Yes | The passphrase `/setup` asks for |
| `APPWRITE_PUBLIC_ENDPOINT` | Self-hosted only | Your Appwrite's public API URL, when the site reaches Appwrite on an internal address that browsers can't use for Realtime |

Appwrite Sites sets the endpoint, project ID and site ID itself. Variable changes apply after you redeploy.

## Scopes

Appwrite Sites gives every request a short-lived key with the scopes set on the site. Mailroom reads those scopes from the key, and `/setup` lists any that are missing. Add them under **Sites → your site → Settings → Build → Scopes**, then select **Check again**. You don't need to redeploy.

| Scope | Kept after setup | Used for |
| --- | --- | --- |
| `users.read`, `users.write` | Yes | Teammates, passwords, and the Realtime JWT |
| `teams.read`, `teams.write` | Yes | The `agents` team, roles, and workspace settings |
| `rows.read`, `rows.write` | Yes | Conversations, messages, customers and saved replies |
| `files.read`, `files.write` | Yes | Attachments |
| `providers.read`, `providers.write` | Yes | Connecting an email provider under Settings → Email |
| `messages.read`, `messages.write` | Yes | Sending replies |
| `functions.read`, `functions.write` | Yes | The email trigger switch, and redeploying the inbound function after an update |
| `rules.read`, `rules.write` | Yes | Custom email domains |
| `databases.read`, `tables.read`, `buckets.read` | Yes | Checking the project under Settings → System |
| `databases.write`, `tables.write`, `buckets.write` | No | Creating the database, tables and bucket |
| `sites.read`, `sites.write` | No | Removing the setup scopes from this site |
| `columns.*`, `indexes.*` | Optional, writes removed | Adding columns to existing tables when a later version needs them |

When a new version of the template needs a resource that setup's scopes create, **Settings → System** lists the scopes to add back, applies the update and removes them again.

Signing in, checking a code and sending one don't use the site's key. They go to Appwrite like any client request, with the site's domain as the origin, so Appwrite's own rate limits apply.

## Tickets API

`POST /api/tickets` creates a ticket from anything that isn't an email to your support address. It takes what an email carries, as JSON, `multipart/form-data` or a URL-encoded form:

| Field | |
| --- | --- |
| `email` or `from` | Required. The customer, as an address or a header like `Jane Doe <jane@example.com>` |
| `text` or `html` | Required. The body. `message` works as another name for `text` |
| `name`, `subject`, `to`, `cc` | Optional, as in an email |
| `metadata` | Optional plain text up to 64 KB for any extra data, such as a plan, an order ID or stringified JSON. Agents see it with the ticket |
| `attachments` | Files, with `multipart/form-data` |
| `ref`, `messageId`, `inReplyTo`, `references` | Add to an existing ticket, or dedupe retries, the same way email threading works |

```ts
const res = await fetch("https://<your-site>/api/tickets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    email: "jane@example.com",
    subject: "Checkout fails with a card error",
    text: "I get “card declined” on every card I try.",
    metadata: "Plan: Pro, account acc_1042",
  }),
});
const { id, ref, created } = await res.json();
```

It answers `201` for a new ticket and `200` when a message joins an existing one. A plain HTML form is redirected to `/received`, or to its `_redirect`. The endpoint is off until an admin turns it on under **Settings → API**, which has copy-paste examples, allowed origins for browsers, a honeypot field and a per-IP rate limit.

## Sign-in

Each workspace picks one method at setup, and admins can switch it under **Settings → General**:

- **Email code.** Appwrite emails a 6-digit code at each sign-in, only to team members and at most once a minute. On self-hosted Appwrite this needs SMTP (`_APP_SMTP_*`) or a custom SMTP server for the project.
- **Password.** Works without email. Admins set a teammate's password when adding them and reset forgotten ones under **Settings → Team**. Everyone can change their own under Settings → General.

Switching can't lock the admin out: moving to passwords asks for theirs first, and moving to codes emails them one to prove delivery works. For hardening, turn off the Appwrite auth methods the workspace doesn't use, but keep JWT, which Realtime needs.

## Run locally

The app needs the key that Appwrite Sites adds to each request, so run setup on a deployed site first. To work on the UI against that project afterwards, copy `.env.example` to `.env` and fill it in:

```env
APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_API_KEY=<a key with the scopes kept after setup>
MAILROOM_SETUP_TOKEN=<any passphrase>
```

Then run:

```bash
npm install
npm run dev
```

Appwrite Realtime only accepts pages from hostnames the project knows. To get live updates on `localhost`, add a Web platform with the hostname `localhost` to the project.

The inbound function has its own tests:

```bash
cd inbound-function
npm install
npm test
```

## Project layout

- `src/routes`: pages, `/setup`, and `POST /api/tickets` (TanStack Start).
- `src/server`: server code that talks to Appwrite. `schema.server.ts` lists every resource setup creates, `provision.server.ts` holds the setup steps, and `intake.server.ts` files tickets the same way the function files email.
- `inbound-function`: the function that receives email. The site bundles its code and deploys it, so the template needs nothing outside this folder.
