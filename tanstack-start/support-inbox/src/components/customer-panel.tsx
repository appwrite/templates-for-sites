import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { Conversation, Customer } from '#/lib/types'
import { displayName, errorMessage, timeAgo } from '#/lib/utils'
import { updateCustomerNotes } from '#/server/conversation.functions'
import { StatusBadge } from './status'
import { Avatar } from './ui/primitives'

export function CustomerNotes({ customer }: { customer: Customer }) {
  const [notes, setNotes] = useState(customer.notes)
  const [saved, setSaved] = useState(customer.notes)

  useEffect(() => {
    setNotes(customer.notes)
    setSaved(customer.notes)
  }, [customer.id, customer.notes])

  async function save() {
    if (notes === saved) return
    try {
      await updateCustomerNotes({ data: { id: customer.id, notes } })
      setSaved(notes)
      toast.success('Notes saved')
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <textarea
      value={notes}
      onChange={(event) => setNotes(event.target.value)}
      onBlur={save}
      rows={4}
      placeholder="Add notes about this customer. Saved when you click away."
      className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none transition placeholder:text-muted-foreground hover:border-input focus:border-ring focus:ring-[3px] focus:ring-ring/50"
    />
  )
}

export function CustomerPanel({
  conversation,
  customer,
  history,
  metadata,
}: {
  conversation: Conversation
  customer: Customer | null
  history: Conversation[]
  // The latest metadata sent with POST /api/tickets for this ticket.
  metadata?: string
}) {
  const name = displayName(customer?.name || conversation.customerName, conversation.customerEmail)

  return (
    <aside className="scrollbar-thin hidden w-80 shrink-0 overflow-y-auto border-l bg-sidebar xl:block">
      <section className="border-b p-5">
        <div className="flex items-center gap-3">
          <Avatar name={name} email={conversation.customerEmail} size="lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-base font-medium tracking-tight">{name}</p>
            <button
              type="button"
              className="group flex max-w-full items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await navigator.clipboard.writeText(conversation.customerEmail)
                toast.success('Email copied')
              }}
            >
              <span className="truncate">{conversation.customerEmail}</span>
              <Copy className="size-3 shrink-0 opacity-0 transition group-hover:opacity-100" />
            </button>
          </div>
        </div>

        {customer ? (
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg border bg-card px-3 py-2">
              <dt className="eyebrow">Conversations</dt>
              <dd className="mt-0.5 font-display text-lg font-medium tabular-nums">{customer.conversationCount}</dd>
            </div>
            <div className="rounded-lg border bg-card px-3 py-2">
              <dt className="eyebrow">Customer since</dt>
              <dd className="mt-0.5 text-sm font-medium" suppressHydrationWarning>
                {new Date(customer.createdAt).toLocaleDateString('en', { month: 'short', year: 'numeric' })}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {metadata ? (
        <section className="border-b p-5">
          <h3 className="eyebrow mb-2">Metadata</h3>
          <pre className="scrollbar-thin max-h-48 overflow-auto rounded-lg border bg-card px-3 py-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {metadata}
          </pre>
        </section>
      ) : null}

      {customer ? (
        <section className="border-b p-5">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Notes</h3>
            <Link
              to="/customers/$customerId"
              params={{ customerId: customer.id }}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Profile
              <ArrowUpRight className="size-3" />
            </Link>
          </div>
          <CustomerNotes customer={customer} />
        </section>
      ) : null}

      <section className="p-5">
        <h3 className="eyebrow mb-3">Previous conversations</h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">This is their first conversation.</p>
        ) : (
          <ul className="grid gap-2">
            {history.map((item) => (
              <li key={item.id}>
                <Link
                  to="/c/$conversationId"
                  params={{ conversationId: item.id }}
                  preload={false}
                  className="block rounded-lg border bg-card px-3 py-2.5 transition hover:border-ring hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                      {timeAgo(item.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium">{item.subject}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.preview}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
