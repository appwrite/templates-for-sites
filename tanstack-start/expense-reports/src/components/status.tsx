import { BadgeCheck, CircleDashed, Clock3, Undo2, XCircle } from 'lucide-react'
import type { Status } from '#/lib/types'
import { STATUS_LABELS } from '#/lib/utils'
import { Badge } from './ui/primitives'

const TONES = { draft: 'outline', submitted: 'warning', approved: 'info', rejected: 'danger', reimbursed: 'success' } as const
const ICONS = { draft: CircleDashed, submitted: Clock3, approved: BadgeCheck, rejected: XCircle, reimbursed: Undo2 } as const

export function StatusBadge({ status, short }: { status: Status; short?: boolean }) {
  const Icon = ICONS[status]
  return (
    <Badge tone={TONES[status]}>
      <Icon />
      {short && status === 'submitted' ? 'Submitted' : STATUS_LABELS[status]}
    </Badge>
  )
}
