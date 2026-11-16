import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Field, Input } from '#/components/ui/field'
import { Dialog, DialogContent } from '#/components/ui/menu'
import { Badge, Card, CardHeader, Spinner } from '#/components/ui/primitives'
import { formatMoney, toInputAmount } from '#/lib/money'
import type { Category } from '#/lib/types'
import { useAction } from '#/lib/use-action'
import { getSettings, saveCategory } from '#/server/settings.functions'

export const Route = createFileRoute('/_app/settings/categories')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Categories · Outlay' }] }),
  component: CategorySettings,
})

function CategorySettings() {
  const { viewer, workspace, categories } = Route.useLoaderData()
  const action = useAction()
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const current = editing === 'new' ? null : editing

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const ok = await action.run(
      () =>
        saveCategory({
          data: { id: current?.id, name: String(form.get('name')), limit: String(form.get('limit') ?? ''), archived: current?.archived ?? false },
        }),
      current ? 'Category updated' : 'Category added',
    )
    if (ok) setEditing(null)
  }

  return (
    <Card>
      <CardHeader
        title="Categories"
        description={`Set an optional per-expense limit in ${workspace.currency}. Expenses over it are flagged for approvers.`}
        action={
          viewer.isAdmin ? (
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus />
              Add category
            </Button>
          ) : null
        }
      />
      <ul className="divide-y">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center gap-3 px-5 py-3">
            <span className={category.archived ? 'flex-1 text-sm text-muted-foreground line-through' : 'flex-1 text-sm font-medium'}>{category.name}</span>
            {category.archived ? <Badge tone="outline">Archived</Badge> : null}
            <span className="text-sm text-muted-foreground tabular-nums">
              {category.limit ? `Limit ${formatMoney(category.limit, workspace.currency)}` : 'No limit'}
            </span>
            {viewer.isAdmin ? (
              <>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${category.name}`} onClick={() => setEditing(category)}>
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={category.archived ? `Restore ${category.name}` : `Archive ${category.name}`}
                  disabled={action.pending}
                  onClick={() =>
                    action.run(
                      () =>
                        saveCategory({
                          data: {
                            id: category.id,
                            name: category.name,
                            limit: category.limit ? toInputAmount(category.limit, workspace.currency) : '',
                            archived: !category.archived,
                          },
                        }),
                      category.archived ? 'Category restored' : 'Category archived',
                    )
                  }
                >
                  {category.archived ? <ArchiveRestore /> : <Archive />}
                </Button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent title={current ? `Edit ${current.name}` : 'Add a category'}>
          <form onSubmit={onSave} className="grid gap-4">
            <Field label="Name" htmlFor="category-name">
              <Input id="category-name" name="name" required maxLength={64} defaultValue={current?.name} autoFocus />
            </Field>
            <Field label={`Limit per expense (${workspace.currency})`} htmlFor="category-limit" hint="Leave blank for no limit.">
              <Input
                id="category-limit"
                name="limit"
                inputMode="decimal"
                defaultValue={current?.limit ? toInputAmount(current.limit, workspace.currency) : ''}
                placeholder="75.00"
                className="tabular-nums"
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="brand" disabled={action.pending}>
                {action.pending ? <Spinner /> : null}
                Save category
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
