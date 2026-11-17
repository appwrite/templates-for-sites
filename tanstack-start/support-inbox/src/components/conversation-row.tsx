import { Link } from '@tanstack/react-router'
import { CornerUpLeft, MessagesSquare } from 'lucide-react'
import type { Conversation } from '#/lib/types'
import { cn, displayName, timeAgo } from '#/lib/utils'
import { StatusBadge } from './status'
import { Avatar } from './ui/primitives'

export function ConversationRow({
  conversation,
  selected,
  onToggle,
  showStatus,
}: {
  conversation: Conversation
  selected?: boolean
  onToggle?: (id: string) => void
  showStatus?: boolean
}) {
  const unread = !conversation.seen
  const name = displayName(conversation.customerName, conversation.customerEmail)

  return (
    <li
      className={cn(
        'group relative flex items-center gap-4 border-b px-6 py-3 transition-colors hover:bg-accent/50',
        selected && 'bg-accent/60 hover:bg-accent/70',
      )}
    >
      {onToggle ? (
        <input
          type="checkbox"
          aria-label={`Select conversation with ${name}`}
          checked={selected}
          onChange={() => onToggle(conversation.id)}
          className="relative z-10 size-4 shrink-0 cursor-pointer rounded accent-brand"
        />
      ) : null}

      <Link
        to="/c/$conversationId"
        params={{ conversationId: conversation.id }}
        preload={false}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-label={`${conversation.subject} from ${name}`}
      />

      <div className="flex w-52 shrink-0 items-center gap-3 max-md:w-auto">
        <span className="relative">
          <Avatar name={conversation.customerName} email={conversation.customerEmail} />
          {unread ? (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-brand" />
          ) : null}
        </span>
        <div className="min-w-0 max-md:hidden">
          <p className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>{name}</p>
          <p className="truncate text-xs text-muted-foreground">{conversation.customerEmail}</p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {showStatus ? <StatusBadge status={conversation.status} /> : null}
          {conversation.lastDirection === 'outbound' ? (
            <CornerUpLeft className="size-3.5 shrink-0 text-muted-foreground" aria-label="Last reply was from your team" />
          ) : null}
          <p className={cn('truncate text-sm', unread ? 'font-semibold text-foreground' : 'text-foreground/90')}>
            {conversation.subject}
          </p>
          {conversation.messageCount > 1 ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <MessagesSquare className="size-3" />
              {conversation.messageCount}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {conversation.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="shrink-0 rounded bg-secondary px-1.5 text-[11px] leading-5 text-secondary-foreground">
              {tag}
            </span>
          ))}
          <p className="truncate text-sm text-muted-foreground">{conversation.preview || 'No preview available'}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {conversation.assigneeId ? (
          <span title={`Assigned to ${conversation.assigneeName}`} className="max-sm:hidden">
            <Avatar name={conversation.assigneeName} email={conversation.assigneeId} size="xs" />
          </span>
        ) : null}
        <span className="font-mono max-sm:hidden">#{conversation.ref}</span>
        <time dateTime={conversation.lastMessageAt} suppressHydrationWarning className="w-14 text-right tabular-nums">
          {timeAgo(conversation.lastMessageAt)}
        </time>
      </div>
    </li>
  )
}
