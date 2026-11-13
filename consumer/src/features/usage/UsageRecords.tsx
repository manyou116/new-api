import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge, Button } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatDurationMilliseconds, formatNumber, formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { usageCache, usageMetric, usageTiming } from './chart'
import { RequestStatus } from './RequestDetails'
import type { UsageLog } from './UsagePage'

export function UsageRecords(props: {
  logs: UsageLog[]
  busy: boolean
  stale: boolean
  onSelect: (log: UsageLog) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  return (
    <div className="usage-records" aria-busy={props.busy}>
      <table className="consumer-table usage-record-table">
        <thead>
          <tr>
            <th>{t('Request')}</th>
            <th>
              {t('Usage quantity')}
              <small className="cache-rate-caption">{t('Input / output tokens')}</small>
            </th>
            <th>{t('Cache read tokens')}</th>
            <th>{t('Cost')}</th>
            <th>{t('Details')}</th>
          </tr>
        </thead>
        <tbody>
          {props.logs.map((log) => {
            const metric = usageMetric(log)
            const timing = usageTiming(log)
            const cache = log.type === 2 ? usageCache(log.other, log.prompt_tokens) : undefined
            return (
              <tr key={log.id}>
                <td data-label={t('Request')}>
                  <div className="usage-context">
                    <strong title={log.model_name}>{log.model_name || '—'}</strong>
                    <span className="usage-record-date">{formatDate(log.created_at, locale)}</span>
                    <div className="usage-record-tags">
                      {log.group && <Badge>{log.group}</Badge>}
                      <RequestStatus log={log} />
                      <span title={log.token_name}>{log.token_name || t('Website')}</span>
                    </div>
                    <small className="usage-record-id" title={log.request_id}>
                      {log.request_id}
                    </small>
                  </div>
                </td>
                <td
                  data-label={t(
                    metric.kind === 'tokens' ? 'Input / output tokens' : 'Usage quantity',
                  )}
                >
                  <div className="usage-record-metrics">
                    {log.type !== 2 && <span>—</span>}
                    {log.type === 2 && metric.kind === 'images' && (
                      <>
                        <strong>
                          {metric.count === undefined
                            ? t('Image count not recorded')
                            : t('{{count}} images', { count: formatNumber(metric.count, locale) })}
                        </strong>
                        <span>
                          {t('Total duration')}:{' '}
                          {formatDurationMilliseconds(
                            timing.duration === undefined ? undefined : timing.duration * 1000,
                            locale,
                          )}
                        </span>
                      </>
                    )}
                    {log.type === 2 && metric.kind === 'tokens' && (
                      <>
                        <strong>
                          <span className="sr-only">{t('Input / output tokens')}: </span>
                          {formatNumber(cache?.total ?? log.prompt_tokens, locale)} /{' '}
                          {formatNumber(log.completion_tokens, locale)}
                        </strong>
                        <span
                          title={t(
                            'Speed includes waiting time; only streamed text with recorded output and duration is measured.',
                          )}
                        >
                          <span className="sr-only">{t('Average output speed')}: </span>
                          {timing.tokensPerSecond === undefined
                            ? '—'
                            : `${formatNumber(timing.tokensPerSecond, locale, { maximumFractionDigits: 2 })} token/s`}
                          {timing.tokensPerSecond === undefined &&
                            log.completion_tokens === 0 &&
                            ` · ${t('No output tokens recorded')}`}
                        </span>
                        <span className="usage-record-timing">
                          {t('First response latency')}:{' '}
                          {timing.firstResponse === undefined
                            ? t('Not recorded')
                            : formatDurationMilliseconds(timing.firstResponse * 1000, locale)}
                          {' · '}
                          {t('Total duration')}:{' '}
                          {timing.duration === undefined
                            ? t('Not recorded')
                            : formatDurationMilliseconds(timing.duration * 1000, locale)}
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td data-label={t('Cache read tokens')}>
                  {log.type === 2 && metric.kind === 'tokens' ? (
                    <div className="usage-record-metrics">
                      <strong>
                        <span className="sr-only">{t('Cache read tokens')}: </span>
                        {cache?.read === undefined
                          ? t('Not recorded')
                          : formatNumber(cache.read, locale)}
                      </strong>
                      {cache?.share !== undefined && (
                        <span>
                          {formatNumber(cache.share, locale, { maximumFractionDigits: 1 })}%
                          <small className="cache-rate-caption">
                            {t('Cached share of input tokens')}
                          </small>
                        </span>
                      )}
                      {cache?.write !== undefined && (
                        <span>
                          {t('Cache write tokens')}: {formatNumber(cache.write, locale)}
                        </span>
                      )}
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
                <td data-label={t('Cost')} className="usage-record-cost">
                  {formatQuota(log.quota, site.data, locale)}
                </td>
                <td data-label={t('Details')} className="usage-record-action">
                  <Button
                    disabled={props.stale}
                    variant="ghost"
                    title={t('View request {{id}}', { id: log.request_id || log.id })}
                    onClick={() => props.onSelect(log)}
                  >
                    <span>{t('View')}</span>
                    <ArrowUpRight size={15} aria-hidden />
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
