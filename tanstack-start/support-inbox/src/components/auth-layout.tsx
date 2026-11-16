import type { ReactNode } from 'react'
import { BrandMark } from './brand'

export function AuthLayout({ title, description, children, footer }: {
  title: string
  description: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="brand-glow relative flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:56px_56px] opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="mb-5 size-10 rounded-xl" />
          <h1 className="font-display text-2xl font-medium tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">{children}</div>
        {footer ? <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div> : null}
      </div>
    </div>
  )
}
