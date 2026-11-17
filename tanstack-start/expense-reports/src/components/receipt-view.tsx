import { useEffect, useRef, useState } from 'react'
import { Download, ReceiptText } from 'lucide-react'
import type { ExpenseDetail } from '#/lib/types'
import { buttonVariants } from './ui/button'
import { EmptyState } from './ui/primitives'

// Email receipts render in a sandboxed iframe: no scripts, no forms, links open
// in a new tab. Same-origin is kept only to measure the content height.
function EmailReceipt({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(320)
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https:; font-src https: data:">
<style>html,body{margin:0;background:#fff;color:#19191c}body{padding:16px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${html}</body></html>`

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    let observer: ResizeObserver | undefined
    const measure = () => {
      const doc = iframe.contentDocument
      if (doc?.documentElement) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 120), 4000))
    }
    const onLoad = () => {
      measure()
      observer?.disconnect()
      if (iframe.contentDocument?.body) {
        observer = new ResizeObserver(measure)
        observer.observe(iframe.contentDocument.body)
      }
    }
    iframe.addEventListener('load', onLoad)
    if (iframe.contentDocument?.readyState === 'complete') onLoad()
    return () => {
      iframe.removeEventListener('load', onLoad)
      observer?.disconnect()
    }
  }, [srcDoc])

  return (
    <iframe
      ref={ref}
      title="Email receipt"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block w-full rounded-lg border bg-white"
      style={{ height }}
    />
  )
}

export function ReceiptView({ expense }: { expense: ExpenseDetail }) {
  if (expense.receipt) {
    const url = `/api/files/${expense.receipt.fileId}`
    const isImage = expense.receipt.type.startsWith('image/') && !/heic|heif/i.test(expense.receipt.type)
    const isPdf = expense.receipt.type === 'application/pdf'
    return (
      <div className="grid gap-3">
        {isImage ? (
          <a href={`${url}?inline=1`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-muted/40">
            <img src={`${url}?inline=1`} alt={`Receipt from ${expense.merchant}`} className="mx-auto max-h-[32rem] w-auto object-contain" />
          </a>
        ) : isPdf ? (
          <object data={`${url}?inline=1`} type="application/pdf" className="h-[32rem] w-full rounded-lg border bg-white">
            <p className="p-4 text-sm text-muted-foreground">This browser can't preview PDFs. Download the receipt instead.</p>
          </object>
        ) : (
          <p className="text-sm text-muted-foreground">Preview isn't available for this file type.</p>
        )}
        <a href={url} className={buttonVariants({ variant: 'outline', size: 'sm', className: 'w-fit' })}>
          <Download />
          {expense.receipt.name || 'Download receipt'}
        </a>
      </div>
    )
  }

  if (expense.emailHtml) return <EmailReceipt html={expense.emailHtml} />
  if (expense.emailText) {
    return <pre className="max-h-[32rem] overflow-auto rounded-lg border bg-card p-4 text-sm whitespace-pre-wrap">{expense.emailText}</pre>
  }

  return (
    <EmptyState
      className="rounded-lg border border-dashed py-10"
      icon={<ReceiptText />}
      title="No receipt"
      description="Edit the expense to attach a photo or PDF, or forward the receipt by email."
    />
  )
}
