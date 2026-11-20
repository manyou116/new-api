import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Database,
  CircleCheck,
  CircleHelp,
  CircleX,
  Receipt,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { Badge, CopyButton } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatDurationMilliseconds, formatNumber, formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { BillingDetails } from './BillingDetails'
import { usageCache, usageDetails, usageMetric, usageTiming } from './chart'
import { latencyBand, usageModelName } from './presentation'
import type { UsageLog } from './UsagePage'

/** Billing records alone do not prove that an upstream response finished. */
export function RequestStatus(props: { log: UsageLog }) {
  const { t } = useTranslation()
  const stream = usageDetails(props.log.other).stream_status
  let state = 'other'
  let label = t('Other')
  let Icon = CircleHelp
  if (props.log.type === 5) {
    state = 'error'
    label = t('Errors')
    Icon = CircleX
  } else if (props.log.type === 6) {
    state = 'refund'
    label = t('Refunds')
    Icon = RotateCcw
  } else if (props.log.type === 2) {
    state = 'consumption'
    label = t('Consumption')
    Icon = Receipt
    if (stream && typeof stream === 'object' && 'status' in stream) {
      if (stream.status === 'error') {
        state = 'interrupted'
        label = t('Interrupted')
        Icon = TriangleAlert
      } else if (stream.status === 'ok') {
        state = 'completed'
        label = t('Completed')
        Icon = CircleCheck
      }
    }
  }
  return (
    <Badge className="usage-request-status" data-request-state={state}>
      <Icon size={13} aria-hidden />
      {label}
    </Badge>
  )
}

