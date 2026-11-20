import { useTranslation } from 'react-i18next'
import { tokenPriceLabels } from '@/components/model-price'
import { toIntlLocale } from '@/i18n/languages'
import { formatDisplayCurrencyFromUSD, formatNumber } from '@/lib/format'
import type { SiteStatus } from '@/lib/status'
import type { ContextRates } from './billing'

export function ContextTierReceipt(props: {
  rates: ContextRates
  quantities: Record<string, unknown>
  length: number
  siteStatus?: SiteStatus
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { rates, quantities } = props
  const threshold = formatNumber(rates.threshold, locale)
  const high = props.length > rates.threshold
  const active = high ? rates.above : rates.within
  const fields = Object.keys(tokenPriceLabels).filter(
    (key) => key in rates.within || key in rates.above,
  )
  const lines: { label: string; quantity?: number; rate: number; upper: boolean }[] = []
  for (const key of fields) {
    const rate = active[key]
    if (rate === undefined) continue
    const recorded = quantities[key]
    const quantity =
      typeof recorded === 'number' && Number.isSafeInteger(recorded) && recorded >= 0
        ? recorded
        : undefined
    if (key === 'p' && high && rates.progressive_input) {
      lines.push({
        label: t('Input up to {{limit}}', { limit: threshold }),
        quantity: quantity === undefined ? undefined : Math.min(quantity, rates.threshold),
        rate: rates.within.p!,
        upper: false,
      })
      if (quantity === undefined || quantity > rates.threshold) {
        lines.push({
          label: t('Excess input'),
          quantity: quantity === undefined ? undefined : quantity - rates.threshold,
          rate,
          upper: true,
        })
      }
    } else if (quantity !== 0 || key === 'p') {
      lines.push({ label: t(tokenPriceLabels[key]!), quantity, rate, upper: high })
    }
  }
  const used = new Set(
    lines
      .filter((line) => line.quantity !== undefined && line.quantity > 0)
      .map((line) => line.upper),
  )
  const money = (value: number, precision: number) =>
    Number.isFinite(value)
      ? formatDisplayCurrencyFromUSD(value, props.siteStatus, locale, {
          minimumFractionDigits: precision === 8 ? 4 : 2,
          maximumFractionDigits: precision,
        })
      : '—'
  return (
    <section className="usage-tier-receipt">
      <div className="usage-tier-caption">
        <h4>{t('Tier prices')}</h4>
        <span>{t('Price per million tokens')}</span>
      </div>
      <div className="billing-price-scroll">
        <table className="consumer-table billing-price-table" aria-label={t('Tier prices')}>
          <thead>
            <tr>
              <th scope="col">{t('Input context length')}</th>
              {fields.map((key) => (
                <th key={key} scope="col">
                  {t(tokenPriceLabels[key]!)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[false, true].map((upper) => (
              <tr key={String(upper)} data-matched={used.has(upper)}>
                <th scope="row">
                  {upper ? '>' : '≤'} {threshold}
                  <small>
                    {upper ? rates.above_label : rates.within_label}
                    {used.has(upper) && <> · {t('Applied')}</>}
                  </small>
                </th>
                {fields.map((key) => {
                  const rate = (upper ? rates.above : rates.within)[key]
                  return <td key={key}>{rate === undefined ? '—' : money(rate, 8)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="usage-tier-caption">
        <h4>{t('Charge calculation')}</h4>
        <span>
          {t('Input context length')} · {formatNumber(props.length, locale)}
        </span>
      </div>
      <p className="price-note muted">
        {rates.progressive_input
          ? t('Only billable input above the threshold uses the higher input rate.')
          : t('The matched tier applies to the entire request.')}
      </p>
      <div className="billing-price-scroll">
        <table className="consumer-table billing-price-table" aria-label={t('Charge calculation')}>
          <thead>
            <tr>
              <th scope="col">{t('Billing item')}</th>
              <th scope="col">{t('Billable tokens')}</th>
              <th scope="col">{t('Price per million tokens')}</th>
              <th scope="col">{t('Cost')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.label}>
                <th scope="row">{line.label}</th>
                <td>{line.quantity === undefined ? '—' : formatNumber(line.quantity, locale)}</td>
                <td>{money(line.rate, 8)}</td>
                <td>
                  {line.quantity === undefined
                    ? '—'
                    : money((line.quantity / 1_000_000) * line.rate, 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
