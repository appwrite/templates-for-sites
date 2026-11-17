import { useMemo, useState } from 'react'
import { AlertTriangle, Braces, CheckCheck, Download, FileText, Image as ImageIcon, Loader2, Lock, MoreHorizontal, ShieldAlert, Webhook } from 'lucide-react'
import type { Attachment, Message } from '#/lib/types'
import { cn, displayName, formatBytes, formatDateTime, timeAgo } from '#/lib/utils'
import { EmailFrame, hasQuotedHtml } from './email-frame'
import { Avatar, Badge } from './ui/primitives'

function splitQuoted(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const index = lines.findIndex(
    (line, i) =>
      /^On .{4,200}wrote:\s*$/i.test(line.trim()) ||
      /^-{2,}\s*(Original|Forwarded) Message/i.test(line.trim()) ||
      (line.startsWith('>') && lines.slice(i).every((rest) => rest.startsWith('>') || !rest.trim())),
  )
  if (index <= 0) return { body: text.trim(), quoted: '' }
  return { body: lines.slice(0, index).join('\n').trim(), quoted: lines.slice(index).join('\n').trim() }
}

function DeliveryBadge({ status, error }: { status: string; error: string }) {
  if (status === 'sent') {
    return (
      <Badge tone="success">
        <CheckCheck />
        Sent
      </Badge>
    )
  }
  if (status === 'failed') {
    return (
      <Badge tone="danger" title={error}>
        <AlertTriangle />
        Not delivered
      </Badge>
    )
  }
  return (
    <Badge tone="outline">
      <Loader2 className="animate-spin" />
      Sending
    </Badge>
  )
}

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  const isImage = attachment.contentType.startsWith('image/')
  const Icon = isImage ? ImageIcon : FileText
  return (
    <a
      href={`/api/files/${attachment.fileId}`}
      className="group flex max-w-64 items-center gap-2.5 rounded-lg border bg-background px-3 py-2 text-sm transition hover:border-ring hover:bg-accent/50"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{attachment.name}</span>
        <span className="block text-xs text-muted-foreground">{formatBytes(attachment.size)}</span>
      </span>
      <Download className="ml-1 size-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
    </a>
  )
}

export function MessageCard({ message }: { message: Message }) {
  const [showQuoted, setShowQuoted] = useState(false)
  const [preferText, setPreferText] = useState(false)
  const isNote = message.direction === 'note'
  const isOutbound = message.direction === 'outbound'

  // Replies we sent render from their plain text; customer email prefers HTML.
  const useHtml = message.direction === 'inbound' && Boolean(message.html) && !preferText
  const { body, quoted } = useMemo(() => splitQuoted(message.text || ''), [message.text])
  const hasQuote = useHtml ? hasQuotedHtml(message.html) : Boolean(quoted)
  const files = message.attachments.filter((attachment) => !(useHtml && attachment.inline && attachment.contentId))

  const name = isNote || isOutbound ? message.authorName || message.fromName : displayName(message.fromName, message.fromEmail)

  return (
    <article
      className={cn(
        'rounded-xl border bg-card',
        isNote && 'border-note-border bg-note',
        isOutbound && 'border-l-2 border-l-brand',
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-4">
        <Avatar name={name} email={isNote || isOutbound ? message.authorId || message.fromEmail : message.fromEmail} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-medium">{name}</span>
            {isNote ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Lock className="size-3" />
                Internal note
              </span>
            ) : isOutbound ? (
              <span className="text-xs text-muted-foreground">replied to {message.recipients}</span>
            ) : (
              <span className="truncate text-xs text-muted-foreground">{message.fromEmail}</span>
            )}
          </p>
          {message.cc && !isNote ? <p className="truncate text-xs text-muted-foreground">Cc: {message.cc}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {message.source === 'api' ? (
            <Badge tone="info" title="Created with POST /api/tickets">
              <Braces />
              API
            </Badge>
          ) : message.source === 'webhook' ? (
            <Badge tone="outline" title="Forwarded to POST /api/tickets by an email provider">
              <Webhook />
              Webhook
            </Badge>
          ) : null}
          {message.spamVerdict === 'spam' ? (
            <Badge tone="danger">
              <ShieldAlert />
              Spam
            </Badge>
          ) : null}
          {isOutbound ? <DeliveryBadge status={message.deliveryStatus} error={message.deliveryError} /> : null}
          <time
            dateTime={message.createdAt}
            title={formatDateTime(message.createdAt)}
            suppressHydrationWarning
            className="text-xs text-muted-foreground tabular-nums"
          >
            {timeAgo(message.createdAt)}
          </time>
        </div>
      </header>

      <div className="px-5 pt-3 pb-4">
        {useHtml ? (
          <EmailFrame html={message.html} attachments={message.attachments} hideQuoted={!showQuoted} />
        ) : (
          <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {(showQuoted ? message.text.trim() : body) || <span className="text-muted-foreground italic">No text content</span>}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {hasQuote ? (
            <button
              type="button"
              onClick={() => setShowQuoted((value) => !value)}
              className="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-expanded={showQuoted}
            >
              <MoreHorizontal className="size-3.5" />
              {showQuoted ? 'Hide quoted text' : 'Show quoted text'}
            </button>
          ) : null}
          {message.direction === 'inbound' && message.html && message.text ? (
            <button
              type="button"
              onClick={() => setPreferText((value) => !value)}
              className="inline-flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              {preferText ? 'View formatted' : 'View plain text'}
            </button>
          ) : null}
        </div>

        {isOutbound && message.deliveryStatus === 'failed' && message.deliveryError ? (
          <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {message.deliveryError}
          </p>
        ) : null}

        {message.metadata ? (
          <div className="mt-4 overflow-hidden rounded-lg border bg-muted/40">
            <p className="eyebrow border-b px-3 py-1.5">Metadata</p>
            <pre className="scrollbar-thin max-h-64 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
              {message.metadata}
            </pre>
          </div>
        ) : null}

        {files.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((attachment) => (
              <AttachmentChip key={attachment.fileId} attachment={attachment} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}
