# Livepage: open-source pages and databases

A Notion alternative that runs on Appwrite Sites. Pages, databases and multi-tenant workspaces, with people editing the same page live and an AI writing assistant that uses your own provider key.

- Pages with slash commands, blocks, tables, images, comments and page history. Everyone's edits and carets show up as they type, over Appwrite Realtime.
- Databases with table, board, calendar, timeline and gallery views, formulas, relations and CSV import. Each row opens as a full page.
- Workspaces are Appwrite Teams: owners, admins, members and guests. Pages can be private, shared with people, or published to a public link.
- AI: continue writing, rewrite, summarize, translate, ask your workspace, AI columns, image generation and editing. Works with any OpenAI-compatible provider.
- A knowledge map of how your pages link together.
- AI agents (Claude Code, Cursor, Codex) can read and write pages over MCP, each signed in as a person.
- Two-step sign-in with an authenticator app and recovery codes.

## Deploy

1. Create the site from this template in the Appwrite Console.
2. Open `/setup` on the site's domain.
3. Create the owner account. The first person to finish this step becomes the owner.

Setup uses the site's own key, so you never paste an API key. It detects what your project supports by asking Appwrite, and only offers what will work:

| Step | What it creates |
| --- | --- |
| Team | Your first workspace, as an Appwrite Team, with you as owner |
| Database | `livepage`, with 17 tables: settings, pages, Yjs bodies and updates, comments, notifications and the rest |
| Storage | The `files` bucket (30 MB per file) |
| Search | Keyword search works everywhere. Search by meaning is opt-in and needs VectorsDB, see below |
| Browser access | A Web platform for the site's domain, when Appwrite doesn't already accept it |
| AI key | Your provider key, stored in the `secrets` table and never sent to a browser |
| First pages | A short getting started page and starter pages |
| Sign-in for AI agents | Turns on the project's OAuth server and points it at this site's `/consent` page. Offered on Cloud only. If the server already sends people to another app, setup leaves it alone |
| Permissions | Removes the scopes only setup needed from this site |

Sign-up is invite only by default, with open sign-up as an option. You can close the tab during setup: reopen `/setup` and sign in to continue where you left off.

## Scopes

Appwrite Sites gives every request a short-lived key with the scopes set on the site. Livepage reads those scopes from the key on each request.

The template asks for 26 scopes. When setup finishes, the site removes 18 from itself and keeps 8. If you turn on search by meaning, the 7 VectorsDB and embeddings scopes stay too.

| Scope | Kept after setup | Used for |
| --- | --- | --- |
| `rows.read` | Yes | Settings, the AI key, and checking page access for agents and guests |
| `rows.write` | Yes | Notifications, compaction, guest edits and other writes a person can't make directly |
| `files.read` | Yes | Images on published pages and for AI |
| `files.write` | Yes | Saving generated images |
| `teams.read` | Yes | Checking workspace membership and listing members |
| `teams.write` | Yes | Changing someone's role and removing them from a workspace |
| `users.read` | Yes | Names and avatars for the people in a workspace |
| `users.write` | Yes | Signing agents in as the person who connected them, and deleting an account when its owner asks |
| `databases.read`, `databases.write` | No | Creating the database |
| `tables.read`, `tables.write` | No | Creating the tables, with columns and indexes |
| `buckets.read`, `buckets.write` | No | Creating the files bucket |
| `vectorsdb.read`, `vectorsdb.write` | Only with search by meaning | Checking plans and creating the vector database |
| `vectorsdb.collections.read`, `vectorsdb.collections.write` | Only with search by meaning | The vector collection |
| `vectorsdb.documents.read`, `vectorsdb.documents.write` | Only with search by meaning | Page vectors |
| `embeddings.write` | Only with search by meaning | Appwrite's built-in text embeddings |
| `project.read`, `project.write` | No | Turning on the project's OAuth server for agents |
| `sites.read`, `sites.write` | No | Setting the site's time limit and removing the setup scopes |
| `platforms.write` | No | Adding the site's domain as a Web platform |

`users.write` stays because an API key has no narrower way to act as a person: `POST /v1/users/:userId/jwts` is what lets every agent request run under that person's own Appwrite permissions instead of the site key's. Deleting an account also needs it, as the Account API can't delete a user.

`project.write` covers every project setting. Setup only uses it to update the OAuth server, then gives it back. To turn on agents after setup, add `project.read` and `project.write` back under **Sites → your site → Settings → Build → Scopes**, then turn it on under **Settings → Agents**.

If the site was deployed without these scopes, `/setup` lists the missing ones. Add them there, then select **Check again**. You don't need to redeploy.

