import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Database,
  Layers2,
  Image as ImageIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui'
import { toIntlLocale } from '@/i18n/languages'
import { formatDate, formatDurationMilliseconds, formatNumber, formatQuota } from '@/lib/format'
import { useStatus } from '@/lib/status'
import { usageCache, usageDetails, usageMetric, usageTiming } from './chart'
import { RequestStatus } from './RequestDetails'
import { latencyBand, usageModelName } from './presentation'
import type { UsageLog } from './UsagePage'

export function UsageRecords(props: {
  logs: UsageLog[]
  busy: boolean
  stale: boolean
  selectedID?: number
  onSelect: (log: UsageLog) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const site = useStatus()
  const timingLabel = t('First response / total duration')
  return (
    <div className="usage-records" aria-busy={props.busy}>
      <table className="consumer-table usage-record-table">
        <thead>
          <tr>
            <th scope="col">{t('Model / time')}</th>
            <th scope="col">{t('API key / charged group')}</th>
            <th
              scope="col"
              title={t(
                'Time to the first upstream stream event; this may precede the first text token.',
              )}
            >
              {timingLabel}
            </th>
            <th scope="col">
              {t('Usage quantity')}
              <span className="usage-token-legend">
                <span>
                  <ArrowDown aria-hidden="true" />
                  {t('Input tokens')}
                </span>
                <span>
                  <ArrowUp aria-hidden="true" />
                  {t('Output tokens')}
                </span>
                <span>
                  <Database aria-hidden="true" />
                  {t('Cache read tokens')}
                </span>
              </span>
            </th>
            <th scope="col">{t('Cost')}</th>
          </tr>
        </thead>
        <tbody>
          {props.logs.map((log) => {
            const metric = usageMetric(log)
            const timing = usageTiming(log)
            const cache = log.type === 2 ? usageCache(log.other, log.prompt_tokens) : undefined
            const stream = usageDetails(log.other).stream_status
            const showStatus =
              log.type !== 2 ||
              (typeof stream === 'object' &&
                stream !== null &&
                'status' in stream &&
                stream.status === 'error')
            const first = timing.firstResponse
            const duration = timing.duration
            return (
              <tr key={log.id} data-selected={props.selectedID === log.id || undefined}>
                <td>
                  <div className="usage-context">
                    <strong title={log.model_name}>{usageModelName(log.model_name)}</strong>
                    <span className="usage-record-date">{formatDate(log.created_at, locale)}</span>
                    {showStatus && <RequestStatus log={log} />}
                  </div>
                </td>
                <td data-label={t('API key / charged group')}>
                  <div className="usage-context">
                    <span className="usage-key-name">{log.token_name || '—'}</span>
                    <span className="usage-charged-group">
                      <Layers2 size={12} aria-hidden />
                      {log.group || '—'}
                    </span>
                  </div>
                </td>
                <td data-label={timingLabel}>
                  <div className="usage-record-timing">
                    <span data-latency={latencyBand(first)} title={t('First response latency')}>
                      <span className="sr-only">{t('First response latency')}: </span>
                      {formatDurationMilliseconds(
                        first === undefined ? undefined : first * 1000,
                        locale,
                        'abbreviated',
                      )}
                    </span>
                    <span className="muted" aria-hidden="true">
                      /
                    </span>
                    <span title={t('Total duration')}>
                      <span className="sr-only">{t('Total duration')}: </span>
                      {formatDurationMilliseconds(
                        duration === undefined ? undefined : duration * 1000,
                        locale,
                        'abbreviated',
                      )}
                    </span>
                  </div>
                </td>
                <td data-label={t('Usage quantity')}>
                  {log.type !== 2 && '—'}
                  {log.type === 2 && metric.kind === 'images' && (
                    <span className="usage-token-value">
                      <ImageIcon aria-hidden="true" />
                      {metric.count === undefined
                        ? t('Image count not recorded')
                        : t('{{count}} images', { count: formatNumber(metric.count, locale) })}
                    </span>
                  )}
                  {log.type === 2 && metric.kind === 'tokens' && (
                    <div className="usage-token-stack">
                      <div className="usage-token-pair">
                        <span className="usage-token-value" title={t('Input tokens')}>
                          <ArrowDown aria-hidden="true" />
                          <span className="sr-only">{t('Input tokens')}: </span>
                          {formatNumber(cache?.total ?? log.prompt_tokens, locale)}
                        </span>
                        <span className="usage-token-value" title={t('Output tokens')}>
                          <ArrowUp aria-hidden="true" />
                          <span className="sr-only">{t('Output tokens')}: </span>
                          {formatNumber(log.completion_tokens, locale)}
                        </span>
                      </div>
                      <span
                        className="usage-token-value usage-token-cache"
                        title={t('Cache read tokens')}
                      >
                        <Database aria-hidden="true" />
                        <span className="sr-only">{t('Cache read tokens')}: </span>
                        {cache?.read === undefined ? '—' : formatNumber(cache.read, locale)}
                      </span>
                    </div>
                  )}
                </td>
                <td data-label={t('Cost')} className="usage-record-cost">
                  <div>
                    {formatQuota(log.quota, site.data, locale)}
                    <Button
                      className="icon-button usage-record-open"
                      disabled={props.stale}
                      variant="ghost"
                      aria-haspopup="dialog"
                      aria-label={t('View request {{id}}', { id: log.request_id || log.id })}
                      title={t('View')}
                      onClick={() => props.onSelect(log)}
                    >
                      <ChevronRight size={16} aria-hidden="true" />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
