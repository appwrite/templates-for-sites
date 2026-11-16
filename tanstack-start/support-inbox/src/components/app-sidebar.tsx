import { Link, useRouter } from '@tanstack/react-router'
import {
  CheckCircle2,
  ChevronsUpDown,
  Circle,
  Clock3,
  Copy,
  Inbox,
  Layers,
  LogOut,
  MessageSquareText,
  Settings,
  ShieldAlert,
  UserRound,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import type { FolderCounts, Folder, Viewer, Workspace } from '#/lib/types'
import { FOLDER_LABELS, cn } from '#/lib/utils'
import { logout } from '#/server/auth.functions'
import { Wordmark } from './brand'
import { ThemeSwitcher } from './theme'
import { Avatar } from './ui/primitives'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './ui/menu'

const FOLDER_ICONS: Record<Folder, typeof Inbox> = {
  unassigned: Inbox,
  mine: UserRound,
  open: Layers,
  pending: Clock3,
  closed: CheckCircle2,
  spam: ShieldAlert,
}

const navItem =
  'group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0'
const navActive = '!bg-accent !text-foreground font-medium'

type SetupStatus = { receiving: boolean; sending: boolean; cloud: boolean }

function SetupChecklist({ setup }: { setup: SetupStatus }) {
  const done = Number(setup.receiving) + Number(setup.sending)
  return (
    <Link
      to={setup.receiving || setup.cloud ? '/settings/email' : '/settings/api'}
      className="group grid gap-2.5 rounded-lg border bg-card p-3 transition hover:border-ring"
    >
      <span className="flex items-center justify-between text-sm font-medium">
        Finish setup
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{done}/2</span>
      </span>
      <span className="h-1 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-brand" style={{ width: `${(done / 2) * 100}%` }} />
      </span>
      <span className="grid gap-1 text-xs text-muted-foreground">
        {[
          { ok: setup.receiving, label: setup.cloud ? 'Receive email' : 'Receive tickets' },
          { ok: setup.sending, label: 'Send replies' },
        ].map((step) => (
          <span key={step.label} className="flex items-center gap-1.5">
            {step.ok ? <CheckCircle2 className="size-3.5 text-success" /> : <Circle className="size-3.5" />}
            <span className={cn(step.ok && 'line-through decoration-muted-foreground/50')}>{step.label}</span>
          </span>
        ))}
      </span>
    </Link>
  )
}

export function AppSidebar({
  viewer,
  workspace,
  counts,
  setup,
}: {
  viewer: Viewer
  workspace: Workspace
  counts: FolderCounts
  setup: SetupStatus | null
}) {
  const router = useRouter()

  async function signOut() {
    await logout()
    await router.navigate({ to: '/login' })
  }

  async function copyMailbox() {
    await navigator.clipboard.writeText(workspace.mailbox)
    toast.success('Support address copied')
  }

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center px-4">
        <Wordmark name={workspace.name} />
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pt-2 pb-4">
        <p className="eyebrow px-2.5 pb-2">Inbox</p>
        <ul className="grid gap-0.5">
          {(Object.keys(FOLDER_LABELS) as Folder[]).map((folder) => {
            const Icon = FOLDER_ICONS[folder]
            const count = folder === 'closed' ? null : counts[folder as keyof FolderCounts]
            return (
              <li key={folder}>
                <Link
                  to="/inbox/$folder"
                  params={{ folder }}
                  className={navItem}
                  activeProps={{ className: navActive }}
                >
                  <Icon />
                  <span className="flex-1 truncate">{FOLDER_LABELS[folder]}</span>
                  {count ? (
                    <span
                      className={cn(
                        'min-w-5 rounded px-1 text-center font-mono text-[11px] tabular-nums',
                        folder === 'unassigned' ? 'bg-brand/12 text-brand' : 'text-muted-foreground',
                      )}
                    >
                      {count > 999 ? '999+' : count}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>

        <p className="eyebrow mt-6 px-2.5 pb-2">Workspace</p>
        <ul className="grid gap-0.5">
          <li>
            <Link to="/customers" className={navItem} activeProps={{ className: navActive }}>
              <Users />
              Customers
            </Link>
          </li>
          <li>
            <Link to="/replies" className={navItem} activeProps={{ className: navActive }}>
              <MessageSquareText />
              Saved replies
            </Link>
          </li>
          <li>
            <Link to="/settings" className={navItem} activeProps={{ className: navActive }}>
              <Settings />
              Settings
            </Link>
          </li>
        </ul>
      </nav>

      <div className="grid gap-3 border-t border-sidebar-border p-3">
        {setup && !(setup.receiving && setup.sending) ? <SetupChecklist setup={setup} /> : null}
        {workspace.mailbox ? (
          <button
          type="button"
          onClick={copyMailbox}
          className="group grid gap-1 rounded-lg border border-dashed px-3 py-2 text-left transition hover:border-solid hover:bg-accent/60"
          title="Copy support address"
        >
          <span className="eyebrow flex items-center justify-between">
            Support address
            <Copy className="size-3 opacity-0 transition group-hover:opacity-100" />
          </span>
          <span className="truncate font-mono text-xs text-foreground">{workspace.mailbox}</span>
          </button>
        ) : null}

        <Menu>
          <MenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <Avatar name={viewer.name} email={viewer.email} size="sm" />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">{viewer.name || viewer.email}</span>
              <span className="truncate text-xs text-muted-foreground">{viewer.email}</span>
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
