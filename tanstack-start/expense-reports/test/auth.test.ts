import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { grantedScopes, receiptsAddress } from '#/server/appwrite.server'
import {
  createSessionFromCode,
  INVALID_CODE,
  INVALID_LOGIN,
  PASSWORDS_DISABLED,
  passwordSession,
  passwordsEnabled,
  sendCode,
  workspaceAuthMethod,
} from '#/server/auth.server'
import { requireSetupAccess, setupUnlocked, unlockSetup } from '#/server/setup.server'
import { ApiError, Reply, startFakeAppwrite, type FakeAppwrite } from './fake-appwrite'
import { newRequest, request } from './request'

const SESSION = { $id: 'session-1', userId: 'user-1', expire: '2030-01-01T00:00:00.000+00:00' }
const USER = { $id: 'user-1', email: 'jane@example.com', prefs: {} }

let fake: FakeAppwrite
beforeAll(async () => {
  fake = await startFakeAppwrite()
})
afterAll(() => fake.close())
beforeEach(() => {
  fake.reset()
  newRequest(['users.read', 'users.write', 'teams.read', 'teams.write'], 'https://expenses.example.com/login')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

// Requests made like a browser's: no key, the site's origin, the project header.
function expectGuestCall(path: string) {
  const [call] = fake.callsTo('POST', path)
  expect(call, path).toBeDefined()
  expect(call.headers['x-appwrite-key']).toBeUndefined()
  expect(call.headers.origin).toBe('https://expenses.example.com')
  expect(call.headers['x-appwrite-project']).toBe('template-test')
  return call
}

describe('the site key', () => {
  it('reads the scopes from the key Appwrite Sites sends', () => {
    newRequest(['rows.read', 'teams.read'])
    expect(grantedScopes()).toEqual(['rows.read', 'teams.read'])
  })

  it('returns null for keys it cannot read', () => {
    for (const key of ['standard_0123456789abcdef', 'ephemeral_header.not-json.signature', '']) {
      request.headers['x-appwrite-key'] = key
      expect(grantedScopes(), key).toBeNull()
    }
  })
})

describe('the receipts address', () => {
  async function addressWith(env: Record<string, string>) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    vi.resetModules()
    return (await import('#/server/appwrite.server')).receiptsAddress()
  }

  it('is on the function’s built-in appwrite.email domain', () => {
    expect(receiptsAddress()).toBe('receipts@receipts-template-test.appwrite.email')
  })

  it('is missing when the IDs cannot form a hostname, or off Cloud', async () => {
    expect(await addressWith({ APPWRITE_SITE_PROJECT_ID: 'expenses-' })).toBeNull()
    expect(await addressWith({ APPWRITE_SITE_PROJECT_ID: 'p'.repeat(55) })).toBeNull()
    expect(await addressWith({ APPWRITE_SITE_PROJECT_ID: 'template-test', OUTLAY_RECEIPTS_FUNCTION_ID: 'receipts.mail' })).toBeNull()
    expect(await addressWith({ OUTLAY_RECEIPTS_FUNCTION_ID: '', APPWRITE_SITE_API_ENDPOINT: 'https://appwrite.example.com/v1' })).toBeNull()
  })
})

describe('password sign-in', () => {
  it('signs in as a guest and reads the session from the fallback cookie header', async () => {
    fake.on('POST', '/account/sessions/email', () => new Reply(201, SESSION, { 'x-fallback-cookies': JSON.stringify({ 'a_session_template-test': 'secret-1' }) }))

    expect(await passwordSession('jane@example.com', 'hunter2-hunter2')).toMatchObject({ userId: 'user-1', secret: 'secret-1' })
    const call = expectGuestCall('/account/sessions/email')
    expect(call.body).toEqual({ email: 'jane@example.com', password: 'hunter2-hunter2' })
    expect(call.headers['x-forwarded-user-agent']).toBe('vitest')
  })

  it('reads the session from Set-Cookie', async () => {
    fake.on('POST', '/account/sessions/email', () =>
      new Reply(201, SESSION, { 'set-cookie': ['a_session_template-test_legacy=old; path=/', 'a_session_template-test=secret%202; path=/; httponly'] }),
    )
    expect((await passwordSession('jane@example.com', 'hunter2-hunter2')).secret).toBe('secret 2')
  })

  it('fails when Appwrite returns no session', async () => {
    fake.on('POST', '/account/sessions/email', () => new Reply(201, SESSION))
    await expect(passwordSession('jane@example.com', 'hunter2-hunter2')).rejects.toThrow('didn’t return a session')
  })

  it('explains wrong passwords, Appwrite rate limits and disabled passwords', async () => {
    await expect(passwordSession('jane@example.com', 'wrong')).rejects.toThrow(INVALID_LOGIN)

    fake.on('POST', '/account/sessions/email', () => {
      throw new ApiError(429, 'Rate limit for the current endpoint has been exceeded.', 'general_rate_limit_exceeded')
    })
    await expect(passwordSession('jane@example.com', 'wrong')).rejects.toThrow('Too many attempts')

    fake.on('POST', '/account/sessions/email', () => {
      throw new ApiError(501, 'Email / Password authentication is disabled for this project', 'user_auth_method_unsupported')
    })
    await expect(passwordSession('jane@example.com', 'wrong')).rejects.toThrow(PASSWORDS_DISABLED)
  })

  it('tells whether the project allows passwords', async () => {
    expect(await passwordsEnabled('jane@example.com')).toBe(true)
    fake.on('POST', '/account/sessions/email', () => {
      throw new ApiError(501, 'Email / Password authentication is disabled for this project', 'user_auth_method_unsupported')
    })
    expect(await passwordsEnabled('jane@example.com')).toBe(false)
  })
})

describe('email codes', () => {
  beforeEach(() => {
    fake.state.users.set(USER.$id, { ...structuredClone(USER) })
  })

  it('sends a code as a guest, at most once a minute', async () => {
    await sendCode(structuredClone(USER) as never)
    expect(expectGuestCall('/account/tokens/email').body).toEqual({ userId: 'user-1', email: 'jane@example.com' })
    expect(request.cookies.get('outlay_otp')).toBe('user-1')
    expect(fake.state.users.get(USER.$id)?.prefs.otpSentAt).toEqual(expect.any(Number))

    await expect(sendCode(structuredClone(USER) as never)).rejects.toThrow('A code was just sent')
    expect(fake.callsTo('POST', '/account/tokens/email')).toHaveLength(1)
  })

  it('explains a missing SMTP server', async () => {
    fake.on('POST', '/account/tokens/email', () => {
      throw new ApiError(503, 'SMTP disabled', 'general_smtp_disabled')
    })
    await expect(sendCode(structuredClone(USER) as never)).rejects.toThrow("SMTP isn't configured")
  })

  it('signs in with the code for the person who asked for it', async () => {
    await expect(createSessionFromCode('123456')).rejects.toThrow(INVALID_CODE)
    expect(fake.calls).toHaveLength(0)

    request.cookies.set('outlay_otp', 'user-1')
    await expect(createSessionFromCode('000000')).rejects.toThrow(INVALID_CODE)

    fake.on('POST', '/account/sessions/token', () => new Reply(201, SESSION, { 'x-fallback-cookies': JSON.stringify({ 'a_session_template-test': 'secret-3' }) }))
    expect((await createSessionFromCode('123456')).secret).toBe('secret-3')
    expect(expectGuestCall('/account/sessions/token').body).toEqual({ userId: 'user-1', secret: '000000' })
    expect(fake.callsTo('POST', '/account/sessions/token')[1].body).toEqual({ userId: 'user-1', secret: '123456' })
  })

  it('passes on Appwrite’s rate limit', async () => {
    request.cookies.set('outlay_otp', 'user-1')
    fake.on('POST', '/account/sessions/token', () => {
      throw new ApiError(429, 'Rate limit for the current endpoint has been exceeded.', 'general_rate_limit_exceeded')
    })
    await expect(createSessionFromCode('123456')).rejects.toThrow('Too many attempts')
  })
})

describe('the sign-in method', () => {
  it('comes from the workspace, with codes for workspaces from before the setting', async () => {
    fake.state.teams.set('workspace', { $id: 'workspace', name: 'Outlay workspace', prefs: { authMethod: 'password' }, memberships: [] })
    expect(await workspaceAuthMethod()).toBe('password')
    fake.state.teams.get('workspace')!.prefs = {}
    expect(await workspaceAuthMethod()).toBe('otp')
  })

  it('defaults to codes on Cloud before setup', async () => {
    expect(await workspaceAuthMethod()).toBe('otp')
  })
})

describe('the setup token', () => {
  const token = 'correct horse battery staple'

  it('unlocks setup with the right token and stores only its hash', () => {
    expect(() => unlockSetup('wrong token')).toThrow('doesn\'t match')
    expect(setupUnlocked()).toBe(false)

    unlockSetup(`  ${token} `)
    const cookie = request.cookies.get('outlay_setup')
    expect(cookie).toBe(createHash('sha256').update(token).digest('hex'))
    expect(setupUnlocked()).toBe(true)

    request.cookies.set('outlay_setup', `${cookie?.slice(0, -1)}0`)
    expect(setupUnlocked()).toBe(false)
  })

  it('stays locked until the variable is set', () => {
    vi.stubEnv('OUTLAY_SETUP_TOKEN', ' ')
    expect(() => unlockSetup('')).toThrow('Add a OUTLAY_SETUP_TOKEN variable')
    expect(setupUnlocked()).toBe(false)
  })

  it('only lets the token holder in before the workspace has an owner', async () => {
    await expect(requireSetupAccess()).rejects.toThrow('Enter the setup token first.')
    unlockSetup(token)
    await expect(requireSetupAccess()).resolves.toBeUndefined()

    fake.state.teams.set('workspace', { $id: 'workspace', name: 'Outlay workspace', prefs: {}, memberships: [] })
    await expect(requireSetupAccess()).resolves.toBeUndefined()

    fake.state.teams.get('workspace')!.memberships.push({ $id: 'membership-1', userId: 'user-1', roles: ['owner'] })
    await expect(requireSetupAccess()).rejects.toThrow('already set up')
  })
})
