import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseAddress, stripTag } from '../../../inbound-function/src/email.js'
import { getTeamPrefs, getWorkspace, intakeSettings, type IntakeSettings } from '#/server/appwrite.server'
import { MAX_FILE_BYTES, MAX_FILES, MAX_METADATA_CHARS, fileMessage, type IncomingMessage } from '#/server/intake.server'

// POST /api/tickets creates a ticket from anything that isn't an email to the
// support address: a contact form, your own backend, an alert, or an email
// provider's inbound webhook. It takes what an email carries, plus a plain
// text metadata field. Settings → API documents it.

const MAX_REQUEST_BYTES = 25 * 1024 * 1024
const RATE_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 }

// Fields only an email provider's webhook sends.
const WEBHOOK_FIELDS = ['sender', 'recipient', 'body-plain', 'body-html', 'stripped-text', 'headers', 'envelope']

// Best effort: each server instance keeps its own window.
const recent = new Map<string, number[]>()
function rateLimited(ip: string) {
  const now = Date.now()
  const hits = (recent.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT.windowMs)
  hits.push(now)
  recent.set(ip, hits)
  if (recent.size > 5000) recent.clear()
  return hits.length > RATE_LIMIT.max
}

function isAllowedOrigin(origin: string | null, request: Request, settings: IntakeSettings) {
  if (!origin) return true // Servers and webhooks send no Origin header.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  try {
    if (new URL(origin).host === host) return true
  } catch {
    return false
  }
  return settings.origins.length === 0 || settings.origins.includes(origin)
}

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {}
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, idempotency-key',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

interface Body {
  // First value of each field, keyed in lowercase. Fields the API doesn't use are ignored.
  fields: Map<string, unknown>
  files: File[]
  json: boolean
}

async function readBody(request: Request): Promise<Body> {
  const type = request.headers.get('content-type') ?? ''
  const body: Body = { fields: new Map(), files: [], json: type.includes('application/json') }

  const add = (key: string, value: unknown) => {
    const lower = key.toLowerCase()
    if (!body.fields.has(lower)) body.fields.set(lower, value)
  }

  if (body.json) {
    const parsed = (await request.json()) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Send a JSON object.')
    for (const [key, value] of Object.entries(parsed)) add(key, value)
  } else if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    for (const [key, value] of (await request.formData()).entries()) {
      if (typeof value === 'string') add(key, value)
      else if (value.size > 0) body.files.push(value)
    }
  } else {
    throw new Error('Send JSON, multipart/form-data or application/x-www-form-urlencoded.')
  }
  return body
}

// Pulls a header such as Message-ID out of the raw "headers" field SendGrid posts.
function rawHeader(headers: string, name: string) {
  return new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(headers)?.[1]?.trim() ?? ''
}

const addresses = (value: string) =>
  value
    .split(',')
    .map((address) => parseAddress(address).email)
    .filter(Boolean)

function toMessage(body: Body, mailbox: string, idempotencyKey: string): IncomingMessage {
  const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value).trim() : '')
  const get = (...keys: string[]) => keys.map((key) => text(body.fields.get(key))).find(Boolean) ?? ''

  const webhook = WEBHOOK_FIELDS.some((key) => body.fields.has(key))
  // Like email, Reply-To wins over From, so a form service sending on a customer's behalf files it under the customer.
  const from = parseAddress(get('reply-to', 'replyto') || get('from', 'sender'))
  const email = (get('email') || from.email).toLowerCase()
  const name = (get('name') || from.name).slice(0, 255)

  const headers = get('headers')
  const recipients = addresses(get('to', 'recipient'))
  const plain = webhook ? get('body-plain', 'text', 'stripped-text') : get('text', 'message')

  return {
    source: webhook ? 'webhook' : 'api',
    email,
    name,
    subject: (get('subject') || `Message from ${name || email}`).slice(0, 512),
    text: plain,
    html: get('html', 'body-html'),
    cc: addresses(get('cc')),
    metadata: typeof body.fields.get('metadata') === 'string' ? String(body.fields.get('metadata')).trim() : '',
    ref: get('ref').replace(/^#/, ''),
    recipients,
    messageId: get('messageid', 'message-id') || rawHeader(headers, 'Message-ID'),
    inReplyTo: [
      get('inreplyto', 'in-reply-to') || rawHeader(headers, 'In-Reply-To'),
      get('references') || rawHeader(headers, 'References'),
    ],
    mailbox: recipients.find((address) => !address.endsWith('.appwrite.email')) ? stripTag(recipients[0]) : mailbox,
    idempotencyKey,
    files: body.files,
  }
}

