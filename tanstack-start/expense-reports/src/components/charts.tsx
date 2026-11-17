import { useState } from 'react'
import { formatMoney } from '#/lib/money'
import { cn } from '#/lib/utils'

const monthLabel = (key: string, style: 'short' | 'long' = 'short') =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en', { month: style, year: style === 'long' ? 'numeric' : undefined, timeZone: 'UTC' })

function niceMax(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

// Six monthly columns in one hue. Only the current month carries a direct
// label; the rest show their value on hover or focus.
export function MonthChart({ data, currency }: { data: { month: string; amount: number }[]; currency: string }) {
  const [active, setActive] = useState<number | null>(null)
  const max = niceMax(Math.max(...data.map((point) => point.amount)))
  const ticks = [max, max / 2, 0]
  const current = data.length - 1

  return (
    <figure className="grid gap-3">
      <div className="relative grid grid-cols-[auto_1fr] gap-3">
        <div className="flex h-44 flex-col justify-between text-right font-mono text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((tick) => (
            <span key={tick} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatMoney(tick, currency, { compact: true })}
            </span>
          ))}
        </div>
        <div className="relative h-44">
          {ticks.map((tick, index) => (
            <span key={tick} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${(index / 2) * 100}%` }} />
          ))}
          <div className="absolute inset-0 grid grid-cols-6 items-end gap-[2px] px-1">
            {data.map((point, index) => {
              const height = `${Math.max((point.amount / max) * 100, point.amount > 0 ? 1.5 : 0)}%`
              const showLabel = index === current || index === active
              return (
                <button
                  key={point.month}
                  type="button"
                  aria-label={`${monthLabel(point.month, 'long')}: ${formatMoney(point.amount, currency)}`}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                  className="group relative flex h-full items-end justify-center outline-none"
                >
                  <span
                    className={cn(
                      'relative w-full max-w-10 rounded-t-[4px] bg-brand transition-opacity',
                      active !== null && active !== index ? 'opacity-40' : 'opacity-100',
                    )}
                    style={{ height }}
                  >
                    {showLabel ? (
                      <span className="absolute -top-6 left-1/2 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-popover-foreground shadow-sm tabular-nums">
                        {formatMoney(point.amount, currency, { compact: true })}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
        <span />
        <div className="grid grid-cols-6 gap-[2px] px-1 text-center text-xs text-muted-foreground">
          {data.map((point, index) => (
            <span key={point.month} className={cn(index === current && 'font-medium text-foreground')}>
              {monthLabel(point.month)}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Spend per month</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.month}>
              <th scope="row">{monthLabel(point.month, 'long')}</th>
              <td>{formatMoney(point.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

// Horizontal bars sorted by spend; a short list, so each row is labeled like a table.
export function CategoryChart({ data, currency }: { data: { name: string; amount: number }[]; currency: string }) {
  const total = data.reduce((sum, item) => sum + item.amount, 0)
  const max = Math.max(...data.map((item) => item.amount), 1)
  return (
    <ul className="grid gap-3" aria-label="Spend by category">
      {data.map((item) => {
        const share = total ? Math.round((item.amount / total) * 100) : 0
        return (
          <li key={item.name} className="grid gap-1.5" title={`${item.name}: ${formatMoney(item.amount, currency)} (${share}%)`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 tabular-nums">
                {formatMoney(item.amount, currency)}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{share}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max((item.amount / max) * 100, 2)}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
