import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toIntlLocale } from '@/i18n/languages'
import { formatMoney, formatNumber } from '@/lib/format'
import type { SiteStatus } from '@/lib/status'
import { PriceExplanation } from '@/components/model-price'
import { recordedContextRates, recordedTier } from './billing'
import { ContextTierReceipt } from './ContextTierReceipt'
import { usageCache, usageDetails } from './chart'

/** Explicit public field list: never render arbitrary metadata or privileged scopes. */
export function BillingDetails(props: { other: string; amount?: string; siteStatus?: SiteStatus }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const details = usageDetails(props.other)
  const cache = usageCache(props.other)
  const tier = details.billing_mode === 'tiered_expr' ? recordedTier(details) : undefined
  const quantities = [
    ['input_tokens_total', 'Total input tokens'],
    ['cache_tokens', 'Cache read tokens'],
    ['cache_write_tokens', 'Cache write tokens'],
    ['cache_creation_tokens_5m', 'Cache write tokens (5m)'],
    ['cache_creation_tokens_1h', 'Cache write tokens (1h)'],
    ['image_cache_tokens', 'Image cache tokens'],
    ['image_output', 'Image tokens'],
    ['audio_input_token_count', 'Audio input tokens'],
  ] as const
  const ratios = [
    ['model_ratio', 'Model multiplier'],
    ['completion_ratio', 'Output multiplier'],
    ['group_ratio', 'Group multiplier'],
    ['user_group_ratio', 'User group multiplier'],
    ['cache_ratio', 'Cache read multiplier'],
    ['cache_creation_ratio', 'Cache write multiplier'],
    ['cache_creation_ratio_5m', 'Cache write multiplier (5m)'],
    ['cache_creation_ratio_1h', 'Cache write multiplier (1h)'],
  ] as const
  let mode = t('Not recorded')
  if (details.billing_mode === 'tiered_expr') mode = t('Dynamic pricing')
  else if (typeof details.model_price === 'number' && details.model_price >= 0)
    mode = t('Fixed price')
  else if (typeof details.model_ratio === 'number') mode = t('Token pricing')
  const billingTokens = details.billing_tokens
  const recordedTokens =
    billingTokens && typeof billingTokens === 'object' && !Array.isArray(billingTokens)
      ? (billingTokens as Record<string, unknown>)
      : {}
  const contextLength = recordedTokens.len ?? details.input_tokens_total
  const rates =
    tier && props.amount !== undefined && details.billing_unit === 'token'
      ? recordedContextRates(details.billing_explanation, recordedTokens.len, details.matched_tier)
      : undefined
  let conditionContent: ReactNode = t('Tier conditions were not recorded or could not be read.')
  if (tier?.conditions) {
    conditionContent = t('No tier condition')
    if (tier.conditions.length) {
      conditionContent = <code className="billing-condition">{tier.conditions.join(' && ')}</code>
    }
  }
  const groupRatio = details.user_group_ratio
  const appliedGroupRatio =
    typeof groupRatio === 'number' && groupRatio >= 0 ? groupRatio : details.group_ratio
  const tokenFields = [
    ['p', 'Billable input tokens'],
    ['c', 'Billable output tokens'],
    ['cr', 'Billable cache read tokens'],
    ['cc', 'Billable cache write tokens'],
    ['cc1h', 'Billable cache write tokens (1h)'],
    ['img', 'Billable image input tokens'],
    ['img_o', 'Billable image output tokens'],
    ['img_cr', 'Billable image cache tokens'],
    ['ai', 'Billable audio input tokens'],
    ['ao', 'Billable audio output tokens'],
  ] as const
  const audit = (
    <>
      <dl className="details-list">
        <div>
          <dt>{t('Pricing mode')}</dt>
          <dd>{mode}</dd>
        </div>
        {(details.billing_unit === 'request' || details.billing_unit === 'token') && (
          <div>
            <dt>{t('Billing unit')}</dt>
            <dd>{t(details.billing_unit === 'token' ? 'Tokens' : 'Request')}</dd>
          </div>
        )}
        {quantities.map(([key, label]) => {
          let value = details[key]
          if (key === 'cache_write_tokens') value = cache?.write
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{formatNumber(value, locale)}</dd>
            </div>
          )
        })}
        {ratios.map(([key, label]) => {
          if (
            details.billing_mode === 'tiered_expr' &&
            key !== 'group_ratio' &&
            key !== 'user_group_ratio'
          )
            return null
          const value = details[key]
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>{t(label)}</dt>
              <dd>{formatNumber(value, locale)}×</dd>
            </div>
          )
        })}
        {(['model_price', 'fixed_price'] as const).map((key) => {
          if (key === 'model_price' && details.billing_mode === 'tiered_expr') return null
          const value = details[key]
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
          return (
            <div key={key}>
              <dt>
                {t(
                  key === 'fixed_price'
                    ? 'Matched fixed price (USD)'
                    : 'Recorded model price (USD)',
                )}
              </dt>
              <dd>{formatMoney(value, 'USD', locale)}</dd>
            </div>
          )
        })}
      </dl>
      {typeof details.request_path === 'string' && (
        <p>
          {t('Request path')}: <code>{details.request_path}</code>
        </p>
      )}
      {!!details.usage_facts &&
        typeof details.usage_facts === 'object' &&
        !Array.isArray(details.usage_facts) && (
          <section aria-label={t('Recorded usage facts')}>
            <h3>{t('Recorded usage facts')}</h3>
            <dl className="details-list">
              {Object.entries(details.usage_facts).map(([key, value]) => {
                if (
                  typeof value !== 'string' &&
                  (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
                )
                  return null
                return (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{typeof value === 'number' ? formatNumber(value, locale) : value}</dd>
                  </div>
                )
              })}
            </dl>
          </section>
        )}
      {Object.keys(recordedTokens).length > 0 && (
        <section aria-label={t('Billable token breakdown')}>
          <h3>{t('Billable token breakdown')}</h3>
          <dl className="details-list">
            {tokenFields.map(([key, label]) => {
              const value = recordedTokens[key]
              if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
              return (
                <div key={key}>
                  <dt>{t(label)}</dt>
                  <dd>{formatNumber(value, locale)}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      )}
      {Array.isArray(details.request_rules) && details.request_rules.length > 0 && (
        <details>
          <summary>{t('Request pricing rules')}</summary>
          {details.request_rules.map((item: unknown, index) => {
            if (!item || typeof item !== 'object') return null
            const rule = item as Record<string, unknown>
            if (
              typeof rule.cond !== 'string' ||
              typeof rule.multiplier !== 'number' ||
              !Number.isFinite(rule.multiplier) ||
              typeof rule.matched !== 'boolean'
            )
              return null
            return (
              <p key={index}>
                {rule.cond} · {formatNumber(rule.multiplier, locale)}× ·{' '}
                {t(rule.matched ? 'Applied' : 'Not applied')}
              </p>
            )
          })}
        </details>
      )}
      {tier?.expression && (
        <details className="billing-expression">
          <summary>{t('Recorded billing expression')}</summary>
          <code>{tier.expression}</code>
        </details>
      )}
      <p className="muted">
        {t(
          'Recorded server billing data. Cache categories may overlap input tokens; amounts are not recalculated here.',
        )}
      </p>
    </>
  )
  return (
    <section className="stack billing-details" aria-label={t('Billing details')}>
      {props.amount !== undefined && <h3>{t('Billing details')}</h3>}
      {tier && !rates && (
        <section className="billing-tier-summary" aria-label={t('Matched tier conditions')}>
          <dl className="details-list">
            <div>
              <dt>{t('Pricing tier')}</dt>
              <dd>
                {typeof details.matched_tier === 'string' && details.matched_tier
                  ? details.matched_tier
                  : t('Not recorded')}
              </dd>
            </div>
            <div>
              <dt>{t('Matched tier conditions')}</dt>
              <dd>{conditionContent}</dd>
            </div>
          </dl>

          <dl className="details-list">
            <div>
              <dt>{t('Input context length')} (len)</dt>
              <dd>
                {typeof contextLength === 'number' &&
                Number.isSafeInteger(contextLength) &&
                contextLength >= 0
                  ? formatNumber(contextLength, locale)
                  : t('Not recorded')}
              </dd>
            </div>
          </dl>
        </section>
      )}
      {rates && typeof recordedTokens.len === 'number' && (
        <ContextTierReceipt
          rates={rates}
          length={recordedTokens.len}
          quantities={recordedTokens}
          siteStatus={props.siteStatus}
        />
      )}
      {details.billing_mode === 'tiered_expr' && !rates && (
        <PriceExplanation
          value={details.billing_explanation}
          historical
          quantities={props.amount !== undefined ? recordedTokens : undefined}
          siteStatus={props.siteStatus}
        />
      )}
      {props.amount !== undefined &&
        tier &&
        typeof appliedGroupRatio === 'number' &&
        Number.isFinite(appliedGroupRatio) &&
        appliedGroupRatio >= 0 && (
          <div className="billing-receipt-ratio">
            <span>{t('Group multiplier')}</span>
            <span>{formatNumber(appliedGroupRatio, locale)}×</span>
          </div>
        )}
      {props.amount !== undefined && (
        <>
          {details.billing_unit === 'token' && (
            <p className="muted price-note">
              {t(
                'Line amounts show the token calculation. The recorded charge reflects settlement.',
              )}
            </p>
          )}
          <div className="billing-receipt-total">
            <span>{t('Recorded amount')}</span>
            <strong>{props.amount}</strong>
          </div>
        </>
      )}
      {props.amount !== undefined ? (
        <details className="billing-receipt-audit">
          <summary>{t('Recorded pricing inputs')}</summary>
          <div className="stack">{audit}</div>
        </details>
      ) : (
        audit
      )}
    </section>
  )
}
