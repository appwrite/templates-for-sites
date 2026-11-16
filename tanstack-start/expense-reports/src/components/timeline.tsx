import { BadgeCheck, CircleDashed, Clock3, MessageSquare, Pencil, Undo2, XCircle } from 'lucide-react'
import type { AuditEvent } from '#/lib/types'
import { cn, formatDateTime, timeAgo } from '#/lib/utils'

const ACTIONS: Record<string, { label: string; icon: typeof Clock3; tone: string }> = {
  created: { label: 'created this', icon: CircleDashed, tone: 'text-muted-foreground' },
  updated: { label: 'edited this', icon: Pencil, tone: 'text-muted-foreground' },
  submitted: { label: 'submitted for approval', icon: Clock3, tone: 'text-warning' },
  approved: { label: 'approved', icon: BadgeCheck, tone: 'text-info' },
  rejected: { label: 'rejected', icon: XCircle, tone: 'text-destructive' },
  reimbursed: { label: 'marked as reimbursed', icon: Undo2, tone: 'text-success' },
  commented: { label: 'commented', icon: MessageSquare, tone: 'text-muted-foreground' },
}

export function Timeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>
  return (
    <ol className="relative grid gap-4 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-border">
      {events.map((event) => {
        const action = ACTIONS[event.action] ?? { label: event.action, icon: CircleDashed, tone: 'text-muted-foreground' }
        const Icon = action.icon
        return (
          <li key={event.id} className="relative flex gap-3">
            <span className={cn('relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-background', action.tone)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p>
                <span className="font-medium">{event.actorName}</span> <span className="text-muted-foreground">{action.label}</span>
                <time
                  dateTime={event.createdAt}
                  title={formatDateTime(event.createdAt)}
                  suppressHydrationWarning
                  className="ml-2 text-xs text-muted-foreground tabular-nums"
                >
                  {timeAgo(event.createdAt)}
                </time>
              </p>
              {event.comment ? <p className="mt-1 rounded-lg border bg-card px-3 py-2 whitespace-pre-line">{event.comment}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
