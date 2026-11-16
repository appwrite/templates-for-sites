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
  newRequest(['teams.read', 'files.read'])
  const state = fake.state
  state.users.set('user-1', { $id: 'user-1', name: 'Sam Agent', email: 'sam@example.com', prefs: {} })
  state.sessions.set('secret-sam', 'user-1')
  state.teams.set('agents', { $id: 'agents', name: 'Support agents', prefs: {}, memberships: [{ $id: 'membership-1', userId: 'user-1', roles: ['agent'] }] })
  const file = (fileId: string, name: string, mimeType: string, data: string) =>
    state.files.set(fileId, { $id: fileId, bucketId: 'attachments', name, mimeType, sizeOriginal: data.length, data: Buffer.from(data) })
  file('photo', 'photo.png', 'image/png', 'PNG bytes')
  file('invoice', 'invoice 42.pdf', 'application/pdf', '%PDF-1.7')
  file('page', 'page.html', 'text/html', '<script>alert(1)</script>')
})

function download(fileId: string, query = '') {
  return GET({ params: { fileId }, request: new Request(`https://support.example.com/api/files/${fileId}${query}`) })
}
const signIn = () => request.cookies.set('mailroom_session', 'secret-sam')

describe('GET /api/files/:fileId', () => {
  it('is only for signed-in agents', async () => {
    expect((await download('photo')).status).toBe(401)
    request.cookies.set('mailroom_session', 'expired')
    expect((await download('photo')).status).toBe(401)

    signIn()
    fake.state.teams.get('agents')!.memberships = []
    expect((await download('photo')).status).toBe(401)
  })

  it('downloads attachments, under a sandbox', async () => {
    signIn()
    const response = await download('invoice')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('%PDF-1.7')
    expect(Object.fromEntries(response.headers)).toMatchObject({
      'content-type': 'application/octet-stream',
      'content-disposition': "attachment; filename*=UTF-8''invoice%2042.pdf",
      'content-security-policy': "sandbox; default-src 'none'",
      'x-content-type-options': 'nosniff',
    })
  })

  it('shows images and PDFs inline, and nothing else', async () => {
    signIn()
    const image = await download('photo', '?inline=1')
    expect(image.headers.get('content-type')).toBe('image/png')
    expect(image.headers.get('content-security-policy')).toContain('sandbox')

    // The browser's PDF viewer doesn't run under a sandbox CSP.
    const pdf = await download('invoice', '?inline=1')
    expect(pdf.headers.get('content-disposition')).toMatch(/^inline/)
    expect(pdf.headers.get('content-security-policy')).toBeNull()

    const html = await download('page', '?inline=1')
    expect(html.headers.get('content-type')).toBe('application/octet-stream')
    expect(html.headers.get('content-disposition')).toMatch(/^attachment/)
  })

  it('answers 404 for missing files', async () => {
    signIn()
    expect((await download('missing')).status).toBe(404)
  })
})
