import { createServerFn } from '@tanstack/react-start'
import { ID, type Models } from 'node-appwrite'
import { z } from 'zod'
import {
  DATABASE_ID,
  PROJECT_ID,
  PUBLIC_ENDPOINT,
  TEAM_ID,
  admin,
  clearPendingSignIn,
  clearSessionCookie,
  currentAgent,
  findMembership,
  needsSetup,
  requireAgent,
  sessionAccount,
  sessionSecret,
  setSessionCookie,
  updateTeamPrefs,
} from './appwrite.server'
import {
  AUTH_METHODS,
  INVALID_CODE,
  INVALID_LOGIN,
  createSessionFromCode,
  findUser,
  passwordError,
  passwordSession,
  sendCode,
  workspaceAuthMethod,
} from './auth.server'
import { requireSetupAccess } from './setup.server'

const email = z.email().trim().toLowerCase()
const code = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') })
const password = z.string().min(8, 'Use at least 8 characters.').max(256)

async function requireMethod(method: 'otp' | 'password') {
  if ((await workspaceAuthMethod()) !== method) {
    throw new Error(method === 'otp' ? 'This workspace signs in with a password. Reload the page.' : 'This workspace signs in with an emailed code. Reload the page.')
  }
}

export const getViewer = createServerFn({ method: 'GET' }).handler(async () => {
  const agent = await currentAgent()
  return agent?.viewer ?? null
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
    clearPendingSignIn()
    const user = await findUser(data.email)
    // Only teammates get a code. Everyone sees the same response, so the form
    // can't be used to find out who is on the team.
    if (user && (await findMembership(user.$id))) await sendCode(user)
    return { ok: true }
  })

export const verifySignInCode = createServerFn({ method: 'POST' })
  .validator(code)
  .handler(async ({ data }) => {
    await requireMethod('otp')
    const session = await createSessionFromCode(data.code)
    if (!(await findMembership(session.userId))) {
      await admin().users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error(INVALID_CODE)
    }
    clearPendingSignIn()
    setSessionCookie(session)
    return { ok: true }
  })

export const signInWithPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ email, password: z.string().min(1, 'Enter your password.').max(256) }))
  .handler(async ({ data }) => {
    await requireMethod('password')
    const session = await passwordSession(data.email, data.password)
    // Only teammates can sign in, and everyone else sees the same error.
    if (!(await findMembership(session.userId))) {
      await admin().users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error(INVALID_LOGIN)
    }
    setSessionCookie(session)
    return { ok: true }
  })

export const startSetup = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        email,
        name: z.string().trim().min(1, 'Enter your name.').max(128),
        workspaceName: z.string().trim().min(1, 'Name your workspace.').max(64),
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
      await users.updatePrefs({
        userId: user.$id,
        prefs: { ...user.prefs, pendingWorkspace: { name: data.name, workspaceName: data.workspaceName } },
      })
      if (!(await sendCode(await users.get({ userId: user.$id })))) {
        throw new Error('A code was just sent. Wait a minute before asking for another.')
      }
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
      throw new Error('Someone else finished setting up this workspace first. Ask them to add you.')
    }
    await teams.createMembership({ teamId: TEAM_ID, roles: ['owner'], userId: user.$id })
    await updateTeamPrefs({ workspaceName: data.workspaceName, replyToName: data.workspaceName, authMethod: 'password' })
    setSessionCookie(session)
    return { signedIn: true }
  })

// The owner role is only claimed once the email address is proven.
export const completeSetup = createServerFn({ method: 'POST' })
  .validator(code)
  .handler(async ({ data }) => {
    await requireSetupAccess()
    const session = await createSessionFromCode(data.code)
    const { teams, users } = admin()
    if (!(await needsSetup())) {
      await users.deleteSession({ userId: session.userId, sessionId: session.$id })
      throw new Error('Someone else finished setting up this workspace first. Ask them to add you.')
    }

    const user = await users.get({ userId: session.userId })
    const { pendingWorkspace, ...prefs } = user.prefs as { pendingWorkspace?: { name: string; workspaceName: string } }
    if (!pendingWorkspace) throw new Error('Start the setup again.')

    await users.updateName({ userId: user.$id, name: pendingWorkspace.name })
    await users.updatePrefs({ userId: user.$id, prefs })
    await users.updateEmailVerification({ userId: user.$id, emailVerification: true })
    await teams.createMembership({ teamId: TEAM_ID, roles: ['owner'], userId: user.$id })
    await updateTeamPrefs({ workspaceName: pendingWorkspace.workspaceName, replyToName: pendingWorkspace.workspaceName, authMethod: 'otp' })

    clearPendingSignIn()
    setSessionCookie(session)
    return { ok: true }
  })

export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  const secret = sessionSecret()
  if (secret) {
    await sessionAccount(secret)
      .deleteSession({ sessionId: 'current' })
      .catch(() => undefined)
  }
  clearSessionCookie()
  return { ok: true }
})

// A one-hour JWT tied to the agent's session lets the browser open a Realtime
// connection without ever seeing the httpOnly session cookie.
export const getRealtimeToken = createServerFn({ method: 'POST' }).handler(async () => {
  const agent = await requireAgent()
  const session = await sessionAccount(agent.secret).getSession({ sessionId: 'current' })
  const { jwt } = await admin().users.createJWT({ userId: agent.user.$id, sessionId: session.$id, duration: 3600 })
  return { jwt, endpoint: PUBLIC_ENDPOINT, projectId: PROJECT_ID, databaseId: DATABASE_ID }
})
