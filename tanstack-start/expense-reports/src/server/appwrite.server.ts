import { redirect } from '@tanstack/react-router'
import { deleteCookie, getCookie, getRequestHeader, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import {
  Account,
  AppwriteException,
  Client,
  Functions,
  ID,
  Permission,
  Query,
  Role,
  Storage,
  TablesDB,
  Teams,
  Users,
  type Models,
} from 'node-appwrite'
import { ROLES, type AuditEvent, type Category, type Expense, type ExpenseDetail, type Member, type Report, type Viewer, type Workspace } from '#/lib/types'
import { BUCKET, DATABASE, RECEIPTS_FUNCTION, TEAM } from './schema.server'

// Appwrite Sites injects the endpoint and project ID. APPWRITE_ENDPOINT and
// APPWRITE_PROJECT_ID are only for local development.
export const ENDPOINT = process.env.APPWRITE_SITE_API_ENDPOINT || process.env.APPWRITE_ENDPOINT || ''
export const PROJECT_ID = process.env.APPWRITE_SITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID || ''
// Browsers open Realtime against this one. Self-hosted instances whose sites
// reach Appwrite on an internal address set APPWRITE_PUBLIC_ENDPOINT.
export const PUBLIC_ENDPOINT = process.env.APPWRITE_PUBLIC_ENDPOINT || ENDPOINT
export const DATABASE_ID = DATABASE.id
export const BUCKET_ID = BUCKET.id
export const TEAM_ID = TEAM.id
export const RECEIPTS_FUNCTION_ID = RECEIPTS_FUNCTION.id
export const TABLES = { expenses: 'expenses', reports: 'reports', events: 'events', categories: 'categories' } as const

// Email triggers only exist on Appwrite Cloud.
export function isCloud() {
  try {
    return /(^|\.)cloud\.appwrite\.io$/.test(new URL(ENDPOINT).hostname)
  } catch {
    return false
  }
}

const SESSION_COOKIE = 'outlay_session'

// On Appwrite Sites every SSR request carries a short-lived key, scoped to the
// site's scopes, on the x-appwrite-key header. APPWRITE_API_KEY is only for local dev.
function apiKey() {
  const key = getRequestHeader('x-appwrite-key') || process.env.APPWRITE_API_KEY
  if (!key) throw new Error('No Appwrite API key: deploy to Appwrite Sites, or set APPWRITE_API_KEY for local development.')
  return key
}

// The ephemeral key is a JWT that lists the scopes granted to the site. Returns
// null when the scopes can't be read, such as with a regular API key in local dev.
export function grantedScopes(): string[] | null {
  const key = getRequestHeader('x-appwrite-key')
  const payload = key?.slice(key.indexOf('_') + 1).split('.')[1]
  if (!payload) return null
  try {
    const { scopes } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { scopes?: unknown }
    return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : null
  } catch {
    return null
  }
}

function projectClient() {
  if (!ENDPOINT || !PROJECT_ID) {
    throw new Error('Set APPWRITE_ENDPOINT and APPWRITE_PROJECT_ID for local development. Appwrite Sites sets them for you.')
  }
  return new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID)
}

export function adminClient() {
  return projectClient().setKey(apiKey())
}

export function admin() {
  const client = adminClient()
  return {
    db: new TablesDB(client),
    users: new Users(client),
    teams: new Teams(client),
    storage: new Storage(client),
    functions: new Functions(client),
  }
}

function siteOrigin() {
  return getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin
}

// No key and no session, like a browser. Sign-in calls go through this so
// Appwrite's own rate limits apply, which the site key would skip. The site's
// domain belongs to the project, so Appwrite accepts it as the origin.
export function guestAccount() {
  const client = projectClient().addHeader('Origin', siteOrigin())
  const userAgent = getRequestHeader('user-agent')
  if (userAgent) client.setForwardedUserAgent(userAgent)
  return new Account(client)
}

