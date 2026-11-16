import { createServerFn } from '@tanstack/react-start'
import { AppwriteException, ID, Query } from 'node-appwrite'
import { z } from 'zod'
import {
  TEAM_ID,
  admin,
  clearPendingSignIn,
  getWorkspace,
  isCloud,
  listAgents,
  requireAdmin,
  requireAgent,
  setSessionCookie,
  updateTeamPrefs,
} from './appwrite.server'
import {
  PASSWORDS_DISABLED,
  createSessionFromCode,
  hasPassword,
  passwordError,
  passwordSession,
  passwordsEnabled,
  sendCode,
  workspaceAuthMethod,
} from './auth.server'

const password = z.string().min(8, 'Use at least 8 characters.').max(256)

export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer, user } = await requireAgent()
  const [workspace, agents, authMethod] = await Promise.all([getWorkspace(), listAgents(), workspaceAuthMethod()])
  // Which teammates can sign in with a password, for the Team page.
  const { users } = await admin().users.list({
    queries: [Query.equal('$id', agents.map((agent) => agent.id)), Query.limit(100)],
  })
  const withPassword = new Set(users.filter(hasPassword).map((item) => item.$id))
  return {
    viewer,
    workspace,
    authMethod,
    cloud: isCloud(),
    viewerHasPassword: hasPassword(user),
    agents: agents.map((agent) => ({ ...agent, hasPassword: withPassword.has(agent.id) })),
  }
})

export const updateWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(64), replyToName: z.string().trim().max(128) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await updateTeamPrefs({ workspaceName: data.name, replyToName: data.replyToName })
    return { ok: true }
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(128), signature: z.string().max(2000) }))
  .handler(async ({ data }) => {
    const { user } = await requireAgent()
    const { users } = admin()
    await users.updateName({ userId: user.$id, name: data.name })
    await users.updatePrefs({ userId: user.$id, prefs: { ...user.prefs, signature: data.signature } })
    return { ok: true }
  })

// Sets the viewer's password and signs them back in with it, in case Appwrite
// ends their other sessions when a password changes.
async function setOwnPassword(userId: string, email: string, next: string) {
  try {
    await admin().users.updatePassword({ userId, password: next })
  } catch (error) {
    throw passwordError(error)
  }
  setSessionCookie(await passwordSession(email, next))
}

export const changePassword = createServerFn({ method: 'POST' })
  .validator(z.object({ current: z.string().max(256).optional(), password }))
  .handler(async ({ data }) => {
    const { user } = await requireAgent()
    if (hasPassword(user)) {
      if (!data.current) throw new Error('Enter your current password.')
      const check = await passwordSession(user.email, data.current).catch(() => {
        throw new Error('Your current password is wrong.')
      })
      await admin().users.deleteSession({ userId: user.$id, sessionId: check.$id })
    }
    await setOwnPassword(user.$id, user.email, data.password)
    return { ok: true }
  })

// Switching to passwords needs the admin's own password first, so they can
// still sign in afterwards. Teammates without one get it from an admin.
export const switchToPasswords = createServerFn({ method: 'POST' })
  .validator(z.object({ password: password.optional() }))
  .handler(async ({ data }) => {
    const { user } = await requireAdmin()
    if (!(await passwordsEnabled(user.email))) throw new Error(PASSWORDS_DISABLED)
    if (data.password) await setOwnPassword(user.$id, user.email, data.password)
    else if (!hasPassword(user)) throw new Error('Choose your password first.')
    await updateTeamPrefs({ authMethod: 'password' })
    return { ok: true }
  })

// Switching to emailed codes first proves that this Appwrite can deliver them,
// by sending one to the admin making the change.
export const startSwitchToCodes = createServerFn({ method: 'POST' }).handler(async () => {
  const { user } = await requireAdmin()
  if (!(await sendCode(user))) throw new Error('A code was just sent. Wait a minute before asking for another.')
  return { email: user.email }
})

export const confirmSwitchToCodes = createServerFn({ method: 'POST' })
  .validator(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') }))
  .handler(async ({ data }) => {
    const { user } = await requireAdmin()
    const check = await createSessionFromCode(data.code)
    if (check.userId !== user.$id) throw new Error('That code is for someone else.')
    // The code worked; keep the session the admin already has.
    await admin().users.deleteSession({ userId: user.$id, sessionId: check.$id })
    clearPendingSignIn()
    await updateTeamPrefs({ authMethod: 'otp' })
    return { ok: true }
  })

export const addAgent = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(1).max(128),
      email: z.email().trim().toLowerCase(),
      role: z.enum(['admin', 'agent']),
      password: password.optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const { users, teams } = admin()
    if ((await workspaceAuthMethod()) === 'password' && !data.password) throw new Error('Set a password for them to sign in with.')

    const existing = await users.list({ queries: [Query.equal('email', data.email), Query.limit(1)] })
    let userId = existing.users[0]?.$id
    try {
      if (!userId) {
        // With emailed codes there's no password; teammates sign in with a code sent to this address.
        userId = (await users.create({ userId: ID.unique(), email: data.email, name: data.name, password: data.password })).$id
      } else if (data.password) {
        await users.updatePassword({ userId, password: data.password })
      }
    } catch (error) {
      if (error instanceof AppwriteException) throw passwordError(error)
      throw error
    }

    await teams.createMembership({ teamId: TEAM_ID, roles: [data.role], userId })
    return { ok: true }
  })

// Without email there's no self-service reset, so admins set passwords.
export const setAgentPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1).max(36), password }))
  .handler(async ({ data }) => {
    const { viewer } = await requireAdmin()
    const agent = (await listAgents()).find((item) => item.id === data.userId)
    if (!agent) throw new Error('That person isn’t on the team.')
    if (agent.id === viewer.id) throw new Error('Change your own password under Settings → General.')
    if (agent.roles.includes('owner') && !viewer.roles.includes('owner')) throw new Error('Only an owner can reset an owner’s password.')
    try {
      await admin().users.updatePassword({ userId: agent.id, password: data.password })
    } catch (error) {
      throw passwordError(error)
    }
    return { ok: true }
  })

export const removeAgent = createServerFn({ method: 'POST' })
  .validator(z.object({ membershipId: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    const { membership } = await requireAdmin()
    if (membership.$id === data.membershipId) throw new Error("You can't remove yourself.")
    await admin().teams.deleteMembership({ teamId: TEAM_ID, membershipId: data.membershipId })
    return { ok: true }
  })
