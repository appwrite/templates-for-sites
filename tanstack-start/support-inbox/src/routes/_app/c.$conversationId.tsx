import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi, useRouter } from '@tanstack/react-router'
import { ArrowLeft, CheckCircle2, ChevronDown, Inbox, UserRound, UserRoundX } from 'lucide-react'
import { toast } from 'sonner'
import { Composer } from '#/components/composer'
import { CustomerPanel } from '#/components/customer-panel'
import { MessageCard } from '#/components/message-card'
import { STATUS_ICONS, StatusBadge } from '#/components/status'
import { TagEditor } from '#/components/tag-editor'
import { Button } from '#/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '#/components/ui/menu'
import { Avatar, EmptyState } from '#/components/ui/primitives'
import type { ConversationStatus } from '#/lib/types'
import { STATUS_LABELS, errorMessage } from '#/lib/utils'
import { getConversation, updateConversation } from '#/server/conversation.functions'

const appRoute = getRouteApi('/_app')

export const Route = createFileRoute('/_app/c/$conversationId')({
  loader: ({ params }) => getConversation({ data: { id: params.conversationId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `${loaderData.conversation.subject} · #${loaderData.conversation.ref}` : 'Conversation' }],
  }),
  notFoundComponent: () => (
    <EmptyState icon={<Inbox />} title="Conversation not found" description="It may have been deleted, or the link is wrong." />
  ),
  component: ConversationPage,
})

function ConversationPage() {
  const { conversation, messages, customer, history, agents, replies } = Route.useLoaderData()
  const { viewer } = appRoute.useLoaderData()
  const router = useRouter()
  const thread = useRef<HTMLDivElement>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight })
  }, [conversation.id, messages.length])

  async function update(patch: { status?: ConversationStatus; assigneeId?: string | null; tags?: string[] }, message?: string) {
    setSaving(true)
    try {
      await updateConversation({ data: { id: conversation.id, ...patch } })
      if (message) toast.success(message)
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const assignee = agents.find((agent) => agent.id === conversation.assigneeId)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
              <ArrowLeft />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-lg font-medium tracking-tight">{conversation.subject}</h1>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">#{conversation.ref}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Menu>
                <MenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={saving}>
                    {assignee ? <Avatar name={assignee.name} email={assignee.id} size="xs" /> : <UserRound />}
                    <span className="max-w-32 truncate">{assignee ? assignee.name || assignee.email : 'Unassigned'}</span>
                    <ChevronDown className="opacity-60" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuLabel>Assign to</MenuLabel>
                  {agents.map((agent) => (
                    <MenuItem
                      key={agent.id}
                      selected={agent.id === conversation.assigneeId}
                      onSelect={() => update({ assigneeId: agent.id }, `Assigned to ${agent.id === viewer.id ? 'you' : agent.name}`)}
                    >
                      <Avatar name={agent.name} email={agent.id} size="xs" />
                      <span className="truncate">{agent.id === viewer.id ? `${agent.name} (you)` : agent.name || agent.email}</span>
                    </MenuItem>
                  ))}
                  {conversation.assigneeId ? (
                    <>
                      <MenuSeparator />
                      <MenuItem onSelect={() => update({ assigneeId: null }, 'Unassigned')}>
                        <UserRoundX />
                        Unassign
                      </MenuItem>
                    </>
                  ) : null}
                </MenuContent>
              </Menu>

              <Menu>
                <MenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={saving} aria-label="Change status">
                    <StatusBadge status={conversation.status} />
                    <ChevronDown className="opacity-60" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" className="min-w-44">
                  <MenuLabel>Status</MenuLabel>
                  {(Object.keys(STATUS_LABELS) as ConversationStatus[]).map((status) => {
                    const Icon = STATUS_ICONS[status]
                    return (
                      <MenuItem
                        key={status}
                        selected={status === conversation.status}
                        onSelect={() => update({ status }, `Marked ${STATUS_LABELS[status].toLowerCase()}`)}
                      >
                        <Icon />
                        {STATUS_LABELS[status]}
                      </MenuItem>
                    )
                  })}
                </MenuContent>
              </Menu>

              {conversation.status !== 'closed' ? (
                <Button size="sm" variant="secondary" disabled={saving} onClick={() => update({ status: 'closed' }, 'Conversation closed')}>
                  <CheckCircle2 />
                  Close
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mt-2 pl-11">
            <TagEditor tags={conversation.tags} disabled={saving} onChange={(tags) => update({ tags })} />
          </div>
        </div>

        <div ref={thread} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto bg-muted/30 dark:bg-transparent">
          <div className="mx-auto grid max-w-3xl gap-4 px-6 py-6">
            {messages.map((message) => (
              <MessageCard key={message.id} message={message} />
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t bg-background px-6 py-4">
          <div className="mx-auto max-w-3xl">
            <Composer key={conversation.id} conversation={conversation} viewer={viewer} replies={replies} />
          </div>
        </div>
      </div>

      <CustomerPanel
        conversation={conversation}
        customer={customer}
        history={history}
        metadata={[...messages].reverse().find((message) => message.metadata)?.metadata}
      />
    </div>
  )
}
