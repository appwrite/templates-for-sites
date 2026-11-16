import { useState, type ReactNode } from 'react'
import { Link, createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, FileStack, Mail, Pencil, Receipt, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ExpenseDialog } from '#/components/expense-dialog'
import { ReceiptView } from '#/components/receipt-view'
import { StatusBadge } from '#/components/status'
import { Timeline } from '#/components/timeline'
import { Button } from '#/components/ui/button'
import { Card, EmptyState } from '#/components/ui/primitives'
import { formatMoney } from '#/lib/money'
import { errorMessage, formatDate } from '#/lib/utils'
import { deleteExpense, getExpense } from '#/server/expenses.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/expenses/$expenseId')({
  loader: ({ params }) => getExpense({ data: { id: params.expenseId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.expense.merchant} · Outlay` : 'Expense · Outlay' }] }),
  notFoundComponent: () => <EmptyState icon={<Receipt />} title="Expense not found" description="It may have been deleted, or it belongs to someone else." />,
  component: ExpensePage,
})

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 px-5 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function ExpensePage() {
  const { expense, events, categories, report, editable } = Route.useLoaderData()
  const { workspace } = appRoute.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState(false)

  async function onDelete() {
    if (!window.confirm(`Delete the ${expense.merchant} expense?`)) return
    try {
      await deleteExpense({ data: { id: expense.id } })
      toast.success('Expense deleted')
      await router.navigate({ to: '/expenses' })
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-xl font-medium tracking-tight">{expense.merchant}</h1>
              <StatusBadge status={expense.status} />
            </div>
            <p className="mt-0.5 font-display text-2xl font-medium tracking-tight tabular-nums">
              {expense.amount ? formatMoney(expense.amount, expense.currency) : <span className="text-warning">Amount needed</span>}
            </p>
          </div>
          {editable ? (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              Edit
            </Button>
          ) : null}
          {editable && !expense.reportId ? (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 />
              Delete
            </Button>
          ) : null}
        </div>

        {expense.overLimit ? (
          <p className="mb-6 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
            <AlertTriangle className="size-4 shrink-0" />
            This expense is over the {expense.categoryName} limit. Approvers will see this flag.
          </p>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <Card className="p-5">
            <h2 className="eyebrow mb-3">Receipt</h2>
            <ReceiptView expense={expense} />
          </Card>

          <div className="grid h-fit gap-6">
            <Card>
              <dl className="divide-y">
                <Detail label="Date">{formatDate(expense.spentAt)}</Detail>
                <Detail label="Category">{expense.categoryName || <span className="text-muted-foreground">Uncategorized</span>}</Detail>
                <Detail label="Spent by">{expense.ownerName}</Detail>
                <Detail label="Report">
                  {report ? (
                    <Link to="/reports/$reportId" params={{ reportId: report.id }} className="inline-flex items-center gap-1.5 hover:underline">
                      <FileStack className="size-3.5 text-muted-foreground" />
                      {report.title}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Not on a report yet</span>
                  )}
                </Detail>
                {expense.description ? <Detail label="Description">{expense.description}</Detail> : null}
                {expense.source === 'email' ? (
                  <Detail label="Source">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="size-3.5 text-muted-foreground" />
                      Forwarded email
                    </span>
                    {expense.emailSubject ? <span className="block truncate text-xs text-muted-foreground">{expense.emailSubject}</span> : null}
                  </Detail>
                ) : null}
              </dl>
            </Card>
            <Card className="p-5">
              <h2 className="eyebrow mb-4">History</h2>
              <Timeline events={events} />
            </Card>
          </div>
        </div>
      </div>
      <ExpenseDialog open={editing} onOpenChange={setEditing} expense={expense} categories={categories} currency={workspace.currency} />
    </div>
  )
}
