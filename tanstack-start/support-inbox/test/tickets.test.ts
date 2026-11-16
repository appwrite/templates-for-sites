import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFakeAppwrite, type Doc, type FakeAppwrite } from './fake-appwrite'
import { newRequest } from './request'

// The route module only needs its handlers here, not a router.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: unknown) => ({ options }),
}))
const { Route } = await import('#/routes/api/tickets')

type Handler = (context: { request: Request }) => Promise<Response>
const { POST, OPTIONS } = (Route as unknown as { options: { server: { handlers: Record<'POST' | 'OPTIONS', Handler> } } }).options.server.handlers

const SITE_URL = 'https://support.example.com/api/tickets'
const ALLOWED = 'https://www.example.com'

let fake: FakeAppwrite
beforeAll(async () => {
  fake = await startFakeAppwrite()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  newRequest(['teams.read', 'rows.read', 'rows.write', 'files.write'], SITE_URL)
  const state = fake.state
  state.databases.set('mailroom', { $id: 'mailroom' })
  for (const table of ['conversations', 'messages', 'customers']) state.tables.set(table, { $id: table, columns: [], indexes: [] })
  state.buckets.set('attachments', { $id: 'attachments' })
  state.teams.set('agents', { $id: 'agents', name: 'Support agents', prefs: { intake: { enabled: true, origins: [ALLOWED] } }, memberships: [] })
})

// Each request comes from its own address, so the per-address rate limit only applies where a test wants it.
let address = 0
function send(handler: Handler, body: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit & { headers: Headers } = {
    method: handler === OPTIONS ? 'OPTIONS' : 'POST',
    headers: new Headers({ 'x-forwarded-for': `203.0.113.${++address % 250}, 10.0.0.1`, 'x-forwarded-host': 'support.example.com', ...headers }),
  }
  if (body instanceof FormData || body instanceof URLSearchParams) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    if (!init.headers.has('content-type')) init.headers.set('content-type', 'application/json')
  }
  return handler({ request: new Request(SITE_URL, init) })
}
const post = (body: unknown, headers?: Record<string, string>) => send(POST, body, headers)

const rows = (table: string) => [...(fake.state.rows.get(table)?.values() ?? [])]
const only = (table: string) => {
  const all = rows(table)
  expect(all, table).toHaveLength(1)
  return all[0] as Doc
}

const TICKET = {
  from: 'Jane Doe <Jane@Example.com>',
  subject: 'Checkout fails with a card error',
  text: 'I get “card declined” on every card I try.',
  metadata: 'Plan: Pro\nAccount: acc_1042',
}

