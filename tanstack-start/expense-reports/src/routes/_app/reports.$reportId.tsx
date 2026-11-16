import { useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, BadgeCheck, Download, FileStack, ListPlus, Send, Trash2, Undo2, XCircle } from 'lucide-react'
import { ExpenseTable } from '#/components/expense-table'
import { StatusBadge } from '#/components/status'
import { Timeline } from '#/components/timeline'
import { Button, buttonVariants } from '#/components/ui/button'
import { Field, Textarea } from '#/components/ui/field'
import { Dialog, DialogContent } from '#/components/ui/menu'
import { Card, EmptyState, Spinner } from '#/components/ui/primitives'
import { formatMoney, formatTotals } from '#/lib/money'
import { useAction } from '#/lib/use-action'
import { formatDate } from '#/lib/utils'
import {
  commentOnReport,
  decideReport,
  deleteReport,
  getReport,
  reimburseReport,
  submitReport,
  updateReportExpenses,
} from '#/server/reports.functions'

export const Route = createFileRoute('/_app/reports/$reportId')({
  loader: ({ params }) => getReport({ data: { id: params.reportId } }),
  head: ({ loaderData }) => ({ meta: [{ title: loaderData ? `${loaderData.report.title} · Outlay` : 'Report · Outlay' }] }),
  notFoundComponent: () => <EmptyState icon={<FileStack />} title="Report not found" description="It may have been deleted, or it belongs to someone else." />,
  component: ReportPage,
})

