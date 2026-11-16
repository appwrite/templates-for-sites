import { Link } from '@tanstack/react-router'
import { AlertTriangle, FileText, ImageIcon, Mail, ReceiptText, X } from 'lucide-react'
import { formatMoney } from '#/lib/money'
import type { Expense } from '#/lib/types'
import { cn, formatDate } from '#/lib/utils'
import { StatusBadge } from './status'

function ReceiptIcon({ expense }: { expense: Expense }) {
  const Icon = expense.receipt ? (expense.receipt.type.startsWith('image/') ? ImageIcon : FileText) : expense.source === 'email' ? Mail : ReceiptText
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border',
        expense.receipt || expense.source === 'email' ? 'bg-card text-foreground' : 'border-dashed text-muted-foreground',
      )}
      title={expense.receipt ? 'Receipt attached' : expense.source === 'email' ? 'Email receipt' : 'No receipt'}
    >
      <Icon className="size-4" />
    </span>
  )
}

export function ExpenseTable({
  expenses,
  selected,
  onToggle,
  showOwner,
  showStatus = true,
  onRemove,
}: {
  expenses: Expense[]
  selected?: Set<string>
  onToggle?: (id: string) => void
  showOwner?: boolean
  showStatus?: boolean
  onRemove?: (expense: Expense) => void
}) {
  return (
    <ul className="divide-y">
      {expenses.map((expense) => (
        <li key={expense.id} className="group relative flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50 sm:gap-4">
          {onToggle ? (
            <input
              type="checkbox"
              aria-label={`Select ${expense.merchant}`}
              checked={selected?.has(expense.id) ?? false}
              onChange={() => onToggle(expense.id)}
              disabled={expense.status !== 'draft' || Boolean(expense.reportId)}
              className="relative z-10 size-4 shrink-0 cursor-pointer rounded accent-brand disabled:cursor-not-allowed disabled:opacity-30"
            />
          ) : null}
          <Link
            to="/expenses/$expenseId"
            params={{ expenseId: expense.id }}
            preload={false}
            aria-label={`${expense.merchant}, ${formatMoney(expense.amount, expense.currency)}`}
            className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
          <ReceiptIcon expense={expense} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 truncate text-sm font-medium">
              {expense.merchant}
              {expense.overLimit ? (
                <span title="Over the category limit" className="inline-flex text-warning">
                  <AlertTriangle className="size-3.5" />
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[formatDate(expense.spentAt), expense.categoryName || 'Uncategorized', showOwner ? expense.ownerName : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          {showStatus ? (
            <span className="max-sm:hidden">
              <StatusBadge status={expense.status} short />
            </span>
          ) : null}
          <span className={cn('w-28 text-right text-sm font-medium tabular-nums', expense.amount === 0 && 'text-warning')}>
            {expense.amount === 0 ? 'Add amount' : formatMoney(expense.amount, expense.currency)}
          </span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${expense.merchant} from the report`}
              onClick={() => onRemove(expense)}
              className="relative z-10 -mr-2 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