const required = z.object({
  email: z.email('Include the customer’s address in "email" (or "from").'),
})

export const Route = createFileRoute('/api/tickets')({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        const origin = request.headers.get('origin')
        const settings = intakeSettings(await getTeamPrefs().catch(() => ({})))
        if (!settings.enabled || !isAllowedOrigin(origin, request, settings)) return new Response(null, { status: 403 })
        return new Response(null, { status: 204, headers: corsHeaders(origin) })
      },

      POST: async ({ request }) => {
        const origin = request.headers.get('origin')
        const accept = request.headers.get('accept') ?? ''
        let cors: Record<string, string> = {}
        const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: cors })

        let prefs: Record<string, unknown>
        try {
          prefs = await getTeamPrefs()
        } catch {
          return reply(503, { ok: false, error: 'This workspace isn’t set up yet.' })
        }
        const settings = intakeSettings(prefs)
        if (!settings.enabled) {
          return reply(403, { ok: false, error: 'This workspace doesn’t accept tickets over HTTP. An admin can turn it on in Settings → API.' })
        }
        if (!isAllowedOrigin(origin, request, settings)) return reply(403, { ok: false, error: `${origin} isn’t an allowed origin.` })
        cors = corsHeaders(origin)

        const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
        if (rateLimited(ip)) return reply(429, { ok: false, error: 'Too many requests. Try again in a few minutes.' })
        if (Number(request.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) {
          return reply(413, { ok: false, error: 'The request is larger than 25 MB.' })
        }

        let body: Body
        try {
          body = await readBody(request)
        } catch (error) {
          return reply(400, { ok: false, error: error instanceof Error ? error.message : 'Could not read the request.' })
        }

        // Browsers posting a plain <form> get redirected instead of seeing JSON.
        const redirectTo = (ref: string) => {
          const target = typeof body.fields.get('_redirect') === 'string' ? String(body.fields.get('_redirect')) : ''
          let url: URL | null = null
          try {
            url = new URL(target)
          } catch {
            url = null
          }
          const allowed = url && /^https?:$/.test(url.protocol) && (url.origin === origin || settings.origins.includes(url.origin))
          const location = allowed && url ? url.toString() : `/received${ref ? `?ref=${ref}` : ''}`
          return new Response(null, { status: 303, headers: { ...cors, location } })
        }
        const wantsPage = !body.json && accept.includes('text/html')

        // Bots fill the hidden _gotcha field. Pretend it worked and drop it.
        if (body.fields.get('_gotcha')) return wantsPage ? redirectTo('') : reply(201, { ok: true })

        const workspace = await getWorkspace()
        const message = toMessage(body, workspace.mailbox, request.headers.get('idempotency-key')?.slice(0, 128) ?? '')
        const checked = required.safeParse(message)
        if (!checked.success) return reply(422, { ok: false, error: checked.error.issues[0]?.message })
        if (!message.text && !message.html) return reply(422, { ok: false, error: 'Include the ticket’s body in "text" or "html".' })
        if (message.email.endsWith('.appwrite.email')) return reply(422, { ok: false, error: 'That sender address can’t open tickets.' })
        const metadata = body.fields.get('metadata')
        if (metadata !== undefined && metadata !== null && typeof metadata !== 'string') {
          return reply(422, { ok: false, error: '"metadata" is a plain text field. To send JSON, stringify it first.' })
        }
        if (message.metadata.length > MAX_METADATA_CHARS) return reply(413, { ok: false, error: '"metadata" is longer than 64 KB.' })
        if (message.files.length > MAX_FILES) return reply(422, { ok: false, error: `Attach at most ${MAX_FILES} files.` })
        const large = message.files.find((file) => file.size > MAX_FILE_BYTES)
        if (large) return reply(413, { ok: false, error: `${large.name} is larger than 20 MB.` })

        const result = await fileMessage(message)
        if (wantsPage) return redirectTo(result.ref)
        return reply(result.created && !result.duplicate ? 201 : 200, {
          ok: true,
          id: result.conversationId,
          ref: result.ref,
          created: result.created,
          duplicate: result.duplicate,
        })
      },
    },
  },
})