// Creates a session as a guest. Appwrite returns the secret in a cookie header
// rather than the body, and the SDK only returns the body, so this uses fetch.
export async function guestSession(path: '/account/sessions/email' | '/account/sessions/token', body: Record<string, string>) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-appwrite-project': PROJECT_ID,
    origin: siteOrigin(),
  }
  const userAgent = getRequestHeader('user-agent')
  if (userAgent) headers['x-forwarded-user-agent'] = userAgent
  const response = await fetch(`${ENDPOINT}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new AppwriteException(String(json.message || response.statusText), response.status, String(json.type || ''))

  const cookieName = `a_session_${PROJECT_ID}`
  let secret = ''
  try {
    secret = (JSON.parse(response.headers.get('x-fallback-cookies') || '{}') as Record<string, string>)[cookieName] ?? ''
  } catch {
    // Read the cookie instead.
  }
  for (const cookie of secret ? [] : response.headers.getSetCookie()) {
    const [name, ...value] = cookie.split(';')[0].split('=')
    if (name.trim() === cookieName) secret = decodeURIComponent(value.join('='))
  }
  if (!secret) throw new Error('Appwrite didn’t return a session.')
  return { ...json, secret } as unknown as Models.Session
}

export function sessionAccount(secret: string) {
  const client = projectClient().setSession(secret)
  const userAgent = getRequestHeader('user-agent')
  if (userAgent) client.setForwardedUserAgent(userAgent)
  return new Account(client)
}

export function setSessionCookie(session: Models.Session) {
  setCookie(SESSION_COOKIE, session.secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: new Date(session.expire),
  })
}

export function clearSessionCookie() {
  deleteCookie(SESSION_COOKIE, { path: '/' })
}

export function sessionSecret() {
  return getCookie(SESSION_COOKIE)
}

// Remembers who asked for a sign-in code between the two OTP steps.
const OTP_COOKIE = 'outlay_otp'

export function setOtpCookie(userId: string) {
  setCookie(OTP_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Matches the 15-minute lifetime of Appwrite's email OTP.
    maxAge: 15 * 60,
  })
}

export function otpUserId() {
  return getCookie(OTP_COOKIE)
}

export function clearOtpCookie() {
  deleteCookie(OTP_COOKIE, { path: '/' })
}

// On Cloud every function has a built-in inbound address that needs no DNS
// setup, unless its IDs can't form a valid hostname. Self-hosted has none.
export function receiptsAddress() {
  const functionId = RECEIPTS_FUNCTION_ID.toLowerCase()
  if (!isCloud() || /[._]/.test(functionId) || PROJECT_ID.endsWith('-') || functionId.length + PROJECT_ID.length > 62) {
    return null
  }
  return `receipts@${functionId}-${PROJECT_ID}.appwrite.email`
}

function roleOf(roles: string[]) {
  return ROLES.find((role) => roles.includes(role)) ?? 'member'
}

export async function findMembership(userId: string) {
  try {
    const { memberships } = await admin().teams.listMemberships({
      teamId: TEAM_ID,
      queries: [Query.equal('userId', userId), Query.limit(1)],
    })
    return memberships[0] ?? null
  } catch (error) {
    // Before /setup has created the team, nobody is a member.
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

// The workspace needs setup until its team exists and has an owner.
export async function needsSetup() {
  try {
    const { total } = await admin().teams.listMemberships({ teamId: TEAM_ID, queries: [Query.limit(1)] })
    return total === 0
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return true
    throw error
  }
}

export interface MemberContext {
  secret: string
  user: Models.User<Models.Preferences>
  membership: Models.Membership
  viewer: Viewer
}

export async function currentMember(): Promise<MemberContext | null> {
  const secret = sessionSecret()
  if (!secret) return null
  let user: Models.User<Models.Preferences>
  try {
    user = await sessionAccount(secret).get()
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) return null
    throw error
  }
  const membership = await findMembership(user.$id)
  if (!membership) return null
  const role = roleOf(membership.roles)
  return {
    secret,
    user,
    membership,
    viewer: {
      id: user.$id,
      name: user.name || user.email,
      email: user.email,
      role,
      isAdmin: role === 'owner' || role === 'admin',
      canApprove: role !== 'member',
    },
  }
}

export async function requireMember() {
  const member = await currentMember()
  if (!member) throw redirect({ to: '/login' })
  return member
}

export async function requireApprover() {
  const member = await requireMember()
  if (!member.viewer.canApprove) throw new Error('Only approvers and admins can do that.')
  return member
}

export async function requireAdmin() {
  const member = await requireMember()
  if (!member.viewer.isAdmin) throw new Error('Only workspace owners and admins can do that.')
  return member
}

export async function listMembers(): Promise<Member[]> {
  const { memberships } = await admin().teams.listMemberships({ teamId: TEAM_ID, queries: [Query.limit(100)] })
  return memberships.map((membership) => ({
    id: membership.userId,
    membershipId: membership.$id,
    name: membership.userName || membership.userEmail,
    email: membership.userEmail,
    role: roleOf(membership.roles),
  }))
}

export async function getTeamPrefs() {
  return (await admin().teams.getPrefs({ teamId: TEAM_ID })) as Record<string, unknown>
}

// Team prefs hold the workspace settings, so every write merges into what's there.
export async function updateTeamPrefs(patch: Record<string, unknown>) {
  const prefs = await getTeamPrefs()
  await admin().teams.updatePrefs({ teamId: TEAM_ID, prefs: { ...prefs, ...patch } })
}

export async function receiptsFunction() {
  try {
    return await admin().functions.get({ functionId: RECEIPTS_FUNCTION_ID })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

// functions.update replaces every setting, so this sends the current values
// back with only the given changes. A Git connection is always dropped, because
// /setup deploys the function's code from this site.
export async function updateReceiptsFunction(fn: Models.Function, patch: Record<string, unknown> = {}) {
  const current = fn as Models.Function & {
    emailEnabled?: boolean
    buildSpecification?: string
    runtimeSpecification?: string
  }
  return admin().functions.update({
    functionId: fn.$id,
    name: fn.name,
    runtime: fn.runtime as never,
    execute: fn.execute,
    events: fn.events,
    schedule: fn.schedule,
    timeout: fn.timeout,
    enabled: fn.enabled,
    logging: fn.logging,
    entrypoint: fn.entrypoint,
    commands: fn.commands,
    scopes: fn.scopes as never,
    installationId: '',
    providerRepositoryId: '',
    providerBranch: '',
    providerSilentMode: false,
    providerRootDirectory: '',
    buildSpecification: current.buildSpecification,
    runtimeSpecification: current.runtimeSpecification,
    deploymentRetention: fn.deploymentRetention,
    description: fn.description,
    emailEnabled: current.emailEnabled ?? false,
    ...patch,
  })
}

export async function getWorkspace(): Promise<Workspace> {
  const prefs = await getTeamPrefs()
  return {
    name: typeof prefs.workspaceName === 'string' && prefs.workspaceName ? prefs.workspaceName : 'Outlay',
    currency: typeof prefs.currency === 'string' && prefs.currency ? prefs.currency : 'USD',
    receiptsAddress: receiptsAddress(),
  }
}

// Rows are readable by their owner; approvers and admins read through table permissions.
export function ownerPermissions(ownerId: string) {
  return [Permission.read(Role.user(ownerId))]
}

export async function getRowOrNull(tableId: string, rowId: string) {
  try {
    return await admin().db.getRow({ databaseId: DATABASE_ID, tableId, rowId })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

export async function recordEvent(ownerId: string, event: Omit<AuditEvent, 'id' | 'createdAt'> & { reportId?: string; expenseId?: string; actorId: string }) {
  await admin().db.createRow({
    databaseId: DATABASE_ID,
    tableId: TABLES.events,
    rowId: ID.unique(),
    permissions: ownerPermissions(ownerId),
    data: event,
  })
}

type Row = Models.DefaultRow
const str = (value: unknown) => (typeof value === 'string' ? value : '')

export function toExpense(row: Row): Expense {
  return {
    id: row.$id,
    ownerId: str(row.ownerId),
    ownerName: str(row.ownerName),
    merchant: str(row.merchant),
    amount: Number(row.amount ?? 0),
    currency: str(row.currency) || 'USD',
    spentAt: str(row.spentAt) || row.$createdAt,
    categoryId: str(row.categoryId),
    categoryName: str(row.categoryName),
    description: str(row.description),
    status: (row.status as Expense['status']) ?? 'draft',
    reportId: str(row.reportId) || null,
    receipt: str(row.receiptFileId)
      ? { fileId: str(row.receiptFileId), name: str(row.receiptName), type: str(row.receiptType) }
      : null,
    source: row.source === 'email' ? 'email' : 'manual',
    emailSubject: str(row.emailSubject),
    overLimit: Boolean(row.overLimit),
    createdAt: row.$createdAt,
  }
}

export function toExpenseDetail(row: Row): ExpenseDetail {
  return { ...toExpense(row), emailHtml: str(row.emailHtml), emailText: str(row.emailText) }
}

function parseTotals(value: unknown): Record<string, number> {
  try {
    const parsed = JSON.parse(str(value) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function toReport(row: Row): Report {
  return {
    id: row.$id,
    title: str(row.title),
    ownerId: str(row.ownerId),
    ownerName: str(row.ownerName),
    status: (row.status as Report['status']) ?? 'draft',
    totals: parseTotals(row.totals),
    expenseCount: Number(row.expenseCount ?? 0),
    approverName: str(row.approverName),
    comment: str(row.comment),
    submittedAt: str(row.submittedAt) || null,
    decidedAt: str(row.decidedAt) || null,
    reimbursedAt: str(row.reimbursedAt) || null,
    createdAt: row.$createdAt,
  }
}

export function toCategory(row: Row): Category {
  return { id: row.$id, name: str(row.name), limit: Number(row.limit ?? 0), archived: Boolean(row.archived) }
}

export function toEvent(row: Row): AuditEvent {
  return {
    id: row.$id,
    action: str(row.action),
    actorName: str(row.actorName),
    fromStatus: str(row.fromStatus),
    toStatus: str(row.toStatus),
    comment: str(row.comment),
    createdAt: row.$createdAt,
  }
}

export function totalsOf(expenses: Pick<Expense, 'amount' | 'currency'>[]) {
  const totals: Record<string, number> = {}
  for (const expense of expenses) totals[expense.currency] = (totals[expense.currency] ?? 0) + expense.amount
  return totals
}

export async function listCategories() {
  const { rows } = await admin().db.listRows({
    databaseId: DATABASE_ID,
    tableId: TABLES.categories,
    queries: [Query.orderAsc('name'), Query.limit(200)],
    total: false,
  })
  return rows.map(toCategory)
}
