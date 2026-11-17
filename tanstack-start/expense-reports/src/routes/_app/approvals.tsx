import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { ClipboardCheck, Undo2 } from 'lucide-react'
import { PageHeader } from '#/components/page-header'
import { ReportList } from '#/components/report-list'
import { Card, EmptyState } from '#/components/ui/primitives'
import { listReports } from '#/server/reports.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/approvals')({
  loader: async () => {
    const [review, reimburse] = await Promise.all([listReports({ data: { scope: 'review' } }), listReports({ data: { scope: 'reimburse' } })])
    return { review: review.reports, reimburse: reimburse.reports }
  },
  staleTime: 10_000,
  head: () => ({ meta: [{ title: 'Approvals · Outlay' }] }),
  component: ApprovalsPage,
})

function ApprovalsPage() {
  const { review, reimburse } = Route.useLoaderData()
  const { viewer } = appRoute.useLoaderData()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Approvals" />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-6">
          <Card className="overflow-hidden">
            <div className="flex items-baseline justify-between border-b px-5 py-3">
              <h2 className="font-display text-base font-medium tracking-tight">Awaiting approval</h2>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{review.length}</span>
            </div>
            {review.length ? (
              <ReportList reports={review} showOwner />
            ) : (
              <EmptyState icon={<ClipboardCheck />} title="Nothing to review" description="Reports submitted by your team appear here." />
            )}
          </Card>

          {viewer.isAdmin ? (
            <Card className="overflow-hidden">
              <div className="flex items-baseline justify-between border-b px-5 py-3">
                <h2 className="font-display text-base font-medium tracking-tight">Ready to reimburse</h2>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{reimburse.length}</span>
              </div>
              {reimburse.length ? (
                <ReportList reports={reimburse} showOwner />
              ) : (
                <EmptyState icon={<Undo2 />} title="All paid up" description="Approved reports wait here until you mark them reimbursed." />
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
