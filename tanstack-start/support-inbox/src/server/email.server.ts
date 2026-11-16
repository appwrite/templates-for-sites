const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function linkify(escaped: string) {
  return escaped.replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
    (url) => `<a href="${url}" style="color:#fd366e">${url}</a>`,
  )
}

function paragraphs(text: string) {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px">${linkify(escapeHtml(block)).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// Plain-text composer output becomes a small, client-safe HTML email.
export function renderReplyHtml(body: string, signature: string) {
  const signatureHtml = signature.trim()
    ? `<div style="margin-top:18px;color:#6b6b70">${paragraphs(signature)}</div>`
    : ''
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;font-size:14px;line-height:1.6;color:#19191c">${paragraphs(body)}${signatureHtml}</div>`
}

export function replySubject(subject: string, ref: string) {
  const base = subject.replace(/\s*\[#\d{6}\]\s*/g, ' ').trim() || '(no subject)'
  return `${/^re:/i.test(base) ? base : `Re: ${base}`} [#${ref}]`
}

// support@x.appwrite.email + 482913 -> support+482913@x.appwrite.email
export function replyAddress(mailbox: string, ref: string) {
  const [local, domain] = mailbox.split('@')
  return `${local.split('+')[0]}+${ref}@${domain}`
}

export function previewOf(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240)
}
