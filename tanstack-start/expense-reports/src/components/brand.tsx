import { cn } from '#/lib/utils'

// A receipt with a torn edge and a return arrow: money coming back to you.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground shadow-[0_1px_0_0_rgb(255_255_255/0.25)_inset,0_4px_14px_-4px_color-mix(in_oklch,var(--brand)_70%,transparent)]',
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className="size-[18px]" aria-hidden>
        <path
          d="M6 3.75h12a.75.75 0 0 1 .75.75v15.6l-2.25-1.35-2.25 1.35-2.25-1.35-2.25 1.35-2.25-1.35-2.25 1.35V4.5A.75.75 0 0 1 6 3.75Z"
          fill="currentColor"
          fillOpacity=".24"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M14.5 9.25h-4.25a1.75 1.75 0 0 0 0 3.5h2.5a1.75 1.75 0 0 1 0 3.5H8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M12.25 7.5v1.75M10.75 16.25V18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  )
}

export function Wordmark({ name = 'Outlay', className }: { name?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <span className="truncate font-display text-[15px] font-medium tracking-tight">{name}</span>
    </span>
  )
}
