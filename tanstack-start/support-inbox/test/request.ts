// Stands in for the TanStack Start request that server code reads: the headers
// Appwrite Sites adds, the site's URL and the cookies. It lives on globalThis so
// tests that re-import modules with vi.resetModules() still share it.

interface FakeRequest {
  url: string
  headers: Record<string, string>
  cookies: Map<string, string>
}

const store = globalThis as typeof globalThis & { __fakeRequest?: FakeRequest }
export const request: FakeRequest = (store.__fakeRequest ??= { url: '', headers: {}, cookies: new Map() })

// Appwrite Sites sends a short-lived key, a JWT that lists the site's scopes.
export function siteKey(scopes: readonly string[]) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `ephemeral_${part({ alg: 'HS256', typ: 'JWT' })}.${part({ projectId: 'template-test', scopes })}.signature`
}

// A new request to the site, whose key carries the given scopes.
export function newRequest(scopes: readonly string[], url = 'https://support.example.com/setup') {
  request.url = url
  request.headers = { 'x-appwrite-key': siteKey(scopes), 'user-agent': 'vitest' }
  request.cookies.clear()
}
