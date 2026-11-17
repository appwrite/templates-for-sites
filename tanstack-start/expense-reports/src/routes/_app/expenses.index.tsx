import { useEffect, useState, type FormEvent } from 'react'
import { Link, createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, FilePlus2, Plus, Receipt, Search } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { ExpenseDialog } from '#/components/expense-dialog'
import { ExpenseTable } from '#/components/expense-table'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/field'
import { Dialog, DialogContent } from '#/components/ui/menu'
import { Card, EmptyState, Spinner } from '#/components/ui/primitives'
import { STATUSES } from '#/lib/types'
import { cn, errorMessage } from '#/lib/utils'
import { listExpenses } from '#/server/expenses.functions'
import { createReport } from '#/server/reports.functions'

const appRoute = getRouteApi('/_app')

const FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'unreported', label: 'Unreported' },
  { value: 'submitted', label: 'Awaiting approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'reimbursed', label: 'Reimbursed' },
] as const

export const Route = createFileRoute('/_app/expenses/')({
  validateSearch: z.object({
    status: z.enum([...STATUSES, 'unreported']).optional(),
    scope: z.enum(['mine', 'all']).optional(),
    q: z.string().optional(),
    page: z.number().int().min(1).optional(),
  }),
  loaderDeps: ({ search }) => ({ status: search.status, scope: search.scope ?? 'mine', q: search.q, page: search.page ?? 1 }),
  loader: ({ deps }) => listExpenses({ data: deps }),
  staleTime: 10_000,
  head: () => ({ meta: [{ title: 'Expenses · Outlay' }] }),
  component: ExpensesPage,
})

function ExpensesPage() {
  const { expenses, total, page, pageSize, scope, categories } = Route.useLoaderData()
  const search = Route.useSearch()
  const { viewer, workspace } = appRoute.useLoaderData()
  const navigate = useNavigate({ from: Route.fullPath })
  const [query, setQuery] = useState(search.q ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => setSelected(new Set()), [search.status, search.scope, search.q, page])
  useEffect(() => setQuery(search.q ?? ''), [search.q])

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
    navigate({ search: { ...search, q: query.trim() || undefined, page: undefined } })
  }

  async function onCreateReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = String(new FormData(event.currentTarget).get('title'))
    setPending(true)
    try {
      const { id } = await createReport({ data: { title, expenseIds: [...selected] } })
      toast.success('Report created')
      setReporting(false)
      await navigate({ to: '/reports/$reportId', params: { reportId: id } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  const defaultTitle = `Expenses ${new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Expenses"
        meta={<span className="font-mono text-xs text-muted-foreground tabular-nums">{total}</span>}
        actions={
          <>
            <form onSubmit={onSearch} className="relative w-56 max-sm:hidden">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search merchants" className="h-8 pl-8" aria-label="Search expenses" />
            </form>
            <Button size="sm" variant="brand" onClick={() => setCreating(true)}>
              <Plus />
              New expense
            </Button>
          </>
        }
      />

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2">
        <div className="scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1">
          {FILTERS.map((filter) => (
            <Link
              key={filter.label}
              to="/expenses"
              search={{ ...search, status: filter.value, page: undefined }}
              className={cn(
                'inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground',
                search.status === filter.value && 'bg-accent font-medium text-foreground',
              )}
            >
              {filter.label}
            </Link>
          ))}
        </div>
        {viewer.canApprove ? (
          <div className="ml-auto inline-flex rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Whose expenses">
            {(['mine', 'all'] as const).map((value) => (
              <Link
                key={value}
                to="/expenses"
                search={{ ...search, scope: value === 'mine' ? undefined : 'all', page: undefined }}
                role="radio"
                aria-checked={scope === value}
                className={cn(
                  'inline-flex h-6 items-center rounded-[5px] px-2.5 text-xs text-muted-foreground transition',
                  scope === value ? 'bg-accent text-foreground shadow-xs' : 'hover:text-foreground',
                )}
              >
                {value === 'mine' ? 'Mine' : 'Everyone'}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {selected.size > 0 ? (
        <div className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-6 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="xs" variant="outline" onClick={() => setReporting(true)}>
            <FilePlus2 />
            Create report
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
        <Card className="mx-auto max-w-5xl overflow-hidden">
          {expenses.length ? (
            <ExpenseTable expenses={expenses} selected={selected} onToggle={scope === 'mine' ? toggle : undefined} showOwner={scope === 'all'} />
          ) : (
            <EmptyState
              icon={<Receipt />}
              title={search.q || search.status ? 'No matching expenses' : 'No expenses yet'}
              description={
                search.q || search.status ? (
                  'Try a different filter or merchant name.'
                ) : workspace.receiptsAddress ? (
                  <>
                    Add one here, or forward a receipt to <span className="font-mono text-xs text-foreground">{workspace.receiptsAddress}</span>.
                  </>
                ) : (
                  'Add one here with the details from your receipt.'
                )
              }
            />
          )}
        </Card>
        {total > pageSize ? (
          <div className="mx-auto mt-4 flex max-w-5xl items-center justify-end gap-2 text-sm text-muted-foreground">
            {(page - 1) * pageSize + 1}–{lastIndex} of {total}
            <Button size="icon-sm" variant="ghost" aria-label="Previous page" disabled={page <= 1} onClick={() => navigate({ search: { ...search, page: page - 1 } })}>
              <ChevronLeft />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next page" disabled={lastIndex >= total} onClick={() => navigate({ search: { ...search, page: page + 1 } })}>
              <ChevronRight />
            </Button>
          </div>
        ) : null}
      </div>

      <ExpenseDialog open={creating} onOpenChange={setCreating} categories={categories} currency={workspace.currency} />
      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent title="Create a report" description={`Bundle ${selected.size} expense${selected.size === 1 ? '' : 's'} and send them for approval.`}>
          <form onSubmit={onCreateReport} className="grid gap-4">
            <Field label="Report name" htmlFor="report-title">
              <Input id="report-title" name="title" required maxLength={255} defaultValue={defaultTitle} autoFocus />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="brand" disabled={pending}>
                {pending ? <Spinner /> : null}
                Create report
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
