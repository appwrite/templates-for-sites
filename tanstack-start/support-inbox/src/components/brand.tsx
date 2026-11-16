import { cn } from '#/lib/utils'

// An envelope folding into an inbox tray: Mailroom's mark.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_4px_14px_-4px_color-mix(in_oklch,var(--brand)_70%,transparent)]',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden>
        <path d="M4 7.5 12 13l8-5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path
          d="M4 13v4.25C4 18.216 4.784 19 5.75 19h12.5c.966 0 1.75-.784 1.75-1.75V13h-4.5l-1.25 2h-4.5L8.5 13H4Z"
          fill="currentColor"
          fillOpacity=".28"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M4 13V6.75C4 5.784 4.784 5 5.75 5h12.5c.966 0 1.75.784 1.75 1.75V13" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  )
}

export function Wordmark({ name = 'Mailroom', className }: { name?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="truncate font-display text-[15px] font-medium tracking-tight">{name}</span>
    </span>
  )
}
