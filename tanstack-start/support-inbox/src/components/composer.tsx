import { useRef, useState, type KeyboardEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Lock, MessageSquareText, Paperclip, Reply, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation, ConversationStatus, SavedReply, Viewer } from '#/lib/types'
import { cn, displayName, errorMessage, fillTemplate, firstName, formatBytes } from '#/lib/utils'
import { addNote, sendReply } from '#/server/conversation.functions'
import { Button } from './ui/button'
import { Select } from './ui/field'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './ui/menu'
import { Kbd, Spinner } from './ui/primitives'

type Mode = 'reply' | 'note'

export function Composer({ conversation, viewer, replies }: { conversation: Conversation; viewer: Viewer; replies: SavedReply[] }) {
  const router = useRouter()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<Mode>('reply')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [nextStatus, setNextStatus] = useState<ConversationStatus>('pending')
  const [sending, setSending] = useState(false)

  const customerName = displayName(conversation.customerName, conversation.customerEmail)

  function insertSavedReply(reply: SavedReply) {
    const text = fillTemplate(reply.body, {
      'customer.name': customerName,
      'customer.firstName': firstName(conversation.customerName, conversation.customerEmail),
      'customer.email': conversation.customerEmail,
      'agent.name': viewer.name,
      'agent.firstName': firstName(viewer.name, viewer.email),
      'conversation.ref': `#${conversation.ref}`,
    })
    setBody((current) => (current.trim() ? `${current.trimEnd()}\n\n${text}` : text))
    requestAnimationFrame(() => textarea.current?.focus())
  }

  async function submit() {
    if (!body.trim() || sending) return
    setSending(true)
    try {
      if (mode === 'note') {
        await addNote({ data: { conversationId: conversation.id, body } })
        toast.success('Note added')
      } else {
        const form = new FormData()
        form.set('conversationId', conversation.id)
        form.set('body', body)
        form.set('status', nextStatus)
        for (const file of files) form.append('attachments', file)
        const result = await sendReply({ data: form })
        if (result.ok) toast.success(`Reply sent to ${customerName}`)
        else toast.error('Reply saved but not delivered', { description: result.deliveryError })
      }
      setBody('')
      setFiles([])
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submit()
    }
  }

  const tab = (value: Mode, label: string, Icon: typeof Reply) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={cn(
        'relative inline-flex h-10 items-center gap-1.5 px-1 text-sm transition-colors',
        mode === value ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
      {label}
      {mode === value ? (
        <span className={cn('absolute inset-x-0 -bottom-px h-0.5 rounded-full', value === 'note' ? 'bg-warning' : 'bg-brand')} />
      ) : null}
    </button>
  )

  return (
    <div
      className={cn(
        'rounded-xl border bg-card shadow-sm transition-colors focus-within:border-ring',
        mode === 'note' && 'border-note-border bg-note',
      )}
    >
      <div role="tablist" className="flex items-center gap-5 border-b px-4">
        {tab('reply', 'Reply', Reply)}
        {tab('note', 'Note', Lock)}
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {mode === 'reply' ? `To ${conversation.customerEmail}` : 'Only your team can see notes'}
        </span>
      </div>

      <textarea
        ref={textarea}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        rows={5}
        placeholder={mode === 'reply' ? `Write a reply to ${firstName(conversation.customerName, conversation.customerEmail)}…` : 'Leave a note for your team…'}
        className="block max-h-[40vh] min-h-28 w-full resize-y bg-transparent px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      {mode === 'reply' && viewer.signature ? (
        <p className="px-4 pb-2 text-xs whitespace-pre-line text-muted-foreground/80">{viewer.signature}</p>
      ) : null}

      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`} className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs">
              <Paperclip className="size-3 text-muted-foreground" />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={replies.length === 0} title={replies.length ? undefined : 'Create saved replies under Saved replies'}>
              <MessageSquareText />
              Saved replies
            </Button>
          </MenuTrigger>
          <MenuContent className="w-72">
            <MenuLabel>Insert a saved reply</MenuLabel>
            {replies.map((reply) => (
              <MenuItem key={reply.id} onSelect={() => insertSavedReply(reply)} className="flex-col items-start gap-0.5">
                <span className="font-medium">{reply.name}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{reply.body}</span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>

        {mode === 'reply' ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
              <Paperclip />
              Attach
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                setFiles((current) => [...current, ...picked].slice(0, 10))
                event.target.value = ''
              }}
            />
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>↵</Kbd>
          </span>
          {mode === 'reply' ? (
            <Select
              aria-label="Status after sending"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as ConversationStatus)}
              className="h-8 w-auto text-xs"
            >
              <option value="pending">and mark Pending</option>
              <option value="closed">and Close</option>
              <option value="open">and keep Open</option>
            </Select>
          ) : null}
          <Button variant={mode === 'note' ? 'default' : 'brand'} size="sm" onClick={submit} disabled={!body.trim() || sending}>
            {sending ? <Spinner /> : mode === 'note' ? <Lock /> : <Send />}
            {mode === 'note' ? 'Add note' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  )
}
