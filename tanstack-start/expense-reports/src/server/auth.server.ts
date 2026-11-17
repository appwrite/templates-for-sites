import { randomUUID } from 'node:crypto'
import { AppwriteException, Query, type Models } from 'node-appwrite'
import { admin, getTeamPrefs, guestAccount, guestSession, isCloud, otpUserId, setOtpCookie } from './appwrite.server'

// Each workspace signs in one way: a 6-digit code emailed by Appwrite, or a
// password. Codes need email delivery, which self-hosted Appwrite only has once
// SMTP is configured, so self-hosted setups default to passwords.
export const AUTH_METHODS = ['otp', 'password'] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

export const defaultAuthMethod = (): AuthMethod => (isCloud() ? 'otp' : 'password')

// Workspaces from before this setting existed use codes.
export async function workspaceAuthMethod(): Promise<AuthMethod> {
  try {
    return (await getTeamPrefs()).authMethod === 'password' ? 'password' : 'otp'
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 404) return defaultAuthMethod()
    throw error
  }
}

export async function findUser(address: string) {
  const { users } = await admin().users.list({ queries: [Query.equal('email', address), Query.limit(1)] })
  return users[0] ?? null
}

export const hasPassword = (user: Models.User<Models.Preferences>) => Boolean(user.password)

const RESEND_AFTER_MS = 60_000
export const INVALID_CODE = 'That code is invalid or has expired.'

// Sends a 6-digit code, at most once a minute per user.
export async function sendCode(user: Models.User<Models.Preferences>) {
  const { users } = admin()
  const prefs = (await users.getPrefs({ userId: user.$id })) as Record<string, unknown>
  const sentAt = typeof prefs.otpSentAt === 'number' ? prefs.otpSentAt : 0
  if (Date.now() - sentAt < RESEND_AFTER_MS) {
    throw new Error('A code was just sent. Wait a minute before asking for another.')
  }
  await users.updatePrefs({ userId: user.$id, prefs: { ...prefs, otpSentAt: Date.now() } })
  try {
    await guestAccount().createEmailToken({ userId: user.$id, email: user.email })
  } catch (error) {
    // Self-hosted Appwrite sends sign-in codes only once SMTP is configured.
    if (error instanceof AppwriteException && /smtp/i.test(`${error.type} ${error.message}`)) {
      throw new Error(
        "Appwrite couldn't send the code because SMTP isn't configured. Set the _APP_SMTP_* variables on your Appwrite instance, or a custom SMTP server in the project's settings, or use passwords instead.",
      )
    }
    throw error
  }
  setOtpCookie(user.$id)
}

export async function createSessionFromCode(secret: string) {
  const userId = otpUserId()
  if (!userId) throw new Error(INVALID_CODE)
  try {
    return await guestSession('/account/sessions/token', { userId, secret })
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 429) throw new Error(TOO_MANY)
    if (error instanceof AppwriteException && error.code < 500) throw new Error(INVALID_CODE)
    throw error
  }
}

const TOO_MANY = 'Too many attempts. Wait a few minutes, then try again.'

export const INVALID_LOGIN = 'That email and password don’t match.'
export const PASSWORDS_DISABLED =
  'Email and password sign-in is turned off for this Appwrite project. Turn it on under Auth → Settings in the Console.'

// A site key can't read the project's auth settings, so a sign-in with a
// throwaway password tells whether email and password sign-in is on.
export async function passwordsEnabled(email: string) {
  try {
    await guestSession('/account/sessions/email', { email, password: randomUUID() })
    return true
  } catch (error) {
    return !(error instanceof AppwriteException && error.type === 'user_auth_method_unsupported')
  }
}

// Signs in as a guest, so Appwrite's own per-email limit on attempts applies.
export async function passwordSession(email: string, password: string) {
  try {
    return await guestSession('/account/sessions/email', { email, password })
  } catch (error) {
    if (!(error instanceof AppwriteException)) throw error
    if (error.type === 'user_auth_method_unsupported') throw new Error(PASSWORDS_DISABLED)
    if (error.code === 429) throw new Error(TOO_MANY)
    if (error.code === 401) throw new Error(INVALID_LOGIN)
    throw error
  }
}

// Appwrite's password policy errors, without the parameter prefix.
export function passwordError(error: unknown) {
  if (error instanceof AppwriteException && error.code === 400) {
    return new Error(error.message.replace(/^Invalid `password` param:\s*/i, ''))
  }
  return error instanceof Error ? error : new Error('Could not set the password.')
}
