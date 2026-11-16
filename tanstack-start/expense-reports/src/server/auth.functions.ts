import { createServerFn } from '@tanstack/react-start'
import { ID, type Models } from 'node-appwrite'
import { z } from 'zod'
import { CURRENCIES } from '#/lib/money'
import {
  DATABASE_ID,
  PROJECT_ID,
  PUBLIC_ENDPOINT,
  TABLES,
  TEAM_ID,
  admin,
  clearOtpCookie,
  clearSessionCookie,
  currentMember,
  findMembership,
  needsSetup,
  requireMember,
  sessionAccount,
  sessionSecret,
  setSessionCookie,
  updateTeamPrefs,
} from './appwrite.server'
import {
  AUTH_METHODS,
  INVALID_LOGIN,
  createSessionFromCode,
  findUser,
  passwordError,
  passwordSession,
  sendCode,
  workspaceAuthMethod,
} from './auth.server'
import { requireSetupAccess } from './setup.server'

const DEFAULT_CATEGORIES = ['Travel', 'Meals', 'Lodging', 'Transport', 'Software', 'Office supplies', 'Other']

const email = z.email().trim().toLowerCase()
const code = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.')
const password = z.string().min(8, 'Use at least 8 characters.').max(256)

async function requireMethod(method: 'otp' | 'password') {
  if ((await workspaceAuthMethod()) !== method) {
    throw new Error(
      method === 'otp' ? 'This workspace signs in with a password. Reload the page.' : 'This workspace signs in with an emailed code. Reload the page.',
    )
  }
}

interface PendingWorkspace {
  workspaceName: string
  currency: string
}

export const getViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const member = await currentMember()
  return member?.viewer ?? null
})

export const getSetupState = createServerFn({ method: 'GET' }).handler(async () => {
  // A key without the scopes to check sends everyone to /setup, which explains the fix.
  return { needsSetup: await needsSetup().catch(() => true) }
})

export const getSignInMethod = createServerFn({ method: 'GET' }).handler(async () => ({ method: await workspaceAuthMethod() }))

export const requestSignInCode = createServerFn({ method: 'POST' })
  .validator(z.object({ email }))
  .handler(async ({ data }) => {
    await requireMethod('otp')
    const user = await findUser(data.email)
    // Answer the same way whether or not the address belongs to a member.
    if (user && (await findMembership(user.$id))) await sendCode(user)
    return { ok: true }
  })

export const verifySignInCode = createServerFn({ method: 'POST' })
  .validator(z.object({ code }))
  .handler(async ({ data }) => {
    await requireMethod('otp')
    const session = await createSessionFromCode(data.code)
    if (!(await findMembership(session.userId))) {
      await admin().users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error('This account is not part of the workspace. Ask an admin to add you.')
    }
    setSessionCookie(session)
    clearOtpCookie()
    return { ok: true }
  })

export const signInWithPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ email, password: z.string().min(1, 'Enter your password.').max(256) }))
  .handler(async ({ data }) => {
    await requireMethod('password')

    const session = await passwordSession(data.email, data.password)
    // Only members can sign in, and everyone else sees the same error.
    if (!(await findMembership(session.userId))) {
      await admin().users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error(INVALID_LOGIN)
    }
    setSessionCookie(session)
    return { ok: true }
  })

async function addDefaultCategories() {
  const { db } = admin()
  await Promise.all(
    DEFAULT_CATEGORIES.map((name) =>
      db
        .createRow({ databaseId: DATABASE_ID, tableId: TABLES.categories, rowId: ID.unique(), data: { name, limit: 0, archived: false } })
        .catch(() => undefined),
    ),
  )
}

export const startSetup = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        email,
        name: z.string().trim().min(1, 'Enter your name.').max(128),
        workspaceName: z.string().trim().min(1, 'Name your workspace.').max(64),
        currency: z.enum(CURRENCIES),
        authMethod: z.enum(AUTH_METHODS),
        password: password.optional(),
      })
      .refine((input) => input.authMethod === 'otp' || input.password, { message: 'Choose a password.', path: ['password'] }),
  )
  .handler(async ({ data }) => {
    await requireSetupAccess()
    const { users, teams } = admin()
    const existing = await findUser(data.email)

    if (data.authMethod === 'otp') {
      const user = existing ?? (await users.create({ userId: ID.unique(), email: data.email, name: data.name }))
      const prefs = (await users.getPrefs({ userId: user.$id })) as Record<string, unknown>
      const pendingWorkspace: PendingWorkspace = { workspaceName: data.workspaceName, currency: data.currency }
      await users.updatePrefs({ userId: user.$id, prefs: { ...prefs, pendingWorkspace } })
      await sendCode(user)
      return { signedIn: false }
    }

    // With passwords there's no email to confirm, so the owner is created right away.
    let user: Models.User<Models.Preferences>
    try {
      user = existing
        ? await users.updatePassword({ userId: existing.$id, password: data.password! })
        : await users.create({ userId: ID.unique(), email: data.email, name: data.name, password: data.password! })
    } catch (error) {
      throw passwordError(error)
    }
    await users.updateName({ userId: user.$id, name: data.name })
    const session = await passwordSession(data.email, data.password!)
    if (!(await needsSetup())) {
      await users.deleteSession({ userId: user.$id, sessionId: session.$id })
      throw new Error('This workspace is already set up. Sign in instead.')
    }
    await teams.createMembership({ teamId: TEAM_ID, roles: ['owner'], userId: user.$id })
    await updateTeamPrefs({ workspaceName: data.workspaceName, currency: data.currency, authMethod: 'password' })
    await addDefaultCategories()
    setSessionCookie(session)
    return { signedIn: true }
  })

// The owner role is only claimed once the code proves the email address.
export const completeSetup = createServerFn({ method: 'POST' })
  .validator(z.object({ code }))
  .handler(async ({ data }) => {
    await requireSetupAccess()
    const session = await createSessionFromCode(data.code)
    const { teams, users } = admin()

    if (!(await needsSetup())) {
      await users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error('This workspace is already set up. Sign in instead.')
    }

    const prefs = (await users.getPrefs({ userId: session.userId })) as Record<string, unknown>
    const pending = prefs.pendingWorkspace as PendingWorkspace | undefined
    if (!pending?.workspaceName) {
      await users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error('Setup expired. Start again.')
    }

    await teams.createMembership({ teamId: TEAM_ID, roles: ['owner'], userId: session.userId })
    await updateTeamPrefs({ workspaceName: pending.workspaceName, currency: pending.currency, authMethod: 'otp' })
    const { pendingWorkspace: _done, ...rest } = prefs
    await users.updatePrefs({ userId: session.userId, prefs: rest })
    await addDefaultCategories()

    setSessionCookie(session)
    clearOtpCookie()
    return { ok: true }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const secret = sessionSecret()
  if (secret) await sessionAccount(secret).deleteSession({ sessionId: 'current' }).catch(() => undefined)
  clearSessionCookie()
  return { ok: true }
})

// A one-hour JWT tied to the session lets the browser use Realtime without the
// httpOnly cookie. Row permissions still decide which events it receives.
export const getRealtimeToken = createServerFn({ method: 'POST' }).handler(async () => {
  const member = await requireMember()
  const session = await sessionAccount(member.secret).getSession({ sessionId: 'current' })
  const { jwt } = await admin().users.createJWT({ userId: member.user.$id, sessionId: session.$id, duration: 3600 })
  return { jwt, endpoint: PUBLIC_ENDPOINT, projectId: PROJECT_ID, databaseId: DATABASE_ID }
})