function ReportPage() {
  const { report, expenses, events, available, permissions } = Route.useLoaderData()
  const router = useRouter()
  const action = useAction()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [comment, setComment] = useState('')

  const flagged = expenses.filter((expense) => expense.overLimit).length
  const missingReceipts = expenses.filter((expense) => !expense.receipt && expense.source !== 'email').length

  async function onDecide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = String(new FormData(event.currentTarget).get('comment') ?? '')
    if (!deciding) return
    const ok = await action.run(
      () => decideReport({ data: { id: report.id, decision: deciding, comment: text } }),
      deciding === 'approved' ? 'Report approved' : 'Report sent back',
    )
    if (ok) setDeciding(null)
  }

  async function onComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!comment.trim()) return
    if (await action.run(() => commentOnReport({ data: { id: report.id, comment } }), 'Comment added')) setComment('')
  }

  async function onDelete() {
    if (!window.confirm(`Delete “${report.title}”? Its expenses go back to your unreported drafts.`)) return
    if (await action.run(() => deleteReport({ data: { id: report.id } }), 'Report deleted')) await router.navigate({ to: '/reports' })
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-start gap-3">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-display text-xl font-medium tracking-tight">{report.title}</h1>
              <StatusBadge status={report.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {report.ownerName} · {report.expenseCount} expense{report.expenseCount === 1 ? '' : 's'}
              {report.submittedAt ? ` · submitted ${formatDate(report.submittedAt)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/reports/${report.id}/csv`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Download />
              CSV
            </a>
            {permissions.edit ? (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            ) : null}
            {permissions.submit ? (
              <Button size="sm" variant="brand" disabled={action.pending} onClick={() => action.run(() => submitReport({ data: { id: report.id } }), 'Submitted for approval')}>
                <Send />
                {report.status === 'rejected' ? 'Resubmit' : 'Submit for approval'}
              </Button>
            ) : null}
            {permissions.decide ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDeciding('rejected')}>
                  <XCircle />
                  Reject
                </Button>
                <Button size="sm" variant="brand" onClick={() => setDeciding('approved')}>
                  <BadgeCheck />
                  Approve
                </Button>
              </>
            ) : null}
            {permissions.reimburse ? (
              <Button
                size="sm"
                variant="brand"
                disabled={action.pending}
                onClick={() => {
                  if (window.confirm(`Mark ${formatTotals(report.totals)} as paid to ${report.ownerName}?`)) {
                    void action.run(() => reimburseReport({ data: { id: report.id } }), 'Marked as reimbursed')
                  }
                }}
              >
                <Undo2 />
                Mark reimbursed
              </Button>
            ) : null}
          </div>
        </div>

        {report.status === 'rejected' && report.comment ? (
          <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-medium text-destructive">Sent back by {report.approverName}</p>
            <p className="mt-1 whitespace-pre-line">{report.comment}</p>
          </div>
        ) : null}
        {permissions.decide && (flagged || missingReceipts) ? (
          <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {[flagged ? `${flagged} over a category limit` : null, missingReceipts ? `${missingReceipts} without a receipt` : null].filter(Boolean).join(' · ')}
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card className="h-fit overflow-hidden">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-display text-base font-medium tracking-tight">Expenses</h2>
              {permissions.edit ? (
                <Button size="xs" variant="outline" onClick={() => setAdding(true)} disabled={available.length === 0} title={available.length ? undefined : 'No unreported drafts to add'}>
                  <ListPlus />
                  Add expenses
                </Button>
              ) : null}
            </div>
            {expenses.length ? (
              <>
                <ExpenseTable
                  expenses={expenses}
                  showStatus={false}
                  onRemove={
                    permissions.edit
                      ? (expense) => action.run(() => updateReportExpenses({ data: { id: report.id, remove: [expense.id], add: [] } }), 'Removed from report')
                      : undefined
                  }
                />
                <div className="flex items-center justify-between border-t bg-muted/40 px-5 py-3 text-sm">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-display text-base font-medium tabular-nums">{formatTotals(report.totals)}</span>
                </div>
              </>
            ) : (
              <EmptyState
                icon={<ListPlus />}
                title="This report is empty"
                description="Add unreported expenses, then submit the report for approval."
                action={
                  permissions.edit && available.length ? (
                    <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                      <ListPlus />
                      Add expenses
                    </Button>
                  ) : undefined
                }
              />
            )}
          </Card>

          <div className="grid h-fit gap-6">
            <Card className="p-5">
              <h2 className="eyebrow mb-4">Activity</h2>
              <Timeline events={events} />
              <form onSubmit={onComment} className="mt-5 grid gap-2">
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} placeholder="Leave a comment" aria-label="Comment" />
                <div className="flex justify-end">
                  <Button type="submit" size="xs" variant="outline" disabled={!comment.trim() || action.pending}>
                    Comment
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={adding} onOpenChange={(open) => (setAdding(open), setPicked(new Set()))}>
        <DialogContent title="Add expenses" description="Your unreported drafts." className="max-w-xl">
          <ul className="scrollbar-thin -mx-2 max-h-80 overflow-y-auto">
            {available.map((expense) => (
              <li key={expense.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                  <input
                    type="checkbox"
                    className="size-4 accent-brand"
                    checked={picked.has(expense.id)}
                    onChange={() =>
                      setPicked((current) => {
                        const next = new Set(current)
                        if (next.has(expense.id)) next.delete(expense.id)
                        else next.add(expense.id)
                        return next
                      })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{expense.merchant}</span>
                    <span className="block text-xs text-muted-foreground">{formatDate(expense.spentAt)}</span>
                  </span>
                  <span className="text-sm tabular-nums">{formatMoney(expense.amount, expense.currency)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="brand"
              disabled={picked.size === 0 || action.pending}
              onClick={async () => {
                if (await action.run(() => updateReportExpenses({ data: { id: report.id, add: [...picked], remove: [] } }), 'Added to report')) {
                  setAdding(false)
                  setPicked(new Set())
                }
              }}
            >
              {action.pending ? <Spinner /> : null}
              Add {picked.size || ''} expense{picked.size === 1 ? '' : 's'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent
          title={deciding === 'approved' ? `Approve ${formatTotals(report.totals)}?` : 'Send this report back'}
          description={deciding === 'approved' ? `${report.ownerName} will be notified, and an admin can then reimburse it.` : 'Explain what needs to change. The submitter can edit and resubmit.'}
        >
          <form onSubmit={onDecide} className="grid gap-4">
            <Field label={deciding === 'approved' ? 'Comment (optional)' : 'Reason'} htmlFor="decision-comment">
              <Textarea id="decision-comment" name="comment" rows={3} required={deciding === 'rejected'} maxLength={2000} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDeciding(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" variant={deciding === 'approved' ? 'brand' : 'destructive'} disabled={action.pending}>
                {action.pending ? <Spinner /> : null}
                {deciding === 'approved' ? 'Approve' : 'Reject'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
