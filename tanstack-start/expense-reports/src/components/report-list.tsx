import { Link } from '@tanstack/react-router'
import { FileStack } from 'lucide-react'
import { formatTotals } from '#/lib/money'
import type { Report } from '#/lib/types'
import { timeAgo } from '#/lib/utils'
import { StatusBadge } from './status'
import { Avatar } from './ui/primitives'

export function ReportList({ reports, showOwner }: { reports: Report[]; showOwner?: boolean }) {
  return (
    <ul className="divide-y">
      {reports.map((report) => (
        <li key={report.id} className="relative flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-accent/50">
          <Link
            to="/reports/$reportId"
            params={{ reportId: report.id }}
            preload={false}
            aria-label={report.title}
            className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
          {showOwner ? (
            <Avatar name={report.ownerName} email={report.ownerId} />
          ) : (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
              <FileStack className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{report.title}</p>
            <p className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
              {[showOwner ? report.ownerName : null, `${report.expenseCount} expense${report.expenseCount === 1 ? '' : 's'}`, report.submittedAt ? `submitted ${timeAgo(report.submittedAt)}` : `created ${timeAgo(report.createdAt)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <span className="max-sm:hidden">
            <StatusBadge status={report.status} />
          </span>
          <span className="text-right text-sm font-medium tabular-nums">{formatTotals(report.totals)}</span>
        </li>
      ))}
    </ul>
  )
}
