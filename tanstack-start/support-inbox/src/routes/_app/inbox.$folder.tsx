import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, getRouteApi, notFound, useNavigate, useRouter } from '@tanstack/react-router'
import { CheckCircle2, ChevronLeft, ChevronRight, Clock3, Copy, Inbox, Search, ShieldAlert, ShieldCheck, UserRoundPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ConversationRow } from '#/components/conversation-row'
import { PageHeader } from '#/components/page-header'
import { Button, buttonVariants } from '#/components/ui/button'
import { Input } from '#/components/ui/field'
import { EmptyState } from '#/components/ui/primitives'
import { FOLDERS, type Folder } from '#/lib/types'
import { FOLDER_LABELS, errorMessage } from '#/lib/utils'
import { bulkUpdateConversations, listConversations } from '#/server/inbox.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/inbox/$folder')({
  validateSearch: z.object({
    q: z.string().optional(),
    tag: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  beforeLoad: ({ params }) => {
    if (!FOLDERS.includes(params.folder as Folder)) throw notFound()
  },
  loaderDeps: ({ search }) => ({ q: search.q, tag: search.tag, page: search.page ?? 1 }),
  loader: ({ params, deps }) => listConversations({ data: { folder: params.folder as Folder, ...deps } }),
  staleTime: 10_000,
  head: ({ params }) => ({ meta: [{ title: `${FOLDER_LABELS[params.folder as Folder] ?? 'Inbox'} · Mailroom` }] }),
  component: InboxPage,
})

const EMPTY_COPY: Record<Folder, { title: string; description: string }> = {
  unassigned: { title: 'Nothing waiting', description: 'New emails land here until someone on the team picks them up.' },
  mine: { title: "You're all caught up", description: 'Open and pending conversations assigned to you show up here.' },
  open: { title: 'Inbox zero', description: 'Every conversation has been answered. Nice work.' },
  pending: { title: 'Nothing pending', description: "Conversations waiting on the customer's reply appear here." },
  closed: { title: 'No closed conversations yet', description: 'Resolved conversations are kept here for reference.' },
  spam: { title: 'No spam', description: 'Email the spam filter flags is kept out of the inbox and parked here.' },
}

function InboxPage() {
  const { folder } = Route.useParams() as { folder: Folder }
  const search = Route.useSearch()
  const { conversations, total, page, pageSize } = Route.useLoaderData()
  const { workspace } = appRoute.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState(search.q ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => setSelected(new Set()), [folder, search.q, search.tag, page])
  useEffect(() => setQuery(search.q ?? ''), [search.q])

  const searching = Boolean(search.q || search.tag)
  const allSelected = conversations.length > 0 && selected.size === conversations.length
  const firstIndex = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastIndex = Math.min(page * pageSize, total)

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onSearch(event: FormEvent) {
    event.preventDefault()
    navigate({ search: { q: query.trim() || undefined, tag: search.tag } })
  }

  async function bulk(action: 'open' | 'pending' | 'closed' | 'spam' | 'assign-me') {
    setBusy(true)
    try {
      const { updated } = await bulkUpdateConversations({ data: { ids: [...selected], action } })
      toast.success(`Updated ${updated} conversation${updated === 1 ? '' : 's'}`)
      setSelected(new Set())
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={searching ? 'Search' : FOLDER_LABELS[folder]}
        meta={<span className="font-mono text-xs text-muted-foreground tabular-nums">{total}</span>}
        actions={
          <form onSubmit={onSearch} className="relative w-72 max-sm:w-48">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search subject, email or #ref"
              className="h-8 pl-8"
              aria-label="Search conversations"
            />
          </form>
        }
      />

      {searching ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-6 py-2 text-sm">
          <span className="text-muted-foreground">Showing results across all folders for</span>
          {search.q ? <span className="font-medium">“{search.q}”</span> : null}
          {search.tag ? <span className="rounded bg-secondary px-1.5 font-medium">tag: {search.tag}</span> : null}
          <Link to="/inbox/$folder" params={{ folder }} className={buttonVariants({ variant: 'ghost', size: 'xs', className: 'ml-auto' })}>
            <X />
            Clear
          </Link>
        </div>
      ) : null}

      {conversations.length > 0 ? (
        <div className="flex h-11 shrink-0 items-center gap-3 border-b px-6 text-sm">
          <input
            type="checkbox"
            aria-label="Select all conversations on this page"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(conversations.map((c) => c.id)))}
            className="size-4 cursor-pointer rounded accent-brand"
          />
          {selected.size > 0 ? (
            <>
              <span className="font-medium">{selected.size} selected</span>
              <div className="ml-2 flex flex-wrap items-center gap-1.5">
                <Button size="xs" variant="outline" disabled={busy} onClick={() => bulk('assign-me')}>
                  <UserRoundPlus />
                  Assign to me
                </Button>
                {folder === 'pending' || folder === 'closed' || folder === 'spam' ? (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => bulk('open')}>
                    {folder === 'spam' ? <ShieldCheck /> : <Inbox />}
                    {folder === 'spam' ? 'Not spam' : 'Reopen'}
                  </Button>
                ) : null}
                {folder !== 'pending' && folder !== 'spam' ? (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => bulk('pending')}>
                    <Clock3 />
                    Pending
                  </Button>
                ) : null}
                {folder !== 'closed' ? (
                  <Button size="xs" variant="outline" disabled={busy} onClick={() => bulk('closed')}>
                    <CheckCircle2 />
                    Close
                  </Button>
                ) : null}
                {folder !== 'spam' ? (
                  <Button size="xs" variant="ghost" disabled={busy} onClick={() => bulk('spam')}>
                    <ShieldAlert />
                    Spam
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">
              {firstIndex}–{lastIndex} of {total}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Newer conversations"
              disabled={page <= 1}
              onClick={() => navigate({ search: { ...search, page: page - 1 > 1 ? page - 1 : undefined } })}
            >
              <ChevronLeft />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Older conversations"
              disabled={lastIndex >= total}
              onClick={() => navigate({ search: { ...search, page: page + 1 } })}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {conversations.length > 0 ? (
          <ul>
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={selected.has(conversation.id)}
                onToggle={toggle}
                showStatus={searching || folder === 'mine'}
              />
            ))}
          </ul>
        ) : searching ? (
          <EmptyState icon={<Search />} title="No matches" description="Try a different subject keyword, a customer email, or a #ref number." />
        ) : (
          <EmptyState
            icon={<Inbox />}
            title={EMPTY_COPY[folder].title}
            description={
              <>
                {EMPTY_COPY[folder].description}
                {folder === 'unassigned' || folder === 'open' ? (
                  <span className="mt-3 block">
                    Customers can write to{' '}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline decoration-dashed underline-offset-4"
                      onClick={async () => {
                        await navigator.clipboard.writeText(workspace.mailbox)
                        toast.success('Support address copied')
                      }}
                    >
                      {workspace.mailbox}
                      <Copy className="size-3" />
                    </button>
                  </span>
                ) : null}
              </>
            }
          />
        )}
      </div>
    </div>
  )
}
