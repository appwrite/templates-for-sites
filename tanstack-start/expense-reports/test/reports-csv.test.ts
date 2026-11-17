import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startFakeAppwrite, type Doc, type FakeAppwrite } from './fake-appwrite'
import { newRequest, request } from './request'

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (options: unknown) => ({ options }),
}))
const { Route } = await import('#/routes/api/reports.$reportId.csv')

type Handler = (context: { params: { reportId: string } }) => Promise<Response>
const { GET } = (Route as unknown as { options: { server: { handlers: { GET: Handler } } } }).options.server.handlers

let fake: FakeAppwrite
beforeAll(async () => {
  fake = await startFakeAppwrite()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  newRequest(['teams.read', 'rows.read'])
  const state = fake.state
  state.databases.set('outlay', { $id: 'outlay' })
  for (const table of ['expenses', 'reports']) state.tables.set(table, { $id: table, columns: [], indexes: [] })
  state.teams.set('workspace', { $id: 'workspace', name: 'Outlay workspace', prefs: {}, memberships: [] })
  for (const [userId, role] of [['mia', 'member'], ['leo', 'member'], ['ann', 'approver']]) {
    state.users.set(userId, { $id: userId, name: userId, email: `${userId}@example.com`, prefs: {} })
    state.sessions.set(`secret-${userId}`, userId)
    state.teams.get('workspace')?.memberships.push({ $id: `membership-${userId}`, userId, roles: [role] })
  }
  state.rows.set('reports', new Map([['berlin', { $id: 'berlin', ownerId: 'mia', title: 'Berlin trip / Q3', status: 'submitted' }]]))
  const expense = (rowId: string, data: Record<string, unknown>) => ({ $id: rowId, reportId: 'berlin', ownerName: 'Mia', status: 'submitted', ...data })
  state.rows.set(
    'expenses',
    new Map<string, Doc>([
      ['taxi', expense('taxi', { spentAt: '2026-10-02T09:30:00.000+00:00', merchant: '=HYPERLINK("https://evil.example")', categoryName: 'Travel', description: 'Taxi "airport"', amount: 1250, currency: 'EUR', receiptFileId: 'r1' })],
      ['sushi', expense('sushi', { spentAt: '2026-10-03T19:00:00.000+00:00', merchant: 'Sushi Bar', categoryName: 'Meals', description: '-', amount: 1200, currency: 'JPY' })],
      ['other', { $id: 'other', reportId: 'another', merchant: 'Not in this report', amount: 100, currency: 'USD' }],
    ]),
  )
})

const exportReport = (reportId = 'berlin') => GET({ params: { reportId } })
const signInAs = (userId: string) => request.cookies.set('outlay_session', `secret-${userId}`)

describe('GET /api/reports/:reportId/csv', () => {
  it('exports the report’s expenses as a spreadsheet-safe CSV', async () => {
    signInAs('mia')
    const response = await exportReport()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''Berlin%20trip%20%20Q3.csv")

    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer())
    // A byte order mark, so Excel reads the file as UTF-8.
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"Date","Merchant","Category","Description","Amount","Currency","Status","Receipt","Submitted by"',
      // Formulas are neutralised and quotes doubled; amounts use the currency's decimals.
      `"2026-10-02","'=HYPERLINK(""https://evil.example"")","Travel","Taxi ""airport""","12.50","EUR","submitted","yes","Mia"`,
      `"2026-10-03","Sushi Bar","Meals","'-","1200","JPY","submitted","no","Mia"`,
      '',
    ])
  })

  it('is for the report’s owner and approvers only', async () => {
    expect((await exportReport()).status).toBe(401)
    signInAs('leo')
    expect((await exportReport()).status).toBe(404)
    signInAs('ann')
    expect((await exportReport()).status).toBe(200)
    expect((await exportReport('missing')).status).toBe(404)
  })
})