/** A readable summary, with the recorded pricing audit available on demand. */
export function RequestDetails(props: { log: UsageLog }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  const log = props.log
  const metric = usageMetric(log)
  const timing = usageTiming(log)
  const cache = log.type === 2 ? usageCache(log.other, log.prompt_tokens) : undefined
  const details = usageDetails(log.other)
  const amount = formatQuota(log.quota, site.data, locale)
  const first = timing.firstResponse
  const tiered = details.billing_mode === 'tiered_expr'
  const stream = details.stream_status
  const interrupted = Boolean(
    log.type === 2 &&
    stream &&
    typeof stream === 'object' &&
    'status' in stream &&
    stream.status === 'error',
  )
  const tokenSummary = (
    <>
      {log.type === 2 &&
        (metric.kind === 'tokens' ? (
          <section className="request-token-section" aria-label={t('Token usage')}>
            <dl className="request-metric-grid">
              <div>
                <dt>
                  <ArrowDown size={14} aria-hidden="true" />
                  {t('Input tokens')}
                </dt>
                <dd>{formatNumber(cache?.total ?? log.prompt_tokens, locale)}</dd>
              </div>
              <div>
                <dt>
                  <ArrowUp size={14} aria-hidden="true" />
                  {t('Output tokens')}
                </dt>
                <dd>{formatNumber(log.completion_tokens, locale)}</dd>
              </div>
              <div>
                <dt>
                  <Database size={15} aria-hidden="true" />
                  {t('Cache read tokens')}
                </dt>
                <dd>
                  {cache?.read === undefined ? t('Not recorded') : formatNumber(cache.read, locale)}
                </dd>
              </div>
              <div>
                <dt>{t('Cache write tokens')}</dt>
                <dd>
                  {cache?.write === undefined
                    ? t('Not recorded')
                    : formatNumber(cache.write, locale)}
                </dd>
              </div>
            </dl>
            <div className="request-cache-share">
              <span>{t('Cache status')}</span>
              <strong>
                {cache?.read === undefined
                  ? t('Not recorded')
                  : t(cache.read > 0 ? 'Cache hit' : 'Cache miss')}
              </strong>
            </div>
            <div className="request-cache-share">
              <span>
                {t('Cache read share')}
                <small className="cache-rate-caption">{t('Cached share of input tokens')}</small>
              </span>
              <strong>
                {cache?.share === undefined
                  ? t('Not recorded')
                  : `${formatNumber(cache.share, locale, { maximumFractionDigits: 1 })}%`}
              </strong>
              {cache?.share !== undefined && (
                <progress aria-label={t('Cache read share')} value={cache.share} max={100} />
              )}
            </div>
            <p className="muted usage-filter-help">
              {t('Cache share = reused input / total input. Missing data is not zero.')}
            </p>
          </section>
        ) : (
          <strong>
            {metric.count === undefined
              ? t('Image count not recorded')
              : t('{{count}} images', { count: formatNumber(metric.count, locale) })}
          </strong>
        ))}
    </>
  )
  return (
    <div className="request-details">
      <header className="request-detail-heading">
        <div>
          <strong>{usageModelName(log.model_name)}</strong>
          <div className="usage-record-tags">
            <RequestStatus log={log} />
            <Badge>{log.group}</Badge>
            <span>{formatDate(log.created_at, locale)}</span>
            {log.is_stream && <span>{t('Streaming')}</span>}
          </div>
        </div>
      </header>
      {log.type === 5 && (
        <section className="request-failure-details" aria-label={t('Error details')}>
          <strong>{t('Error details')}</strong>
          <p>{log.content?.trim() ? t(log.content) : t('Not recorded')}</p>
          <p className="muted usage-filter-help">
            {t(
              'An automatic retry may succeed. This error record does not determine the final request outcome.',
            )}
          </p>
        </section>
      )}
      {interrupted && (
        <p className="request-failure-details">
          {t(
            'The response stream did not finish normally. Recorded usage and charges are shown separately.',
          )}
        </p>
      )}
      {(log.type === 2 || log.type === 5) && (
        <section aria-label={t('Response performance')}>
          <dl className="request-timing-grid">
            {log.type === 2 && metric.kind === 'tokens' && (
              <div>
                <dt>{t('First response latency')}</dt>
                <dd
                  data-latency={latencyBand(first)}
                  title={t(
                    'Time to the first upstream stream event; this may precede the first text token.',
                  )}
                >
                  {formatDurationMilliseconds(
                    first === undefined ? undefined : first * 1000,
                    locale,
                    'abbreviated',
                  )}
                </dd>
              </div>
            )}
            <div>
              <dt>{t('Total duration')}</dt>
              <dd>
                {formatDurationMilliseconds(
                  timing.duration === undefined ? undefined : timing.duration * 1000,
                  locale,
                  'abbreviated',
                )}
              </dd>
            </div>
            <div>
              <dt>{t('Recorded amount')}</dt>
              <dd>{amount}</dd>
            </div>
          </dl>
        </section>
      )}
      {log.type !== 2 && log.type !== 5 && (
        <p>
          {t('Recorded amount')} <strong>{amount}</strong>
        </p>
      )}
      {log.type === 2 && tiered && (
        <BillingDetails other={log.other} amount={amount} siteStatus={site.data} />
      )}
      {tiered && metric.kind === 'tokens' ? (
        <details className="request-billing-disclosure">
          <summary>{t('Token usage')}</summary>
          {tokenSummary}
        </details>
      ) : (
        tokenSummary
      )}
      {log.type === 2 && !tiered && (
        <details className="request-billing-disclosure">
          <summary>{t('Billing details')}</summary>
          <BillingDetails other={log.other} />
        </details>
      )}
      {timing.tokensPerSecond !== undefined && (
        <p
          className="muted request-throughput"
          title={t(
            'Speed includes waiting time; only streamed text with recorded output and duration is measured.',
          )}
        >
          {t('Average output speed')}:{' '}
          {formatNumber(timing.tokensPerSecond, locale, { maximumFractionDigits: 2 })} token/s
        </p>
      )}
      <footer className="request-detail-footer">
        <dl className="details-list">
          <div>
            <dt>{t('Model ID')}</dt>
            <dd>
              <code>{log.model_name || '—'}</code>
            </dd>
          </div>
          <div>
            <dt>{t('API key')}</dt>
            <dd>{log.token_name || t('Website')}</dd>
          </div>
          <div>
            <dt>{t('Request ID')}</dt>
            <dd className="request-detail-id">
              <code>{log.request_id || '—'}</code>
              {log.request_id && <CopyButton value={log.request_id} label={t('Copy request ID')} />}
            </dd>
          </div>
        </dl>
      </footer>
    </div>
  )
}
