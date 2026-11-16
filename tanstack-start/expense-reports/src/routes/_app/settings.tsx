import { Link, Outlet, createFileRoute, getRouteApi } from '@tanstack/react-router'
import { Mail, Server, SlidersHorizontal, Tags, Users } from 'lucide-react'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/settings')({
  component: SettingsLayout,
})

const tab =
  'relative inline-flex h-10 shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-4'
const activeTab =
  '!text-foreground font-medium after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand'

function SettingsLayout() {
  const { viewer } = appRoute.useLoaderData()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-6">
        <h1 className="pt-4 pb-1 font-display text-lg font-medium tracking-tight">Settings</h1>
        <nav className="scrollbar-thin flex gap-6 overflow-x-auto" aria-label="Settings sections">
          <Link to="/settings" activeOptions={{ exact: true }} className={tab} activeProps={{ className: activeTab }}>
            <SlidersHorizontal />
            General
          </Link>
          <Link to="/settings/categories" className={tab} activeProps={{ className: activeTab }}>
            <Tags />
            Categories
          </Link>
          <Link to="/settings/receipts" className={tab} activeProps={{ className: activeTab }}>
            <Mail />
            Receipts by email
          </Link>
          <Link to="/settings/team" className={tab} activeProps={{ className: activeTab }}>
            <Users />
            Team
          </Link>
          {viewer.isAdmin ? (
            <Link to="/settings/system" className={tab} activeProps={{ className: activeTab }}>
              <Server />
              System
            </Link>
          ) : null}
        </nav>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-6 px-6 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
