import { useState, type ReactNode } from 'react'
import { Link, createFileRoute, getRouteApi } from '@tanstack/react-router'
import { ArrowDownRight, ArrowUpRight, Plus, Receipt } from 'lucide-react'
import { CategoryChart, MonthChart } from '#/components/charts'
import { ExpenseDialog } from '#/components/expense-dialog'
import { ExpenseTable } from '#/components/expense-table'
import { PageHeader } from '#/components/page-header'
import { Button, buttonVariants } from '#/components/ui/button'
import { Card, EmptyState } from '#/components/ui/primitives'
import { formatMoney } from '#/lib/money'
import { cn } from '#/lib/utils'
import { getDashboard } from '#/server/dashboard.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/dashboard')({
  loader: () => getDashboard(),
  staleTime: 15_000,
  head: () => ({ meta: [{ title: 'Dashboard · Outlay' }] }),
  component: Dashboard,
})

function Stat({ label, value, detail, to }: { label: string; value: ReactNode; detail?: ReactNode; to?: string }) {
  const body = (
    <>
      <p className="eyebrow">{label}</p>
      <p className="mt-2 font-display text-2xl font-medium tracking-tight tabular-nums">{value}</p>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </>
  )
  return to ? (
    <Link to={to} className="rounded-xl border bg-card px-5 py-4 transition hover:border-ring hover:bg-accent/30">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border bg-card px-5 py-4">{body}</div>
  )
}

function Dashboard() {
  const data = Route.useLoaderData()
  const { counts, workspace } = appRoute.useLoaderData()
  const [creating, setCreating] = useState(false)
  const { currency, stats } = data
  const change = stats.lastMonth ? Math.round(((stats.thisMonth - stats.lastMonth) / stats.lastMonth) * 100) : null
  const hasSpend = data.byMonth.some((point) => point.amount > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Dashboard"
        meta={<span className="text-xs text-muted-foreground">{data.scopeLabel}</span>}
        actions={
          <Button size="sm" variant="brand" onClick={() => setCreating(true)}>
            <Plus />
            New expense
          </Button>
        }
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="This month"
              value={formatMoney(stats.thisMonth, currency)}
              detail={
                change === null ? (
                  'No spend last month'
                ) : (
                  <span className={cn('inline-flex items-center gap-0.5', change > 0 ? 'text-warning' : 'text-success')}>
                    {change > 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                    {Math.abs(change)}% vs last month
                  </span>
                )
              }
            />
            <Stat
              label="Awaiting approval"
              value={stats.pending}
              detail={data.viewer.canApprove ? 'Reports waiting for a decision' : 'Your submitted reports'}
              to={data.viewer.canApprove ? '/approvals' : '/reports'}
            />
            <Stat label="Owed to you" value={formatMoney(stats.owed, currency)} detail="Approved, not yet reimbursed" to="/reports" />
            <Stat label="Unreported drafts" value={counts.drafts} detail="Add them to a report to get paid" to="/expenses" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="p-5 lg:col-span-3">
              <div className="mb-5 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-base font-medium tracking-tight">Spend per month</h2>
                <span className="text-xs text-muted-foreground">Last 6 months · {currency}</span>
              </div>
              {hasSpend ? (
                <MonthChart data={data.byMonth} currency={currency} />
              ) : (
                <EmptyState className="py-10" icon={<Receipt />} title="No spend yet" description="Expenses you add show up here by month." />
              )}
            </Card>
            <Card className="p-5 lg:col-span-2">
              <div className="mb-5 flex items-baseline justify-between gap-3">
                <h2 className="font-display text-base font-medium tracking-tight">By category</h2>
                <span className="text-xs text-muted-foreground">Last 6 months</span>
              </div>
              {data.byCategory.length ? (
                <CategoryChart data={data.byCategory} currency={currency} />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">Categorize expenses to see where money goes.</p>
              )}
            </Card>
          </div>
          {data.otherCurrency > 0 ? (
            <p className="-mt-3 text-xs text-muted-foreground">
              {data.otherCurrency} expense{data.otherCurrency === 1 ? '' : 's'} in other currencies {data.otherCurrency === 1 ? 'is' : 'are'} not included in
              the {currency} charts.
            </p>
          ) : null}

          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-display text-base font-medium tracking-tight">Your recent expenses</h2>
              <Link to="/expenses" className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
                View all
              </Link>
            </div>
            {data.recent.length ? (
              <ExpenseTable expenses={data.recent} />
            ) : (
              <EmptyState
                icon={<Receipt />}
                title="Add your first expense"
                description={
                  workspace.receiptsAddress ? (
                    <>
                      Snap a receipt, or forward one to <span className="font-mono text-xs text-foreground">{workspace.receiptsAddress}</span>.
                    </>
                  ) : (
                    'Snap a receipt or add the details by hand.'
                  )
                }
                action={
                  <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                    <Plus />
                    New expense
                  </Button>
                }
              />
            )}
          </Card>
        </div>
      </div>
      <ExpenseDialog open={creating} onOpenChange={setCreating} categories={data.categories} currency={currency} />
    </div>
  )
}
