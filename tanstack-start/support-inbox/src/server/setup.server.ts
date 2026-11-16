import { createHash, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie } from '@tanstack/react-start/server'
import { currentAgent, needsSetup } from './appwrite.server'

// A fresh deploy is public, so whoever opens /setup first must prove they
// deployed it by entering the passphrase stored in this site variable.
export const SETUP_TOKEN_VARIABLE = 'MAILROOM_SETUP_TOKEN'
const SETUP_COOKIE = 'mailroom_setup'

const digest = (value: string) => createHash('sha256').update(value).digest()

export function setupTokenConfigured() {
  return Boolean(process.env[SETUP_TOKEN_VARIABLE]?.trim())
}

export function setupUnlocked() {
  const token = process.env[SETUP_TOKEN_VARIABLE]?.trim()
  const cookie = getCookie(SETUP_COOKIE)
  return Boolean(token && cookie && cookie === digest(token).toString('hex'))
}

export function unlockSetup(input: string) {
  const token = process.env[SETUP_TOKEN_VARIABLE]?.trim()
  if (!token) throw new Error(`Add a ${SETUP_TOKEN_VARIABLE} variable to this site and redeploy it first.`)
  if (!timingSafeEqual(digest(input.trim()), digest(token))) throw new Error("That doesn't match the setup token.")
  setCookie(SETUP_COOKIE, digest(token).toString('hex'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 2 * 60 * 60,
  })
}

// Before the owner exists, the setup token grants access. Afterwards only
// workspace admins can inspect or repair the project.
export async function requireProvisioningAccess() {
  const agent = await currentAgent().catch(() => null)
  if (agent?.viewer.isAdmin) return
  if (!setupUnlocked()) throw new Error('Enter the setup token first.')
  // If the key can't read teams yet, the token holder still gets in to fix the scopes.
  if (!(await needsSetup().catch(() => true))) throw new Error('This workspace is already set up. Sign in instead.')
}

export async function requireSetupAccess() {
  if (!setupUnlocked()) throw new Error('Enter the setup token first.')
  if (!(await needsSetup())) throw new Error('This workspace is already set up. Sign in instead.')
}
