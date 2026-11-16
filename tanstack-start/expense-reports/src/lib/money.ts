// Amounts are stored as integers in the currency's minor unit (cents, pence, yen).
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'INR', 'JPY', 'AUD', 'CAD', 'CHF', 'SGD', 'NZD',
  'SEK', 'NOK', 'DKK', 'BRL', 'MXN', 'ZAR', 'AED', 'HKD',
] as const

export function fractionDigits(currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

export function formatMoney(minor: number, currency: string, options: { compact?: boolean } = {}) {
  const value = minor / 10 ** fractionDigits(currency)
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      notation: options.compact ? 'compact' : 'standard',
      maximumFractionDigits: options.compact ? 1 : undefined,
    }).format(value)
  } catch {
    return `${currency} ${value.toFixed(2)}`
  }
}

// "1,234.5" -> 123450 for USD; returns null for anything that isn't a positive amount.
export function parseMoney(input: string, currency: string) {
  const cleaned = input.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 10 ** fractionDigits(currency))
}

export function toInputAmount(minor: number, currency: string) {
  return (minor / 10 ** fractionDigits(currency)).toFixed(fractionDigits(currency))
}

export function formatTotals(totals: Record<string, number>) {
  const entries = Object.entries(totals).filter(([, amount]) => amount > 0)
  if (entries.length === 0) return formatMoney(0, Object.keys(totals)[0] ?? 'USD')
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(' · ')
}
