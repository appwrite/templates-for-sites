import { vi } from 'vitest'

// Server code reads the request through TanStack Start; tests set it in test/request.ts.
vi.mock('@tanstack/react-start/server', async () => {
  const { request } = await import('./request')
  return {
    getRequestHeader: (name: string) => request.headers[name.toLowerCase()],
    getRequestUrl: () => new URL(request.url),
    getCookie: (name: string) => request.cookies.get(name),
    setCookie: (name: string, value: string) => void request.cookies.set(name, value),
    deleteCookie: (name: string) => void request.cookies.delete(name),
  }
})
