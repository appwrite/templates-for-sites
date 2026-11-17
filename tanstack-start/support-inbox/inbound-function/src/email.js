import { createHash } from 'node:crypto';

// Conversation references are six digits, e.g. "482913". They appear in reply
// subjects as "[#482913]" and in reply-to addresses as "support+482913@…".
export const REF_PATTERN = /^\d{6}$/;

// Deterministic row and file IDs make every write idempotent, so a mail server
// retrying a delivery never files the same email twice.
export function hashId(prefix, value) {
  return prefix + createHash('sha256').update(value).digest('hex').slice(0, 31);
}

// Decodes RFC 2047 encoded words such as "=?UTF-8?B?SMOpbMOobmU=?=".
export function decodeWords(value) {
  if (!value) return '';
  return String(value)
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (match, charset, encoding, text) => {
      try {
        const bytes =
          encoding.toUpperCase() === 'B'
            ? Buffer.from(text, 'base64')
            : Buffer.from(
                text
                  .replace(/_/g, ' ')
                  .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
                'latin1'
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return match;
      }
    });
}

// Parses the first address of a header value like `"Doe, Jane" <jane@example.com>`.
export function parseAddress(value) {
  const input = decodeWords(value).trim();
  if (!input) return { name: '', email: '' };

  const angled = input.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>/);
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"').trim();
    return { name, email: angled[2].toLowerCase() };
  }

  const bare = input.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return { name: '', email: bare ? bare[0].toLowerCase() : '' };
}

export function sameAddress(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// "support+482913@x.appwrite.email" -> "482913"
export function plusTag(address) {
  const local = String(address ?? '').split('@')[0] ?? '';
  const tag = local.includes('+') ? local.slice(local.indexOf('+') + 1) : '';
  return REF_PATTERN.test(tag) ? tag : '';
}

// "support+482913@x.appwrite.email" -> "support@x.appwrite.email"
export function stripTag(address) {
  const [local = '', domain = ''] = String(address ?? '').toLowerCase().split('@');
  return domain ? `${local.split('+')[0]}@${domain}` : local;
}

export function subjectRef(subject) {
  return String(subject ?? '').match(/\[#(\d{6})\]/)?.[1] ?? '';
}

export function cleanSubject(subject) {
  const cleaned = String(subject ?? '')
    .replace(/\s*\[#\d{6}\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || '(no subject)').slice(0, 512);
}

// Collects every "<id@host>" from In-Reply-To and References header values.
export function extractMessageIds(values) {
  const ids = String((values ?? []).join(' ')).match(/<[^<>\s]+>/g) ?? [];
  return [...new Set(ids)].filter((id) => id.length <= 512);
}

export function normalizeMessageId(id) {
  const trimmed = String(id ?? '').trim();
  if (!trimmed) return '';
  return (trimmed.startsWith('<') ? trimmed : `<${trimmed}>`).slice(0, 512);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    });
}

// A one-line summary of the new part of a message, without quoted history.
export function previewOf(text, html) {
  const source = String(text ?? '').trim() ? String(text) : htmlToText(html);
  const kept = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^On .{4,200}wrote:$/i.test(trimmed) || /^-{2,}\s*(Original|Forwarded) Message/i.test(trimmed)) break;
    if (/^From:\s/i.test(trimmed) && kept.length > 0) break;
    if (trimmed.startsWith('>')) continue;
    kept.push(trimmed);
  }
  return kept.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function safeFileName(name) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, 120);
  return cleaned || 'attachment';
}
