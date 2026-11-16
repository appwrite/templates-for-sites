import { resolveMx } from 'node:dns/promises'
import { redirect } from '@tanstack/react-router'
import { deleteCookie, getCookie, getRequestHeader, getRequestUrl, setCookie } from '@tanstack/react-start/server'
import {
  Account,
  AppwriteException,
  Client,
  Functions,
  Messaging,
  Proxy,
  Query,
  Storage,
  TablesDB,
  Teams,
  Users,
  type Models,
} from 'node-appwrite'
import type { Agent, Attachment, Conversation, Customer, Message, SavedReply, Viewer, Workspace } from '#/lib/types'

import { BUCKET, DATABASE, INBOUND_FUNCTION, TEAM } from './schema.server'

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
export const INBOUND_FUNCTION_ID = INBOUND_FUNCTION.id
export const TABLES = {
  conversations: 'conversations',
  messages: 'messages',
  customers: 'customers',
  replies: 'saved_replies',
} as const

// Email triggers only exist on Appwrite Cloud.
export function isCloud() {
  try {
    return /(^|\.)cloud\.appwrite\.io$/.test(new URL(ENDPOINT).hostname)
  } catch {
    return false
  }
}

const SESSION_COOKIE = 'mailroom_session'
const ADMIN_ROLES = ['owner', 'admin']

// On Cloud every function has a built-in inbound domain that needs no DNS
// setup, unless its IDs can't form a valid hostname.
export function builtInMailDomain() {
  const functionId = INBOUND_FUNCTION_ID.toLowerCase()
  if (!isCloud() || /[._]/.test(functionId) || PROJECT_ID.endsWith('-') || functionId.length + PROJECT_ID.length > 62) {
    return null
  }
  return `${functionId}-${PROJECT_ID}.appwrite.email`
}

export function defaultMailbox() {
  const domain = builtInMailDomain()
  return process.env.MAILROOM_MAILBOX || (domain ? `support@${domain}` : '')
}

// On Appwrite Sites every SSR request carries a short-lived key, scoped to the
// site's scopes, on the x-appwrite-key header. APPWRITE_API_KEY is only for local dev.
function apiKey() {
  const key = getRequestHeader('x-appwrite-key') || process.env.APPWRITE_API_KEY
  if (!key) {
    throw new Error('No Appwrite API key: deploy to Appwrite Sites, or set APPWRITE_API_KEY for local development.')
  }
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
    messaging: new Messaging(client),
    functions: new Functions(client),
    proxy: new Proxy(client),
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

// Remembers who asked for a one-time code between the two sign-in steps, so the
// user ID never has to round-trip through the browser.
const PENDING_COOKIE = 'mailroom_otp'

export function setPendingSignIn(userId: string) {
  setCookie(PENDING_COOKIE, userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Matches the 15-minute lifetime of Appwrite's email OTP.
    maxAge: 15 * 60,
  })
}

export function pendingSignIn() {
  return getCookie(PENDING_COOKIE)
}

export function clearPendingSignIn() {
  deleteCookie(PENDING_COOKIE, { path: '/' })
}

export function sessionSecret() {
  return getCookie(SESSION_COOKIE)
}

