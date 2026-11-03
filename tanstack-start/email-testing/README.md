# Catchall: email testing inbox

A shared test inbox for your team, built on Appwrite Sites and Appwrite Function email triggers. Send mail from your app to any name at your project's `appwrite.email` domain, then read it in the browser or wait for it from your tests.

- Every name works: `signup-123@inbox-<project-id>.appwrite.email` exists the moment you send to it.
- Verification codes and links are pulled out of each message.
- The message view shows the HTML (sandboxed), the text, headers, attachments and basic checks: TLS, spam score, local links, missing text part, Gmail clipping.
- A CI endpoint holds the request until mail arrives, so a test can wait for an email the same way it waits for a page.
- Messages and attachments are deleted after a retention period you pick (1 to 30 days).

Email triggers run on **Appwrite Cloud** only. On self-hosted Appwrite, `/setup` stops before it creates anything.

## Deploy

1. Create the site from this template in the Appwrite Console.
2. Open `/setup` on the site's domain.
3. Create the admin account. The first person to finish this step becomes the admin.

Setup then creates everything with the site's own key. You never paste an API key:

| Step | What it creates |
| --- | --- |
| Team | The `catchall` team, with you as owner (admin) |
| Database | `catchall`, with the `messages`, `tokens` and `settings` tables |
| Storage | The `attachments` bucket (25 MB per file) |
| Function | `inbox` (Node 22), deployed from the [`node/email-testing-inbox`](https://github.com/appwrite/templates/tree/1.5.0/node/email-testing-inbox) template in the `appwrite/templates` 1.5.0 release, with its email trigger and a nightly cleanup at 03:00 UTC |
| Permissions | Removes the scopes only setup needed from this site |

You can close the tab during setup. Reopen `/setup` and sign in to continue where you left off.

## Scopes

Appwrite Sites gives every request a short-lived key with the scopes set on the site. Catchall reads those scopes from the key on each request.

The template asks for 15 scopes. When setup finishes, the site removes 11 of them from itself and keeps 4:

| Scope | Kept after setup | Used for |
| --- | --- | --- |
| `rows.read` | Yes | The CI API, and checking that setup finished |
| `rows.write` | Yes | Settings, API tokens, and emptying the inbox |
| `files.read` | Yes | Attachment downloads from the CI API |
| `files.write` | Yes | Deleting attachments when you empty the inbox |
| `teams.read` | No | Checking whether an admin exists |
| `databases.read`, `databases.write` | No | Creating the database |
| `tables.read`, `tables.write` | No | Creating the tables, with columns and indexes |
| `buckets.read`, `buckets.write` | No | Creating the attachments bucket |
| `functions.read`, `functions.write` | No | Deploying the function and turning on its email trigger |
| `sites.read`, `sites.write` | No | Removing the setup scopes from this site |

If the site was deployed without these scopes, `/setup` lists the missing ones. Add them under **Sites → your site → Settings → Build → Scopes**, then select **Check again**. You don't need to redeploy.

The function gets its own 3 scopes: `rows.read`, `rows.write` and `files.write`.

Signing in, password resets and invites don't use the site's key. They go to Appwrite like any client request, so Appwrite's own rate limits apply.

## Use it from tests

1. Open **Tests & API** and create a token. Tokens expire after 90 days.
2. Store it in CI as `CATCHALL_TOKEN`, and the site's URL as `CATCHALL_URL`.
3. Wait for mail:

```ts
const url = new URL("/api/messages/wait", process.env.CATCHALL_URL);
url.searchParams.set("to", `signup-${Date.now()}@inbox-<project-id>.appwrite.email`);
url.searchParams.set("timeout", "20");

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${process.env.CATCHALL_TOKEN}` },
});
const email = await res.json(); // { subject, codes, links, text, html, attachments, ... }
```

| Endpoint | Returns |
| --- | --- |
| `GET /api/messages/wait?to=&timeout=&since=` | The newest message for `to`, once it arrives. `timeout` is in seconds, up to 25 (default 20). `since` ignores older mail. 404 if nothing arrives in time. |
| `GET /api/messages?to=` | The newest message for `to`, without waiting. 404 if there's none. |
| `GET /api/messages/:id` | One message. |
| `GET /api/attachments/:fileId` | An attachment. The URLs in message responses point here. |

`to` takes the full address or only the part before the `@`. Send the token as `Authorization: Bearer ctk_...` or in an `X-Catchall-Token` header. Every endpoint returns 401 for a missing or expired token.

## Run locally

The app needs the key that Appwrite Sites adds to each request, so run setup on a deployed site first. To work on the UI against that project afterwards, create `.env`:

```env
APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_API_KEY=<a key with rows.read, rows.write, files.read and files.write>
```

Then run:

```bash
npm install
npm run dev
```

## Project layout

- `src/routes`: pages and the CI API (TanStack Start).
- `src/server`: server code that talks to Appwrite. `setup.ts` holds the setup steps.

The function that receives mail isn't in this folder. It's the [`node/email-testing-inbox`](https://github.com/appwrite/templates/tree/1.5.0/node/email-testing-inbox) template in `appwrite/templates`, and setup deploys it from the release that `FUNCTION_TEMPLATE_TAG` in `src/server/setup.ts` names, currently 1.5.0.
