import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFakeAppwrite, type FakeAppwrite } from './fake-appwrite'
import { newRequest, request } from './request'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: unknown) => ({ options }),
}))
const { Route } = await import('#/routes/api/files.$fileId')

type Handler = (context: { params: { fileId: string }; request: Request }) => Promise<Response>
const { GET } = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers

let fake: FakeAppwrite
beforeAll(async () => {
  fake = await startFakeAppwrite()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  newRequest(['teams.read', 'rows.read', 'files.read'])
  const state = fake.state
  const person = (userId: string, name: string, role: string | null) => {
    state.users.set(userId, { $id: userId, name, email: `${name.toLowerCase()}@example.com`, prefs: {} })
    state.sessions.set(`secret-${userId}`, userId)
    if (role) state.teams.get('workspace')?.memberships.push({ $id: `membership-${userId}`, userId, roles: [role] })
  }
  const receipt = (fileId: string, ownerId: string | null, name: string, mimeType: string, data: string) => {
    state.files.set(fileId, { $id: fileId, bucketId: 'receipts', name, mimeType, sizeOriginal: data.length, data: Buffer.from(data) })
    if (ownerId) state.rows.get('expenses')?.set(`expense-${fileId}`, { $id: `expense-${fileId}`, ownerId, receiptFileId: fileId })
  }

  state.databases.set('outlay', { $id: 'outlay' })
  state.tables.set('expenses', { $id: 'expenses', columns: [], indexes: [] })
  state.rows.set('expenses', new Map())
  state.buckets.set('receipts', { $id: 'receipts' })
  state.teams.set('workspace', { $id: 'workspace', name: 'Outlay workspace', prefs: {}, memberships: [] })
  person('mia', 'Mia', 'member')
  person('ann', 'Ann', 'approver')
  person('leo', 'Leo', 'member')
  person('zoe', 'Zoe', null)
  receipt('coffee', 'mia', 'coffee receipt.png', 'image/png', 'PNG bytes')
  receipt('hotel', 'leo', 'hotel.pdf', 'application/pdf', '%PDF-1.7')
  receipt('page', 'mia', 'page.html', 'text/html', '<script>alert(1)</script>')
  receipt('orphan', null, 'orphan.png', 'image/png', 'PNG bytes')
})

function download(fileId: string, query = '') {
  return GET({ params: { fileId }, request: new Request(`https://expenses.example.com/api/files/${fileId}${query}`) })
}
const signInAs = (userId: string) => request.cookies.set('outlay_session', `secret-${userId}`)

describe('GET /api/files/:fileId', () => {
  it('is only for signed-in members of the workspace', async () => {
    expect((await download('coffee')).status).toBe(401)
    signInAs('zoe')
    expect((await download('coffee')).status).toBe(401)
  })

  it('gives members their own receipts, under a sandbox', async () => {
    signInAs('mia')
    const response = await download('coffee')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('PNG bytes')
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''coffee%20receipt.png",
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
    })
  })

  it('hides other people’s receipts from members, but not from approvers', async () => {
    signInAs('mia')
    expect((await download('hotel')).status).toBe(404)
    signInAs('ann')
    expect((await download('hotel')).status).toBe(200)
  })

  it('serves no file that isn’t an expense’s receipt', async () => {
    signInAs('ann')
    expect((await download('orphan')).status).toBe(404)
    expect((await download('missing')).status).toBe(404)
  })

  it('shows images and PDFs inline, and nothing else', async () => {
    signInAs('ann')
    const image = await download('coffee', '?inline=1')
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('content-security-policy')).toContain('sandbox')

    // The browser's PDF viewer doesn't run under a sandbox CSP.
    const pdf = await download('hotel', '?inline=1')
    expect(pdf.headers.get('content-disposition')).toMatch(/^inline/)
    expect(pdf.headers.get('content-security-policy')).toBeNull()

    const html = await download('page', '?inline=1')
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toMatch(/^attachment/)
  })
})