export interface AgentContext {
  secret: string
  user: Models.User<Models.Preferences>
  membership: Models.Membership
  viewer: Viewer
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

export async function currentAgent(): Promise<AgentContext | null> {
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

  const prefs = user.prefs as { signature?: string }
  return {
    secret,
    user,
    membership,
    viewer: {
      id: user.$id,
      name: user.name,
      email: user.email,
      roles: membership.roles,
      isAdmin: membership.roles.some((role) => ADMIN_ROLES.includes(role)),
      signature: prefs.signature ?? '',
    },
  }
}

export async function requireAgent() {
  const agent = await currentAgent()
  if (!agent) throw redirect({ to: '/login' })
  return agent
}

export async function requireAdmin() {
  const agent = await requireAgent()
  if (!agent.viewer.isAdmin) throw new Error('Only workspace owners and admins can do that.')
  return agent
}

export async function listAgents(): Promise<Agent[]> {
  const { memberships } = await admin().teams.listMemberships({ teamId: TEAM_ID, queries: [Query.limit(100)] })
  return memberships.map((membership) => ({
    id: membership.userId,
    membershipId: membership.$id,
    name: membership.userName,
    email: membership.userEmail,
    roles: membership.roles,
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

export async function getWorkspace(): Promise<Workspace> {
  const prefs = await getTeamPrefs()
  return {
    name: typeof prefs.workspaceName === 'string' && prefs.workspaceName ? prefs.workspaceName : 'Mailroom',
    replyToName: typeof prefs.replyToName === 'string' ? prefs.replyToName : '',
    mailbox: typeof prefs.mailbox === 'string' && prefs.mailbox ? prefs.mailbox : defaultMailbox(),
  }
}

export interface IntakeSettings {
  enabled: boolean
  origins: string[]
}

// Settings for the public POST /api/tickets endpoint, which is off until an admin turns it on.
export function intakeSettings(prefs: Record<string, unknown>): IntakeSettings {
  const intake = (prefs.intake ?? {}) as { enabled?: unknown; origins?: unknown }
  return {
    enabled: intake.enabled === true,
    origins: Array.isArray(intake.origins) ? intake.origins.filter((origin): origin is string => typeof origin === 'string') : [],
  }
}

// The mail server custom email domains point their MX record at.
export async function inboundMxHost() {
  try {
    const [record] = (await resolveMx(builtInMailDomain() ?? '')).sort((a, b) => a.priority - b.priority)
    if (record) return record.exchange
  } catch {
    // DNS lookups can fail in some runtimes; fall back to the region's mail host.
  }
  return `${process.env.APPWRITE_REGION || 'fra'}.appwrite.email`
}

export async function inboundFunction() {
  try {
    return await admin().functions.get({ functionId: INBOUND_FUNCTION_ID })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

// functions.update replaces every setting, so this sends the current values
// back with only the given changes. A Git connection is always dropped, because
// /setup deploys the function's code from this site.
export async function updateInboundFunction(fn: Models.Function, patch: Record<string, unknown> = {}) {
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

// Whether messages can come in and replies go out. On Cloud the email trigger
// receives; on self-hosted Appwrite only the HTTP endpoint can.
export async function emailSetupStatus() {
  const [receiving, providers] = await Promise.all([
    isCloud()
      ? inboundFunction()
          .then((fn) => Boolean(fn?.deploymentId && (fn as unknown as { emailEnabled?: boolean }).emailEnabled))
          .catch(() => false)
      : getTeamPrefs()
          .then((prefs) => intakeSettings(prefs).enabled)
          .catch(() => false),
    admin()
      .messaging.listProviders({ queries: [Query.equal('type', 'email'), Query.equal('enabled', true), Query.limit(1)] })
      .then(({ total }) => total)
      .catch(() => 0),
  ])
  return { receiving, sending: providers > 0, cloud: isCloud() }
}

export async function getRowOrNull(tableId: string, rowId: string) {
  try {
    return await admin().db.getRow({ databaseId: DATABASE_ID, tableId, rowId })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return null
    throw error
  }
}

type Row = Models.DefaultRow

const str = (value: unknown) => (typeof value === 'string' ? value : '')

export function toConversation(row: Row): Conversation {
  return {
    id: row.$id,
    ref: str(row.ref),
    subject: str(row.subject),
    status: (row.status as Conversation['status']) ?? 'open',
    mailbox: str(row.mailbox),
    customerId: str(row.customerId),
    customerEmail: str(row.customerEmail),
    customerName: str(row.customerName),
    assigneeId: str(row.assigneeId) || null,
    assigneeName: str(row.assigneeName),
    tags: Array.isArray(row.tags) ? row.tags : [],
    preview: str(row.preview),
    lastMessageAt: str(row.lastMessageAt) || row.$createdAt,
    lastDirection: row.lastDirection === 'outbound' ? 'outbound' : 'inbound',
    messageCount: Number(row.messageCount ?? 0),
    seen: Boolean(row.seen),
    spamScore: typeof row.spamScore === 'number' ? row.spamScore : null,
    createdAt: row.$createdAt,
  }
}

function parseAttachments(value: unknown): Attachment[] {
  try {
    const parsed = JSON.parse(str(value) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function toMessage(row: Row): Message {
  return {
    id: row.$id,
    conversationId: str(row.conversationId),
    direction: (row.direction as Message['direction']) ?? 'inbound',
    fromEmail: str(row.fromEmail),
    fromName: str(row.fromName),
    recipients: str(row.recipients),
    cc: str(row.cc),
    subject: str(row.subject),
    text: str(row.text),
    html: str(row.html),
    authorId: str(row.authorId),
    authorName: str(row.authorName),
    attachments: parseAttachments(row.attachments),
    deliveryId: str(row.deliveryId),
    source: str(row.source),
    metadata: str(row.metadata),
    deliveryStatus: str(row.deliveryStatus),
    deliveryError: str(row.deliveryError),
    spamVerdict: str(row.spamVerdict),
    createdAt: row.$createdAt,
  }
}

export function toCustomer(row: Row): Customer {
  return {
    id: row.$id,
    email: str(row.email),
    name: str(row.name),
    conversationCount: Number(row.conversationCount ?? 0),
    lastContactAt: str(row.lastContactAt) || null,
    notes: str(row.notes),
    createdAt: row.$createdAt,
  }
}

export function toSavedReply(row: Row): SavedReply {
  return { id: row.$id, name: str(row.name), body: str(row.body), updatedAt: row.$updatedAt }
}

export function friendlyError(error: unknown, fallback: string) {
  if (error instanceof AppwriteException) return new Error(error.message || fallback)
  return error instanceof Error ? error : new Error(fallback)
}
