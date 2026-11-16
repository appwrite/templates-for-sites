import type { ReactNode } from 'react'
import { cn } from '#/lib/utils'

export function PageHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2.5', className)}>
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate font-display text-lg font-medium tracking-tight">{title}</h1>
        {meta}
      </div>
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
