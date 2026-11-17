import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '#/components/page-header'
import { Button } from '#/components/ui/button'
import { Field, Input, Textarea } from '#/components/ui/field'
import { Card, EmptyState, Spinner } from '#/components/ui/primitives'
import type { SavedReply } from '#/lib/types'
import { cn, errorMessage } from '#/lib/utils'
import { deleteReply, listReplies, saveReply } from '#/server/replies.functions'

export const Route = createFileRoute('/_app/replies')({
  loader: () => listReplies(),
  head: () => ({ meta: [{ title: 'Saved replies · Mailroom' }] }),
  component: RepliesPage,
})

const PLACEHOLDERS = ['{{customer.firstName}}', '{{customer.name}}', '{{agent.firstName}}', '{{agent.name}}', '{{conversation.ref}}']

function RepliesPage() {
  const replies = Route.useLoaderData()
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string | null>(replies[0]?.id ?? null)
  const [draft, setDraft] = useState<{ name: string; body: string }>({ name: '', body: '' })
  const [saving, setSaving] = useState(false)

  const selected = replies.find((reply) => reply.id === selectedId) ?? null
  const isNew = selectedId === null

  useEffect(() => {
    setDraft(selected ? { name: selected.name, body: selected.body } : { name: '', body: '' })
  }, [selected?.id, selected?.updatedAt])

  async function onSave(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const saved: SavedReply = await saveReply({ data: { id: selected?.id, ...draft } })
      toast.success(isNew ? 'Saved reply created' : 'Saved reply updated')
      await router.invalidate()
      setSelectedId(saved.id)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function onDelete() {
    if (!selected || !window.confirm(`Delete “${selected.name}”?`)) return
    try {
      await deleteReply({ data: { id: selected.id } })
      toast.success('Saved reply deleted')
      setSelectedId(null)
      await router.invalidate()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Saved replies"
        meta={<span className="font-mono text-xs text-muted-foreground tabular-nums">{replies.length}</span>}
        actions={
          <Button size="sm" variant="brand" onClick={() => setSelectedId(null)}>
            <Plus />
            New reply
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <div className="scrollbar-thin w-80 shrink-0 overflow-y-auto border-r p-3 max-md:w-full max-md:border-r-0 max-md:border-b">
          {replies.length === 0 ? (
            <EmptyState className="py-10" icon={<MessageSquareText />} title="No saved replies" description="Write answers to common questions once and reuse them." />
          ) : (
            <ul className="grid gap-1">
              {replies.map((reply) => (
                <li key={reply.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(reply.id)}
                    className={cn(
                      'w-full rounded-lg px-3 py-2.5 text-left transition hover:bg-accent',
                      reply.id === selectedId && 'bg-accent',
                    )}
                  >
                    <p className="truncate text-sm font-medium">{reply.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{reply.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-6">
          <Card className="mx-auto max-w-2xl">
            <form onSubmit={onSave} className="grid gap-5 p-6">
              <div>
                <h2 className="font-display text-base font-medium tracking-tight">{isNew ? 'New saved reply' : 'Edit saved reply'}</h2>
                <p className="mt-1 text-sm text-muted-foreground">Insert it from the composer with the Saved replies button.</p>
              </div>
              <Field label="Name" htmlFor="reply-name">
                <Input
                  id="reply-name"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Refund policy"
                  maxLength={128}
                  required
                />
              </Field>
              <Field
                label="Reply"
                htmlFor="reply-body"
                hint={
                  <span className="flex flex-wrap items-center gap-1">
                    Placeholders:
                    {PLACEHOLDERS.map((placeholder) => (
                      <button
                        key={placeholder}
                        type="button"
                        onClick={() => setDraft((current) => ({ ...current, body: `${current.body}${placeholder}` }))}
                        className="rounded bg-secondary px-1 font-mono text-[11px] text-secondary-foreground hover:bg-accent"
                      >
                        {placeholder}
                      </button>
                    ))}
                  </span>
                }
              >
                <Textarea
                  id="reply-body"
                  value={draft.body}
                  onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))}
                  rows={10}
                  placeholder={'Hi {{customer.firstName}},\n\nThanks for reaching out…'}
                  required
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button type="submit" variant="brand" size="sm" disabled={saving}>
                  {saving ? <Spinner /> : null}
                  {isNew ? 'Create reply' : 'Save changes'}
                </Button>
                {!isNew ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onDelete} className="ml-auto text-destructive hover:text-destructive">
                    <Trash2 />
                    Delete
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  )
}