## Cloud and self-hosted

Setup asks your project what it supports, so the same template works on both.

| | Cloud | Self-hosted |
| --- | --- | --- |
| Pages, databases, comments, live editing, AI with your own key, two-step sign-in | Yes | Yes |
| Sign-in for AI agents (MCP) | Yes, using the project's OAuth server | No. Appwrite's OAuth server is Cloud only |
| Search by meaning | Needs a paid dedicated VectorsDB. Setup shows the live prices and creates nothing without your consent | Needs `_APP_VECTORSDB=enabled` on the server, plus the `embedding` Compose profile for built-in embeddings |
| Site time limit | Setup sets the highest your project allows | `_APP_SITES_TIMEOUT` |

Live editing and direct writes need the browser's origin to be allowed: setup adds the site's domain as a Web platform when needed. A custom domain added later needs the same.

## AI provider

Everything goes through an OpenAI-compatible API, so any provider that exposes one works. The key is stored server side and never reaches the browser.

Set the key in `/setup` or later under **Settings → AI**. The **Advanced** link there sets:

| Field | Default |
| --- | --- |
| Endpoint URL | `https://api.openai.com/v1` |
| Text model | The newest text model the provider lists, picked for you |
| Image model | The newest image model the provider lists. Image features stay hidden if there is none |
| Embedding model | Picked when the provider offers embeddings |

Livepage calls `POST /chat/completions` with streaming, `POST /images/generations`, `POST /images/edits`, `POST /embeddings` and `GET /models` to check the key. Self-hosted gateways work as long as the Site can reach their URL. A wrong key or an unreachable endpoint shows up when you save it, not when someone first uses it.

Sites stop a request after 30 seconds, so text streams and images are generated with a quality and size that finish in time. A slow image request ends with a clear message at about 27 seconds rather than a dropped connection.

## Environment variables

Appwrite Sites sets everything the app needs. These are optional; set them under **Sites → your site → Settings → Environment variables**.

| Variable | Default | What it does |
| --- | --- | --- |
| `APPWRITE_PUBLIC_ENDPOINT` | The Site's own endpoint | The API URL browsers use, for example `https://appwrite.example.com/v1`. Set it on self-hosted Appwrite when the Site reaches Appwrite at an internal Docker hostname browsers can't use |
| `LIVEPAGE_SITE_URL` | The address `/setup` ran on | The Site's public URL, used for password reset and invite links and as the audience of agent tokens. Set it when the Site moves to a custom domain |
| `LIVEPAGE_AI_ALLOW_PRIVATE_HOSTS` | Empty | Comma-separated hosts the Site may call even though they resolve to a private address, or `*`. A private AI host chosen during `/setup` works without this; one a workspace admin types into Settings never does |
| `LIVEPAGE_AI_USER_DAILY_TEXT` / `_IMAGE` | `300` / `30` | Daily AI calls one person can make with the Site's key |
| `LIVEPAGE_AI_WORKSPACE_DAILY_TEXT` / `_IMAGE` | `3000` / `200` | Daily AI calls one workspace can make with the Site's key |

Allowances only apply to the Site's own AI key. A workspace that saves its own key in Settings pays for its own use and has no limit here. Set a limit to `0` to turn it off.

## Known limits

- Appwrite allows 120 row writes per person per minute. Live editing sends at most one update row per 600 ms and spends this budget, so very fast typing alongside bulk database changes can queue briefly.
- Sites have a 30-second request limit, which caps AI requests and large imports (imports run in batches for this reason).
- A person's unsent edits are saved in that browser's storage. A very long offline session is resent as one update and can take a moment.
- Agents and search by meaning are Cloud-first, see above.

## Run locally

Run setup on a deployed site first, since the app needs the key Appwrite Sites adds to each request. To work on the UI against that project, create `.env`:

```env
APPWRITE_ENDPOINT=https://<region>.cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<project-id>
APPWRITE_API_KEY=<a key with the runtime scopes above>
```

Then run:

```bash
npm install
npm run dev
```

Appwrite Realtime only accepts pages from hostnames the project knows, so add a Web platform with the hostname `localhost` to see live updates locally.

## Project layout

- `src/routes`: pages, `/mcp`, `/consent` and the AI API (TanStack Start).
- `src/server`: server code that talks to Appwrite. `schema.ts` is the data and scope reference, `setup.ts` holds the setup steps.
- `src/features`: the editor, databases, AI, workspace, settings and setup UIs.
- `src/lib/live.ts` and `src/lib/browser-appwrite.ts`: the Realtime socket and direct browser writes, both on a short-lived JWT made from the session.
