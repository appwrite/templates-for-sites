import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Camera, FileText, Paperclip, X } from 'lucide-react'
import { toast } from 'sonner'
import { CURRENCIES, toInputAmount } from '#/lib/money'
import type { Category, Expense } from '#/lib/types'
import { errorMessage, toDateInput } from '#/lib/utils'
import { saveExpense } from '#/server/expenses.functions'
import { Button } from './ui/button'
import { Field, FormError, Input, Select, Textarea } from './ui/field'
import { Dialog, DialogContent } from './ui/menu'
import { Spinner } from './ui/primitives'

export function ExpenseDialog({
  open,
  onOpenChange,
  expense,
  categories,
  currency,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense?: Expense | null
  categories: Category[]
  currency: string
  onSaved?: (id: string) => void
}) {
  const router = useRouter()
  const upload = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [removeReceipt, setRemoveReceipt] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [selectedCurrency, setSelectedCurrency] = useState(expense?.currency ?? currency)

  useEffect(() => {
    if (!open) return
    setFile(null)
    setRemoveReceipt(false)
    setError(null)
    setSelectedCurrency(expense?.currency ?? currency)
  }, [open, expense?.id, expense?.currency, currency])

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    form.delete('receipt')
    if (file) form.set('receipt', file)
    if (expense) form.set('id', expense.id)
    form.set('removeReceipt', String(removeReceipt))
    setPending(true)
    setError(null)
    try {
      const result = await saveExpense({ data: form })
      toast.success(expense ? 'Expense updated' : 'Expense added', {
        description: result.overLimit ? 'It is over the category limit, so approvers will see a flag.' : undefined,
      })
      onOpenChange(false)
      await router.invalidate()
      onSaved?.(result.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setPending(false)
    }
  }

  const existingReceipt = expense?.receipt && !removeReceipt && !file ? expense.receipt : null
  const active = categories.filter((category) => !category.archived || category.id === expense?.categoryId)

  const pick = (picked: File | undefined) => {
    if (!picked) return
    setFile(picked)
    setRemoveReceipt(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={expense ? 'Edit expense' : 'New expense'} description="Attach the receipt so approvers can check it." className="max-w-xl">
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Receipt</span>
            {file || existingReceipt ? (
              <div className="flex items-center gap-3 rounded-lg border bg-background p-2.5">
                {preview ? (
                  <img src={preview} alt="" className="size-12 rounded-md object-cover" />
                ) : (
                  <span className="flex size-12 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{file?.name ?? existingReceipt?.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove receipt"
                  onClick={() => {
                    setFile(null)
                    if (expense?.receipt) setRemoveReceipt(true)
                  }}
                >
                  <X />
                </Button>
              </div>
            ) : (
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault()
                  pick(event.dataTransfer.files[0])
                }}
                className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center"
              >
                <p className="text-sm text-muted-foreground">Drop an image or PDF here, or</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => upload.current?.click()}>
                    <Paperclip />
                    Choose file
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="sm:hidden" onClick={() => camera.current?.click()}>
                    <Camera />
                    Take photo
                  </Button>
                </div>
              </div>
            )}
            <input ref={upload} type="file" accept="image/*,application/pdf" hidden onChange={(event) => pick(event.target.files?.[0])} />
            <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => pick(event.target.files?.[0])} />
          </div>

          <Field label="Merchant" htmlFor="expense-merchant">
            <Input id="expense-merchant" name="merchant" required maxLength={255} defaultValue={expense?.merchant} placeholder="Blue Bottle Coffee" />
          </Field>

          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <Field label="Amount" htmlFor="expense-amount">
              <Input
                id="expense-amount"
                name="amount"
                inputMode="decimal"
                required
                defaultValue={expense ? toInputAmount(expense.amount, expense.currency) : ''}
                placeholder="0.00"
                className="tabular-nums"
              />
            </Field>
            <Field label="Currency" htmlFor="expense-currency">
              <Select id="expense-currency" name="currency" value={selectedCurrency} onChange={(event) => setSelectedCurrency(event.target.value)}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date" htmlFor="expense-date">
              <Input
                id="expense-date"
                name="spentAt"
                type="date"
                required
                defaultValue={toDateInput(expense?.spentAt ?? new Date().toISOString())}
              />
            </Field>
            <Field label="Category" htmlFor="expense-category">
              <Select id="expense-category" name="categoryId" defaultValue={expense?.categoryId ?? ''}>
                <option value="">Uncategorized</option>
                {active.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="expense-description">
            <Textarea
              id="expense-description"
              name="description"
              rows={2}
              maxLength={2000}
              defaultValue={expense?.description}
              placeholder="Client lunch with the Acme team"
            />
          </Field>

          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" size="sm" disabled={pending}>
              {pending ? <Spinner /> : null}
              {expense ? 'Save changes' : 'Add expense'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
