import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Inbox, Mail } from 'lucide-react'
import { ConversationRow } from '#/components/conversation-row'
import { CustomerNotes } from '#/components/customer-panel'
import { buttonVariants } from '#/components/ui/button'
import { Avatar, Card, EmptyState } from '#/components/ui/primitives'
import { displayName, formatDateTime } from '#/lib/utils'
import { getCustomer } from '#/server/customers.functions'

export const Route = createFileRoute('/_app/customers/$customerId')({
  loader: ({ params }) => getCustomer({ data: { id: params.customerId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${displayName(loaderData.customer.name, loaderData.customer.email)} · Mailroom` : 'Customer' }],
  }),
  notFoundComponent: () => <EmptyState icon={<Inbox />} title="Customer not found" />,
  component: CustomerPage,
})

function CustomerPage() {
  const { customer, conversations } = Route.useLoaderData()
  const name = displayName(customer.name, customer.email)

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <Link to="/customers" className={buttonVariants({ variant: 'ghost', size: 'sm', className: '-ml-2 mb-4' })}>
          <ArrowLeft />
          Customers
        </Link>

        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={customer.name} email={customer.email} size="lg" className="size-14 text-base" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-medium tracking-tight">{name}</h1>
            <a href={`mailto:${customer.email}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Mail className="size-3.5" />
              {customer.email}
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Card className="px-4 py-3">
            <p className="eyebrow">Conversations</p>
            <p className="mt-1 font-display text-2xl font-medium tabular-nums">{customer.conversationCount}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="eyebrow">First contact</p>
            <p className="mt-1 text-sm font-medium" suppressHydrationWarning>{formatDateTime(customer.createdAt)}</p>
          </Card>
          <Card className="px-4 py-3">
            <p className="eyebrow">Last contact</p>
            <p className="mt-1 text-sm font-medium" suppressHydrationWarning>
              {customer.lastContactAt ? formatDateTime(customer.lastContactAt) : '—'}
            </p>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]">
          <Card className="overflow-hidden">
            <div className="border-b px-5 py-3">
              <h2 className="font-display text-base font-medium tracking-tight">Conversations</h2>
            </div>
            {conversations.length ? (
              <ul className="[&>li:last-child]:border-0">
                {conversations.map((conversation) => (
                  <ConversationRow key={conversation.id} conversation={conversation} showStatus />
                ))}
              </ul>
            ) : (
              <EmptyState icon={<Inbox />} title="No conversations" />
            )}
          </Card>

          <Card className="h-fit p-4">
            <h2 className="eyebrow mb-2">Notes</h2>
            <CustomerNotes customer={customer} />
          </Card>
        </div>
      </div>
    </div>
  )
}
