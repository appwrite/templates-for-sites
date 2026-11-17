import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { RouteError } from './components/route-error'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Preloaded data stays fresh briefly so hovering links doesn't spend database reads.
    defaultPreloadStaleTime: 30_000,
    defaultErrorComponent: RouteError,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
