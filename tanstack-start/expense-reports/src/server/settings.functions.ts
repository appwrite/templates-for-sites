import { createServerFn } from '@tanstack/react-start'
import { AppwriteException, ID, Query, type Models } from 'node-appwrite'
import { z } from 'zod'
import { CURRENCIES, parseMoney } from '#/lib/money'
import {
  DATABASE_ID,
  RECEIPTS_FUNCTION_ID,
  TABLES,
  TEAM_ID,
  admin,
  clearOtpCookie,
  getWorkspace,
  isCloud,
  listCategories,
  listMembers,
  receiptsAddress,
  receiptsFunction,
  requireAdmin,
  requireMember,
  setSessionCookie,
  updateReceiptsFunction,
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
  const { viewer, user } = await requireMember()
  const [workspace, members, categories, authMethod] = await Promise.all([
    getWorkspace(),
    listMembers(),
    listCategories(),
    workspaceAuthMethod(),
  ])
  // Which teammates can sign in with a password, for the Team page.
  const { users } = await admin().users.list({
    queries: [Query.equal('$id', members.map((member) => member.id)), Query.limit(100)],
  })
  const withPassword = new Set(users.filter(hasPassword).map((item) => item.$id))
  return {
    viewer,
    workspace,
    categories,
    authMethod,
    cloud: isCloud(),
    viewerHasPassword: hasPassword(user),
    members: members.map((member) => ({ ...member, hasPassword: withPassword.has(member.id) })),
  }
})

export const updateWorkspace = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(64), currency: z.enum(CURRENCIES) }))
  .handler(async ({ data }) => {
    await requireAdmin()
    await updateTeamPrefs({ workspaceName: data.name, currency: data.currency })
    return { ok: true }
  })

export const updateProfile = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(128) }))
  .handler(async ({ data }) => {
    const { user } = await requireMember()
    await admin().users.updateName({ userId: user.$id, name: data.name })
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
    const { user } = await requireMember()
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
  await sendCode(user)
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
    clearOtpCookie()
    await updateTeamPrefs({ authMethod: 'otp' })
    return { ok: true }
  })

export const saveCategory = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.string().min(1).max(36).optional(),
      name: z.string().trim().min(1, 'Name the category.').max(64),
      limit: z.string().trim().max(20),
      archived: z.boolean().default(false),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin()
    const workspace = await getWorkspace()
    const limit = data.limit ? parseMoney(data.limit, workspace.currency) : 0
    if (limit === null) throw new Error('Enter the limit as an amount, or leave it blank for no limit.')
    try {
      await admin().db.upsertRow({
        databaseId: DATABASE_ID,
        tableId: TABLES.categories,
        rowId: data.id ?? ID.unique(),
        data: { name: data.name, limit, archived: data.archived },
      })
    } catch (error) {
      if (error instanceof AppwriteException && error.code === 409) throw new Error(`A category named ${data.name} already exists.`)
      throw error
    }
    return { ok: true }
  })

export const addMember = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(1).max(128),
      email: z.email().trim().toLowerCase(),
      role: z.enum(['admin', 'approver', 'member']),
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
export const setMemberPassword = createServerFn({ method: 'POST' })
  .validator(z.object({ userId: z.string().min(1).max(36), password }))
  .handler(async ({ data }) => {
    const { viewer } = await requireAdmin()
    const member = (await listMembers()).find((item) => item.id === data.userId)
    if (!member) throw new Error('That person isn’t in the workspace.')
    if (member.id === viewer.id) throw new Error('Change your own password under Settings → General.')
    if (member.role === 'owner' && viewer.role !== 'owner') throw new Error('Only an owner can reset an owner’s password.')
    try {
      await admin().users.updatePassword({ userId: member.id, password: data.password })
    } catch (error) {
      throw passwordError(error)
    }
    return { ok: true }
  })

export const updateMemberRole = createServerFn({ method: 'POST' })
  .validator(z.object({ membershipId: z.string().min(1).max(36), role: z.enum(['admin', 'approver', 'member']) }))
  .handler(async ({ data }) => {
    const { membership } = await requireAdmin()
    if (membership.$id === data.membershipId) throw new Error("You can't change your own role.")
    const { teams } = admin()
    const target = await teams.getMembership({ teamId: TEAM_ID, membershipId: data.membershipId })
    if (target.roles.includes('owner')) throw new Error("The workspace owner's role can't be changed.")
    await teams.updateMembership({ teamId: TEAM_ID, membershipId: data.membershipId, roles: [data.role] })
    return { ok: true }
  })

export const removeMember = createServerFn({ method: 'POST' })
  .validator(z.object({ membershipId: z.string().min(1).max(36) }))
  .handler(async ({ data }) => {
    const { membership } = await requireAdmin()
    if (membership.$id === data.membershipId) throw new Error("You can't remove yourself.")
    const { teams } = admin()
    const target = await teams.getMembership({ teamId: TEAM_ID, membershipId: data.membershipId })
    if (target.roles.includes('owner')) throw new Error("The workspace owner can't be removed.")
    await teams.deleteMembership({ teamId: TEAM_ID, membershipId: data.membershipId })
    return { ok: true }
  })

const emailEnabled = (fn: Models.Function | null) => Boolean((fn as unknown as { emailEnabled?: boolean } | null)?.emailEnabled)

export const getReceiptSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const { viewer } = await requireMember()
  // Email triggers only exist on Appwrite Cloud.
  const fn = isCloud() ? await receiptsFunction() : null
  return {
    cloud: isCloud(),
    canEdit: viewer.isAdmin,
    address: receiptsAddress(),
    deployed: Boolean(fn?.deploymentId),
    emailEnabled: emailEnabled(fn),
  }
})

export const setReceiptsTrigger = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    if (!isCloud()) throw new Error('Receipts by email needs email triggers, which are only on Appwrite Cloud.')
    const fn = await receiptsFunction()
    if (!fn) throw new Error(`The ${RECEIPTS_FUNCTION_ID} function doesn't exist yet. Create it under Settings → System.`)
    await updateReceiptsFunction(fn, { emailEnabled: data.enabled })
    return { ok: true }
  })
