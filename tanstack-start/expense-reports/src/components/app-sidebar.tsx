import { Link, useRouter } from '@tanstack/react-router'
import { ChevronsUpDown, ClipboardCheck, Copy, FileStack, LayoutDashboard, LogOut, Receipt, Settings } from 'lucide-react'
import { toast } from 'sonner'
import type { Viewer, Workspace } from '#/lib/types'
import { ROLE_LABELS, cn } from '#/lib/utils'
import { logout } from '#/server/auth.functions'
import { Wordmark } from './brand'
import { ThemeSwitcher } from './theme'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/menu'
import { Avatar } from './ui/primitives'

const navItem =
  'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0'
const navActive = '!bg-accent !text-foreground font-medium'

function Count({ value, accent }: { value: number; accent?: boolean }) {
  if (!value) return null
  return (
    <span className={cn('min-w-5 rounded px-1 text-center font-mono text-[11px] tabular-nums', accent ? 'bg-brand/12 text-brand' : 'text-muted-foreground')}>
      {value > 99 ? '99+' : value}
    </span>
  )
}

export function AppSidebar({
  viewer,
  workspace,
  counts,
}: {
  viewer: Viewer
  workspace: Workspace
  counts: { drafts: number; review: number; reimburse: number }
}) {
  const router = useRouter()

  async function signOut() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center px-4">
        <Wordmark name={workspace.name} />
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <p className="eyebrow px-2.5 pb-2">Spend</p>
        <ul className="grid gap-0.5">
          <li>
            <Link to="/dashboard" className={navItem} activeProps={{ className: navActive }}>
              <LayoutDashboard />
              <span className="flex-1">Dashboard</span>
            </Link>
          </li>
          <li>
            <Link to="/expenses" className={navItem} activeProps={{ className: navActive }}>
              <Receipt />
              <span className="flex-1">Expenses</span>
              <Count value={counts.drafts} />
            </Link>
          </li>
          <li>
            <Link to="/reports" className={navItem} activeProps={{ className: navActive }}>
              <FileStack />
              <span className="flex-1">Reports</span>
            </Link>
          </li>
          {viewer.canApprove ? (
            <li>
              <Link to="/approvals" className={navItem} activeProps={{ className: navActive }}>
                <ClipboardCheck />
                <span className="flex-1">Approvals</span>
                <Count value={counts.review + (viewer.isAdmin ? counts.reimburse : 0)} accent />
              </Link>
            </li>
          ) : null}
        </ul>

        <p className="eyebrow mt-6 px-2.5 pb-2">Workspace</p>
        <ul className="grid gap-0.5">
          <li>
            <Link to="/settings" className={navItem} activeProps={{ className: navActive }}>
              <Settings />
              Settings
            </Link>
          </li>
        </ul>
      </nav>

      <div className="grid gap-3 border-t border-sidebar-border p-3">
        {workspace.receiptsAddress ? (
          <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(workspace.receiptsAddress!)
            toast.success('Receipts address copied', { description: 'Forward receipts here to create draft expenses.' })
          }}
          className="group grid gap-1 rounded-lg border border-dashed px-3 py-2 text-left transition hover:border-solid hover:bg-accent/60"
          title="Copy the receipts address"
        >
          <span className="eyebrow flex items-center justify-between">
            Forward receipts to
            <Copy className="size-3 opacity-0 transition group-hover:opacity-100" />
          </span>
          <span className="truncate font-mono text-xs text-foreground">{workspace.receiptsAddress}</span>
          </button>
        ) : null}

        <Menu>
          <MenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Avatar name={viewer.name} email={viewer.email} size="sm" />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{viewer.name}</span>
              <span className="truncate text-xs text-muted-foreground">{ROLE_LABELS[viewer.role]}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </MenuTrigger>
          <MenuContent side="top" align="start" className="w-60">
            <MenuLabel>Appearance</MenuLabel>
            <div className="px-2 pb-2">
              <ThemeSwitcher />
            </div>
            <MenuSeparator />
            <MenuItem onSelect={() => router.navigate({ to: '/settings' })}>
              <Settings />
              Profile and settings
            </MenuItem>
            <MenuItem onSelect={signOut}>
              <LogOut />
              Sign out
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
    </aside>
  )
}
