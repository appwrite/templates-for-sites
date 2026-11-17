import { useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment } from '#/lib/types'

const QUOTE_SELECTORS = [
  '.gmail_quote',
  '.gmail_extra',
  'blockquote[type="cite"]',
  '.yahoo_quoted',
  '.moz-cite-prefix',
  '#divRplyFwdMsg',
  '#divRplyFwdMsg ~ *',
  '#appendonsend ~ *',
]

export function hasQuotedHtml(html: string) {
  return /gmail_quote|type="cite"|yahoo_quoted|divRplyFwdMsg|appendonsend|moz-cite-prefix/i.test(html)
}

function buildDocument(html: string, attachments: Attachment[], hideQuoted: boolean) {
  // Inline images reference cid:<content-id>; point them at the attachment proxy.
  let body = html
  for (const attachment of attachments) {
    const cid = attachment.contentId.replace(/^<|>$/g, '')
    if (!cid) continue
    body = body.split(`cid:${cid}`).join(`/api/files/${attachment.fileId}?inline=1`)
  }

  const hide = hideQuoted ? `${QUOTE_SELECTORS.join(',')}{display:none!important}` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' https: http: data:; style-src 'unsafe-inline' https:; font-src https: data:">
<style>
html,body{margin:0;padding:0;background:#fff;color:#19191c}
body{padding:20px 22px;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto}
table{max-width:100%}
a{color:#e8336a}
blockquote{margin:0 0 0 .6em;padding-left:.9em;border-left:3px solid #e4e4e7;color:#52525b}
pre{white-space:pre-wrap}
${hide}
</style></head><body>${body}</body></html>`
}

// Untrusted email HTML renders in a sandboxed iframe: no scripts, no forms,
// links open in a new tab. Same-origin is kept only to measure its height.
export function EmailFrame({ html, attachments, hideQuoted }: { html: string; attachments: Attachment[]; hideQuoted: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(160)
  const srcDoc = useMemo(() => buildDocument(html, attachments, hideQuoted), [html, attachments, hideQuoted])

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    let observer: ResizeObserver | undefined

    const measure = () => {
      const doc = iframe.contentDocument
      if (doc?.documentElement) setHeight(Math.min(Math.max(doc.documentElement.scrollHeight, 48), 24_000))
    }
    const onLoad = () => {
      measure()
      observer?.disconnect()
      const body = iframe.contentDocument?.body
      if (body) {
        observer = new ResizeObserver(measure)
        observer.observe(body)
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
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="block w-full rounded-lg border bg-white"
      style={{ height }}
    />
  )
}
