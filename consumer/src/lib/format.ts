import { toIntlLocale } from '@/i18n/languages'
import type { SiteStatus } from './status'
export function formatNumber(value: number, locale?: string, digits?: FractionDigits): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 4,
    ...digits,
  }).format(value)
}
type FractionDigits = Pick<
  Intl.NumberFormatOptions,
  'minimumFractionDigits' | 'maximumFractionDigits'
>
type MoneyFormatOptions = FractionDigits & Pick<Intl.NumberFormatOptions, 'currencyDisplay'>

export function formatMoney(
  value: number,
  currency = 'USD',
  locale?: string,
  options?: MoneyFormatOptions,
): string {
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'currency',
    currency,
    maximumFractionDigits: 6,
    minimumFractionDigits: 2,
    ...options,
  }).format(value)
}
/** Apply the site's monetary display settings to an amount already expressed in system USD. */
export function formatDisplayCurrencyFromUSD(
  usd: number,
  status?: SiteStatus,
  locale?: string,
  digits?: FractionDigits,
): string {
  if (status?.quota_display_type === 'CUSTOM') {
    const symbol = status.custom_currency_symbol?.trim() || '¤'
    const value = usd * (status.custom_currency_exchange_rate || 1)
    return symbol + formatNumber(value, locale, { maximumFractionDigits: 6, ...digits })
  }
  const options = { ...digits, currencyDisplay: 'narrowSymbol' } as const
  if (status?.quota_display_type === 'CNY')
    return formatMoney(usd * (status.usd_exchange_rate || 1), 'CNY', locale, options)
  return formatMoney(usd, 'USD', locale, options)
}
/** 只转换服务端额度的展示单位，不参与报价、支付或实际结算。 */
export function formatQuota(
  quota: number,
  status?: SiteStatus,
  locale?: string,
  digits?: FractionDigits,
): string {
  if (!status?.quota_per_unit || status.quota_display_type === 'TOKENS')
    return `${formatNumber(quota, locale)} quota`
  return formatDisplayCurrencyFromUSD(quota / status.quota_per_unit, status, locale, digits)
}
/** Monetary balance and allowance summaries use cents; request charges retain their precision. */
export function formatBalance(quota: number, status?: SiteStatus, locale?: string): string {
  return formatQuota(quota, status, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatDate(timestamp: number, locale?: string): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp * 1000))
}

/** Display an observed duration; missing measurements remain distinct from a recorded zero. */
export function formatDurationMilliseconds(
  milliseconds: number | null | undefined,
  locale?: string,
  display: 'localized' | 'abbreviated' = 'localized',
): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0)
    return '—'
  let divisor = 1
  let unit = 'millisecond'
  if (milliseconds >= 3_600_000) {
    divisor = 3_600_000
    unit = 'hour'
  } else if (milliseconds >= 60_000) {
    divisor = 60_000
    unit = 'minute'
  } else if (milliseconds >= 1000) {
    divisor = 1000
    unit = 'second'
  }
  if (display === 'abbreviated') {
    const symbol = { millisecond: 'ms', second: 's', minute: 'min', hour: 'h' }[unit]
    return `${formatNumber(milliseconds / divisor, locale, { maximumFractionDigits: 2 })} ${symbol}`
  }
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 2,
  }).format(milliseconds / divisor)
}
