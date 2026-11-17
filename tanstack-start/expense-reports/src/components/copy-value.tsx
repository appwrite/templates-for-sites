import { Copy } from 'lucide-react'
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