describe('POST /api/tickets', () => {
  it('creates a ticket from JSON', async () => {
    const response = await post(TICKET)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({ ok: true, id: expect.any(String), ref: expect.stringMatching(/^\d{6}$/), created: true, duplicate: false })

    expect(only('conversations')).toMatchObject({
      $id: body.id,
      ref: body.ref,
      subject: TICKET.subject,
      status: 'open',
      customerEmail: 'jane@example.com',
      customerName: 'Jane Doe',
      mailbox: 'support@inbound-template-test.appwrite.email',
      messageCount: 1,
    })
    expect(only('messages')).toMatchObject({ conversationId: body.id, direction: 'inbound', source: 'api', text: TICKET.text, metadata: TICKET.metadata })
    expect(only('customers')).toMatchObject({ email: 'jane@example.com', name: 'Jane Doe', conversationCount: 1 })
  })

  it('files a retried request once', async () => {
    const first = await (await post({ ...TICKET, messageId: '<form-42@example.com>' })).json()
    const retry = await post({ ...TICKET, messageId: '<form-42@example.com>' })
    expect(retry.status).toBe(200)
    expect(await retry.json()).toMatchObject({ id: first.id, ref: first.ref, created: false, duplicate: true })

    const keyed = await (await post(TICKET, { 'idempotency-key': 'order-1042' })).json()
    expect(await (await post(TICKET, { 'idempotency-key': 'order-1042' })).json()).toMatchObject({ id: keyed.id, duplicate: true })
    expect(rows('messages')).toHaveLength(2)
  })

  it('adds a follow-up to the customer’s ticket by its ref, and reopens it', async () => {
    const ticket = await (await post(TICKET)).json()
    Object.assign(only('conversations'), { status: 'pending' })

    const reply = await post({ email: 'jane@example.com', text: 'Any news?', ref: `#${ticket.ref}` })
    expect(reply.status).toBe(200)
    expect(await reply.json()).toMatchObject({ id: ticket.id, created: false, duplicate: false })
    expect(only('conversations')).toMatchObject({ status: 'open', messageCount: 2 })

    // Someone else can't add to it by guessing the ref.
    const other = await post({ email: 'mallory@example.com', text: 'Hi', ref: ticket.ref })
    expect(other.status).toBe(201)
    expect((await other.json()).id).not.toBe(ticket.id)
  })

  it('threads by In-Reply-To like email', async () => {
    const ticket = await (await post({ ...TICKET, messageId: '<first@example.com>' })).json()
    const reply = await (await post({ email: 'jane@example.com', text: 'Following up', inReplyTo: '<first@example.com>' })).json()
    expect(reply).toMatchObject({ id: ticket.id, created: false })
  })

  it.each([
    ['no sender', { text: 'Hi' }, 422, 'email'],
    ['a sender that is not an address', { email: 'jane', text: 'Hi' }, 422, 'email'],
    ['no body', { email: 'jane@example.com', subject: 'Hi' }, 422, '"text" or "html"'],
    ['an appwrite.email sender', { email: 'loop@inbound-x.appwrite.email', text: 'Hi' }, 422, 'can’t open tickets'],
    ['metadata that is not text', { ...TICKET, metadata: { plan: 'Pro' } }, 422, 'plain text field'],
    ['metadata over 64 KB', { ...TICKET, metadata: 'x'.repeat(64 * 1024 + 1) }, 413, 'longer than 64 KB'],
    ['a JSON array', [TICKET], 400, 'JSON object'],
  ])('rejects %s', async (_, body, status, error) => {
    const response = await post(body)
    expect(response.status).toBe(status)
    expect((await response.json()).error).toContain(error)
    expect(rows('conversations')).toHaveLength(0)
  })

  it('rejects other content types', async () => {
    const response = await post('just text', { 'content-type': 'text/plain' })
    expect(response.status).toBe(400)
  })

  it('redirects plain HTML forms', async () => {
    const form = (fields: Record<string, string>) => new URLSearchParams({ email: 'jane@example.com', message: 'Hello', ...fields })
    const html = { accept: 'text/html', origin: ALLOWED }

    const received = await post(form({}), html)
    expect(received.status).toBe(303)
    expect(received.headers.get('location')).toMatch(/^\/received\?ref=\d{6}$/)

    const back = await post(form({ _redirect: `${ALLOWED}/thanks` }), html)
    expect(back.headers.get('location')).toBe(`${ALLOWED}/thanks`)

    const elsewhere = await post(form({ _redirect: 'https://evil.example/phish' }), html)
    expect(elsewhere.headers.get('location')).toMatch(/^\/received/)
  })

  it('accepts and drops spam caught by the honeypot', async () => {
    const response = await post({ ...TICKET, _gotcha: 'I am a bot' })
    expect(response.status).toBe(201)
    expect(rows('conversations')).toHaveLength(0)
  })

  it('files email forwarded by a provider’s webhook', async () => {
    const webhook = new FormData()
    webhook.set('sender', 'Jane Doe <jane@example.com>')
    webhook.set('recipient', 'help@acme.example')
    webhook.set('subject', 'Order 1042')
    webhook.set('body-plain', 'Where is my order?')
    webhook.set('Message-Id', '<abc123@mail.example.com>')
    webhook.set('attachment-1', new File(['%PDF-1.7'], 'receipt.pdf', { type: 'application/pdf' }))

    expect((await post(webhook)).status).toBe(201)
    expect(only('conversations')).toMatchObject({ mailbox: 'help@acme.example', customerEmail: 'jane@example.com' })
    const message = only('messages')
    expect(message).toMatchObject({ source: 'webhook', text: 'Where is my order?', recipients: 'help@acme.example' })
    expect(message.messageId).toContain('abc123@mail.example.com')
    expect(JSON.parse(String(message.attachments))).toEqual([expect.objectContaining({ name: 'receipt.pdf', size: 8 })])
    expect([...fake.state.files.values()].map((file) => file.data.toString())).toEqual(['%PDF-1.7'])
  })

  it('limits each address to 10 tickets in 10 minutes', async () => {
    const from = { 'x-forwarded-for': '198.51.100.7' }
    for (let attempt = 0; attempt < 10; attempt++) expect((await post({ _gotcha: 'x' }, from)).status).toBe(201)
    expect((await post(TICKET, from)).status).toBe(429)
  })
})

describe('who can send tickets', () => {
  it('is nobody until an admin turns the API on', async () => {
    fake.state.teams.get('agents')!.prefs = {}
    const response = await post(TICKET)
    expect(response.status).toBe(403)
    expect((await response.json()).error).toContain('Settings → API')
    expect((await send(OPTIONS, undefined, { origin: ALLOWED })).status).toBe(403)
  })

  it('is nobody before setup', async () => {
    fake.state.teams.clear()
    expect((await post(TICKET)).status).toBe(503)
  })

  it('is servers, the site itself and the allowed origins', async () => {
    const allowed = await post(TICKET, { origin: ALLOWED })
    expect(allowed.status).toBe(201)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect((await post(TICKET, { origin: 'https://support.example.com' })).status).toBe(201)

    const blocked = await post(TICKET, { origin: 'https://evil.example' })
    expect(blocked.status).toBe(403)
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()

    const preflight = await send(OPTIONS, undefined, { origin: ALLOWED })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS')
  })

  it('is any origin when the list is empty', async () => {
    fake.state.teams.get('agents')!.prefs = { intake: { enabled: true, origins: [] } }
    expect((await post(TICKET, { origin: 'https://anywhere.example' })).status).toBe(201)
  })
})
