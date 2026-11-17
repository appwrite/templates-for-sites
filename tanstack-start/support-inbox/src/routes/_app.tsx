import { useEffect, useState } from 'react'
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Menu as MenuIcon } from 'lucide-react'
import { AppSidebar } from '#/components/app-sidebar'
import { Wordmark } from '#/components/brand'
import { RealtimeBridge } from '#/components/realtime-bridge'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { getShell } from '#/server/inbox.functions'

export const Route = createFileRoute('/_app')({
  loader: () => getShell(),
  staleTime: 30_000,
  component: AppLayout,
})

function AppLayout() {
  const { viewer, workspace, counts, setup } = Route.useLoaderData()
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="flex h-dvh overflow-hidden">
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <AppSidebar viewer={viewer} workspace={workspace} counts={counts} setup={setup} />
      </div>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:hidden">
          <Button variant="ghost" size="icon-sm" aria-label="Open navigation" onClick={() => setOpen(true)}>
            <MenuIcon />
          </Button>
          <Wordmark name={workspace.name} />
        </header>
        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <RealtimeBridge />
    </div>
  )
}
