import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '#/lib/utils'

export async function copyText(value: string) {
  await navigator.clipboard.writeText(value)
  toast.success('Copied')
}

export function CopyValue({ value, className }: { value: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => copyText(value)}
      title="Copy"
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-xs text-foreground transition hover:border-ring',
        className,
      )}
    >
      <span className="truncate">{value}</span>
      <Copy className="size-3 shrink-0 text-muted-foreground" />
    </button>
  )
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={cn('group relative rounded-lg border bg-muted/50 dark:bg-background', className)}>
      <button
        type="button"
        aria-label="Copy code"
        onClick={async () => {
          await navigator.clipboard.writeText(code)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
        className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
      <pre className="scrollbar-thin overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}
