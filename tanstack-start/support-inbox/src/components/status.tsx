import { CheckCircle2, CircleDot, Clock3, ShieldAlert } from 'lucide-react'
import type { ConversationStatus } from '#/lib/types'
import { STATUS_LABELS } from '#/lib/utils'
import { Badge } from './ui/primitives'

const TONES = { open: 'info', pending: 'warning', closed: 'success', spam: 'danger' } as const
export const STATUS_ICONS = { open: CircleDot, pending: Clock3, closed: CheckCircle2, spam: ShieldAlert } as const

export function StatusBadge({ status }: { status: ConversationStatus }) {
  const Icon = STATUS_ICONS[status]
  return (
    <Badge tone={TONES[status]}>
      <Icon />
      {STATUS_LABELS[status]}
    </Badge>
  )
}
