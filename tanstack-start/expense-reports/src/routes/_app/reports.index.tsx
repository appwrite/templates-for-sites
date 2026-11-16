import { useState, type FormEvent } from 'react'
import { Link, createFileRoute, getRouteApi, useNavigate } from '@tanstack/react-router'
import { FileStack, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'
import { PageHeader } from '#/components/page-header'
import { ReportList } from '#/components/report-list'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/field'
import { Dialog, DialogContent } from '#/components/ui/menu'
import { Card, EmptyState, Spinner } from '#/components/ui/primitives'
import { cn, errorMessage } from '#/lib/utils'
import { createReport, listReports } from '#/server/reports.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/reports/')({
  validateSearch: z.object({ scope: z.enum(['mine', 'all']).optional() }),
  loaderDeps: ({ search }) => ({ scope: search.scope ?? 'mine' }),
  loader: ({ deps }) => listReports({ data: deps }),
  staleTime: 10_000,
  head: () => ({ meta: [{ title: 'Reports · Outlay' }] }),
  component: ReportsPage,
})

function ReportsPage() {
  const { reports, total, scope } = Route.useLoaderData()
  const { viewer } = appRoute.useLoaderData()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [pending, setPending] = useState(false)

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      const { id } = await createReport({ data: { title: String(new FormData(event.currentTarget).get('title')), expenseIds: [] } })
      setCreating(false)
      await navigate({ to: '/reports/$reportId', params: { reportId: id } })
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Reports"
        meta={<span className="font-mono text-xs text-muted-foreground tabular-nums">{total}</span>}
        actions={
          <>
            {viewer.canApprove ? (
              <div className="inline-flex rounded-md border bg-background p-0.5" role="radiogroup" aria-label="Whose reports">
                {(['mine', 'all'] as const).map((value) => (
                  <Link
                    key={value}
                    to="/reports"
                    search={{ scope: value === 'mine' ? undefined : 'all' }}
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
            <Button size="sm" variant="brand" onClick={() => setCreating(true)}>
              <Plus />
              New report
            </Button>
          </>
        }
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
        <Card className="mx-auto max-w-5xl overflow-hidden">
          {reports.length ? (
            <ReportList reports={reports} showOwner={scope === 'all'} />
          ) : (
            <EmptyState
              icon={<FileStack />}
              title="No reports yet"
              description="A report bundles expenses so an approver can sign off on them together."
              action={
                <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                  <Plus />
                  New report
                </Button>
              }
            />
          )}
        </Card>
      </div>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New report" description="Name it after the trip, project or month it covers.">
          <form onSubmit={onCreate} className="grid gap-4">
            <Field label="Report name" htmlFor="new-report-title">
              <Input id="new-report-title" name="title" required maxLength={255} placeholder="Berlin offsite, November" autoFocus />
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
