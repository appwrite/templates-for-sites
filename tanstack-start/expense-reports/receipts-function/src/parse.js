import { createHash } from 'node:crypto';

// Deterministic IDs keep every write idempotent when a mail server retries.
export function hashId(prefix, value) {
  return prefix + createHash('sha256').update(value).digest('hex').slice(0, 31);
}

// Decodes RFC 2047 encoded words such as "=?UTF-8?B?...?=".
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
                text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
                'latin1'
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return match;
      }
    });
}

export function parseAddress(value) {
  const input = decodeWords(value).trim();
  if (!input) return { name: '', email: '' };
  const angled = input.match(/^(.*?)<([^<>\s]+@[^<>\s]+)>/);
  if (angled) {
    return { name: angled[1].trim().replace(/^"(.*)"$/, '$1').trim(), email: angled[2].toLowerCase() };
  }
  const bare = input.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return { name: '', email: bare ? bare[0].toLowerCase() : '' };
}

export function normalizeMessageId(id) {
  const trimmed = String(id ?? '').trim();
  if (!trimmed) return '';
  return (trimmed.startsWith('<') ? trimmed : `<${trimmed}>`).slice(0, 512);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', pound: '£', yen: '¥' };

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td|\/th)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, entity) => {
      if (entity[0] === '#') {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    })
    .replace(/[ \t ]+/g, ' ');
}

const SYMBOLS = { 'US$': 'USD', 'CA$': 'CAD', C$: 'CAD', A$: 'AUD', S$: 'SGD', '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '¥': 'JPY' };
const CODES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'SGD', 'NZD', 'SEK', 'NOK', 'DKK', 'BRL', 'MXN', 'ZAR', 'AED', 'HKD'];
const NUMBER = String.raw`(\d{1,3}(?:[,.\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)`;
const PREFIX = String.raw`(US\$|CA\$|C\$|A\$|S\$|[$€£₹¥]|\b(?:${CODES.join('|')})\b)\s?`;
const MONEY = new RegExp(`(?:${PREFIX}${NUMBER})|(?:${NUMBER}\\s?(€|\\b(?:${CODES.join('|')})\\b))`, 'g');
const TOTAL_LINE = /\b(grand total|total|amount (?:paid|due|charged)|you paid|charged|balance due|order total)\b/i;

// "1,234.56", "1.234,56", "1 234,56" and "12,50" all become numbers.
export function toNumber(raw) {
  const value = raw.replace(/\s/g, '');
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let normalized = value;
  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (lastComma > -1) {
    normalized = value.length - lastComma - 1 === 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    // "1.234" reads as thousands, not 1.234.
    normalized = value.replace(/\./g, '');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function currencyOf(token) {
  if (!token) return null;
  const upper = token.toUpperCase();
  return SYMBOLS[token] ?? (CODES.includes(upper) ? upper : null);
}

export function minorUnits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function amountsIn(line) {
  const found = [];
  for (const match of line.matchAll(MONEY)) {
    const [, prefix, prefixed, suffixed, suffix] = match;
    const value = toNumber(prefixed ?? suffixed ?? '');
    const currency = currencyOf(prefix ?? suffix);
    if (value !== null && value > 0) found.push({ value, currency });
  }
  return found;
}

// Prefers the amount on a "Total" line; otherwise takes the largest amount.
export function findAmount(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const totals = [];
  const all = [];
  for (const line of lines) {
    const amounts = amountsIn(line);
    all.push(...amounts);
    if (!TOTAL_LINE.test(line) || /\bsub-?total\b/i.test(line)) continue;
    if (amounts.length) {
      totals.push(amounts[amounts.length - 1]);
      continue;
    }
    // "Total: 189.40" with no currency marker still counts on a total line.
    const bare = [...line.matchAll(/(\d{1,3}(?:[,.\s]\d{3})*[.,]\d{2})(?!\d)/g)].at(-1);
    const value = bare && toNumber(bare[1]);
    if (value) totals.push({ value, currency: null });
  }
  const grand = lines.findIndex((line) => /\bgrand total\b/i.test(line) && amountsIn(line).length);
  if (grand > -1) return amountsIn(lines[grand]).at(-1);
  if (totals.length) return totals.at(-1);
  if (!all.length) return null;
  return all.reduce((largest, amount) => (amount.value > largest.value ? amount : largest));
}

function cleanSubject(subject) {
  return String(subject ?? '')
    .replace(/^\s*((re|fwd?|fw|aw|tr)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SUBJECT_PATTERNS = [
  /receipt from (.+?)(?:\s*[-–|#(]|$)/i,
  /(?:order|invoice|payment) (?:from|at|to) (.+?)(?:\s*[-–|#(]|$)/i,
  /your (.+?) (?:receipt|order|invoice|trip|ride|booking)/i,
  /^(.+?)\s+(?:receipt|invoice|order confirmation)\b/i,
];

// The original sender of a forwarded email, from the "From:" line in the body.
function forwardedSender(text) {
  const match = String(text ?? '').match(/^\s*>?\s*From:\s*(.+)$/im);
  return match ? parseAddress(match[1]) : null;
}

function merchantFromAddress(address) {
  if (!address) return '';
  if (address.name) return address.name.replace(/\b(receipts?|no-?reply|billing|orders?|support)\b/gi, '').replace(/\s+/g, ' ').trim();
  const domain = address.email.split('@')[1] ?? '';
  const label = domain.split('.').slice(-2, -1)[0] ?? '';
  return label ? label[0].toUpperCase() + label.slice(1) : '';
}

export function findMerchant(subject, text) {
  const forwarded = merchantFromAddress(forwardedSender(text));
  if (forwarded) return forwarded.slice(0, 255);
  const cleaned = cleanSubject(subject);
  for (const pattern of SUBJECT_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 255);
  }
  return (cleaned || 'Unknown merchant').slice(0, 255);
}

export function findDate(text, headerDate, receivedAt) {
  const now = Date.now();
  const valid = (value) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) && time <= now + 86_400_000 && time > now - 400 * 86_400_000 ? new Date(time) : null;
  };
  const forwarded = String(text ?? '').match(/^\s*>?\s*(?:Date|Sent):\s*(.+)$/im);
  const date = (forwarded && valid(forwarded[1].replace(/\s+at\s+/i, ' '))) || valid(headerDate) || valid(receivedAt) || new Date();
  return date.toISOString();
}

export function parseReceipt({ subject, text, html, date, receivedAt, defaultCurrency = 'USD' }) {
  const body = String(text ?? '').trim() ? String(text) : htmlToText(html);
  const amount = findAmount(`${cleanSubject(subject)}\n${body}`);
  const currency = amount?.currency ?? defaultCurrency;
  return {
    merchant: findMerchant(subject, body),
    currency,
    amount: amount ? Math.round(amount.value * 10 ** minorUnits(currency)) : null,
    spentAt: findDate(body, date, receivedAt),
  };
}
