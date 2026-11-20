import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { CalendarDays, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
} from '@/components/ui'
import { request } from '@/lib/api'
import { useCatalog } from '@/lib/catalog'
import { formatBalance, formatDate, formatNumber, formatQuota } from '@/lib/format'
import { useSession } from '@/lib/session'
import { useStatus } from '@/lib/status'
import { toIntlLocale } from '@/i18n/languages'
import { dailyUsage, type UsagePoint, usageMetric, usageCache } from './chart'
import '../wallet/wallet.css'
import { Pagination } from '@/components/pagination'
import { SearchSelect } from '@/components/search-select'
import { DateTimePicker } from '@/components/date-time-picker'
import { SpendingChart } from './SpendingChart'
import { RequestDetails } from './RequestDetails'
import { UsageRecords } from './UsageRecords'
import './usage.css'

export interface UsageLog {
  id: number
  type?: number
  created_at: number
  model_name: string
  quota: number
  prompt_tokens: number
  completion_tokens: number
  is_stream?: boolean
  use_time: number
  group: string
  token_name: string
  request_id: string
  other: string
  content?: string
}
interface UsagePageData {
  items: UsageLog[]
  total: number
}
interface UsageStats {
  quota: number
  rpm: number
  tpm: number
}

export default function UsagePage(props: {
  initialRequestId?: string
  initialFrom?: number
  initialTokenId?: number
  initialTokenName?: string
}) {
  const { t, i18n } = useTranslation()
  const site = useStatus()
  const catalog = useCatalog()
  const session = useSession()
  const advancedID = useId()
  const filtersID = useId()
  const [filtersOpen, setFiltersOpen] = useState(
    Boolean(props.initialRequestId || props.initialTokenId),
  )
  const [moreFilters, setMoreFilters] = useState(Boolean(props.initialRequestId))
  const [days, setDays] = useState(7)
  const [linkedStart, setLinkedStart] = useState(
    props.initialRequestId ? props.initialFrom : undefined,
  )
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState({
    model: '',
    group: '',
    token: '',
    tokenID: props.initialTokenId,
    requestID: props.initialRequestId || '',
    type: '0',
    from: '',
    until: '',
  })
  const [filters, setFilters] = useState(draft)
  const [validation, setValidation] = useState('')
  const [pageSize, setPageSize] = useState(15)
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  const [selected, setSelected] = useState<UsageLog | null>(null)
  const maximumDays = Math.max(1, site.data?.log_max_range_days || 365)
  const period = Math.min(days, maximumDays)
  const periods = [
    ...new Set([1, 7, 30, Math.min(maximumDays, 30)].filter((day) => day <= maximumDays)),
  ].sort((a, b) => a - b)
  const start = filters.from
    ? Math.floor(new Date(filters.from).getTime() / 1000)
    : linkedStart
      ? Math.max(now - maximumDays * 86400, Math.min(now, linkedStart - 1))
      : now - period * 86400
  const end = filters.until ? Math.floor(new Date(filters.until).getTime() / 1000) : now
  const params = new URLSearchParams({
    type: filters.type,
    start_timestamp: String(start),
    end_timestamp: String(end),
    model_name: filters.model,
    group: filters.group,
    token_name: filters.tokenID ? '' : filters.token,
    request_id: filters.requestID,
  })
  if (filters.tokenID) params.set('token_id', String(filters.tokenID))
  const logs = useQuery<UsagePageData>({
    queryKey: ['usage-logs', page, pageSize, params.toString(), session.user?.id],
    placeholderData: (previous, query) =>
      query?.queryKey[3] === params.toString() && query.queryKey[4] === session.user?.id
        ? keepPreviousData(previous)
        : undefined,
    queryFn: ({ signal }) =>
      request<UsagePageData>(
        `/api/log/self?p=${page}&page_size=${pageSize}&${params}&request_only=true`,
        { signal },
      ),
  })
  const statsParams = new URLSearchParams(params)
  statsParams.set('type', '2')
  statsParams.delete('request_id')
  const stats = useQuery({
    queryKey: ['usage-stats', statsParams.toString(), session.user?.id],
    queryFn: ({ signal }) => request<UsageStats>(`/api/log/self/stat?${statsParams}`, { signal }),
  })
  const history = useQuery({
    queryKey: ['usage-history', start, end, session.user?.id],
    queryFn: ({ signal }) =>
      request<UsagePoint[]>(`/api/data/self?start_timestamp=${start}&end_timestamp=${end}`, {
        signal,
      }),
    enabled: site.data?.enable_data_export === true && !filters.tokenID,
  })
  const daily = useMemo(
    () => dailyUsage(history.data || [], start, end),
    [start, end, history.data],
  )
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const dateFormat = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
  })
  const groupOptions = [
    { value: '', label: t('All groups') },
    ...catalog.groups.map((item) => ({ value: item.id, label: item.id, description: item.desc })),
  ]
  const modelNames = [
    ...new Set([...catalog.models.map((item) => item.model_name), draft.model].filter(Boolean)),
  ]
  const modelOptions = [
    { value: '', label: t('All models') },
    ...modelNames.map((value) => ({ value, label: value })),
  ]
  const secondaryFilters = [
    { label: 'Model', value: filters.model },
    { label: 'Service group', value: filters.group },
    {
      label: 'Record type',
      value: { '2': t('Consumption'), '5': t('Errors'), '6': t('Refunds') }[filters.type],
    },
    {
      label: 'From',
      value: filters.from ? formatDate(new Date(filters.from).getTime() / 1000, locale) : '',
    },
    {
      label: 'Until',
      value: filters.until ? formatDate(new Date(filters.until).getTime() / 1000, locale) : '',
    },
    {
      label: 'API key name',
      value: filters.tokenID
        ? `${props.initialTokenName || t('API key')} (#${filters.tokenID})`
        : filters.token,
    },
    { label: 'Request ID', value: filters.requestID },
  ].filter((filter) => filter.value)
  const pageCache = (logs.data?.items || [])
    .filter((log) => log.type === 2 && usageMetric(log).kind === 'tokens')
    .flatMap((log) => {
      const cache = usageCache(log.other, log.prompt_tokens)
      return [cache ?? { read: undefined, write: undefined, total: undefined, share: undefined }]
    })
  const cacheRead = pageCache.reduce((sum, cache) => sum + (cache.read ?? 0), 0)
  const cacheWrite = pageCache.reduce((sum, cache) => sum + (cache.write ?? 0), 0)
  const comparableCache = pageCache.filter((cache) => cache.share !== undefined)
  const comparableReads = comparableCache.reduce((sum, cache) => sum + (cache.read ?? 0), 0)
  const cacheInput = comparableCache.reduce((sum, cache) => sum + (cache.total ?? 0), 0)
  const knownRequests = pageCache.filter((cache) => cache.read !== undefined)
  const hitRequests = knownRequests.filter(
    (cache) => cache.read !== undefined && cache.read > 0,
  ).length
  const unknownRequests = pageCache.length - knownRequests.length
  const hitRate = knownRequests.length ? (hitRequests / knownRequests.length) * 100 : undefined

  return (
    <div className="page-stack page-compact usage-page">
      <PageHeader
        compact
        title={t('Usage')}
        actions={
          <>
            <Select
              aria-label={t('Time period')}
              value={filters.from || filters.until ? 'custom' : period}
              onValueChange={(value) => {
                if (value === 'custom') return
                setDays(Number(value))
                setLinkedStart(undefined)
                setFilters({ ...filters, from: '', until: '' })
                setNow(Math.floor(Date.now() / 1000))
                setValidation('')
                setPage(1)
                setDraft({ ...draft, from: '', until: '' })
              }}
              options={[
                ...periods.map((value) => ({
                  value,
                  label:
                    value === 1 ? t('Last 24 hours') : t('Last {{count}} days', { count: value }),
                })),
                ...(filters.from || filters.until
                  ? [{ value: 'custom', label: t('Custom date') }]
                  : []),
              ]}
            />
            <Button
              variant="secondary"
              aria-expanded={filtersOpen}
              aria-controls={filtersID}
              onClick={() => setFiltersOpen(!filtersOpen)}
            >
              <SlidersHorizontal size={15} aria-hidden />
              {t('Filters')}
            </Button>
          </>
        }
      />
      <div id={filtersID} hidden={!filtersOpen}>
        <Card className="usage-filter-card">
          <form
            className="usage-filter-form"
            onSubmit={(event) => {
              event.preventDefault()
              const from = draft.from
                ? new Date(draft.from).getTime() / 1000
                : Math.floor(Date.now() / 1000) - period * 86400
              const until = draft.until
                ? new Date(draft.until).getTime() / 1000
                : Math.floor(Date.now() / 1000)
              if (
                !Number.isFinite(from) ||
                !Number.isFinite(until) ||
                until < from ||
                until - from > maximumDays * 86400
              ) {
                setMoreFilters(true)
                setValidation('Choose a valid time range within {{days}} days.')
                return
              }
              setValidation('')
              setFilters({
                ...draft,
                model: draft.model.trim(),
                token: draft.token.trim(),
                requestID: draft.requestID.trim(),
              })
              setNow(Math.floor(Date.now() / 1000))
              setPage(1)
            }}
          >
            <div className="usage-filter-primary">
              <SearchSelect
                label={t('Service group')}
                value={draft.group}
                onValueChange={(group) => setDraft({ ...draft, group })}
                options={groupOptions}
              />
              <SearchSelect
                label={t('Model')}
                value={draft.model}
                onValueChange={(model) => setDraft({ ...draft, model })}
                options={modelOptions}
              />
              <Field label={t('Record type')}>
                <Select
                  value={draft.type}
                  onValueChange={(value) => setDraft({ ...draft, type: value })}
                  options={[
                    { value: '0', label: t('All record types') },
                    { value: '2', label: t('Consumption') },
                    { value: '5', label: t('Errors') },
                    { value: '6', label: t('Refunds') },
                  ]}
                />
              </Field>
              <div className="usage-filter-actions">
                <Button type="submit">{t('Apply filters')}</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNow(Math.floor(Date.now() / 1000))
                    void queryClient.invalidateQueries({ queryKey: ['usage-logs'] })
                    void queryClient.invalidateQueries({ queryKey: ['usage-stats'] })
                    void queryClient.invalidateQueries({ queryKey: ['usage-history'] })
                  }}
                >
                  <RefreshCw size={15} aria-hidden />
                  {t('Refresh')}
                </Button>

                <Button
                  variant="ghost"
                  aria-label={t('More filters')}
                  aria-expanded={moreFilters}
                  aria-controls={advancedID}
                  onClick={() => setMoreFilters(!moreFilters)}
                >
                  <SlidersHorizontal size={16} aria-hidden />
                  {t('More filters')}
                  {secondaryFilters.length > 0 && <Badge>{secondaryFilters.length}</Badge>}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    const empty = {
                      model: '',
                      group: '',
                      token: '',
                      tokenID: undefined,
                      requestID: '',
                      type: '0',
                      from: '',
                      until: '',
                    }
                    setDraft(empty)
                    setFilters(empty)
                    setDays(7)
                    setLinkedStart(undefined)
                    setPage(1)
                    setValidation('')
                    setNow(Math.floor(Date.now() / 1000))
                  }}
                >
                  {t('Reset filters')}
                </Button>
              </div>
            </div>
            <div id={advancedID} className="usage-filter-advanced" hidden={!moreFilters}>
              <div className="usage-filter-grid">
                <DateTimePicker
                  label={t('From')}
                  value={draft.from}
                  onChange={(from) => setDraft({ ...draft, from })}
                  allowClear
                />
                <DateTimePicker
                  label={t('Until')}
                  value={draft.until}
                  onChange={(until) => setDraft({ ...draft, until })}
                  allowClear
                />
                <Field label={t('Model name or pattern')}>
                  <Input
                    value={draft.model}
                    placeholder={t('All models')}
                    onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  />
                </Field>
                <Field label={t('API key name')}>
                  <Input
                    value={draft.token}
                    disabled={!!draft.tokenID}
                    placeholder={t('All API keys')}
                    onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                  />
                </Field>
                <Field label={t('Request ID')}>
                  <Input
                    value={draft.requestID}
                    onChange={(event) => setDraft({ ...draft, requestID: event.target.value })}
                  />
                </Field>
              </div>
              <p className="muted usage-filter-help">
                {t(
                  'Model names match exactly. Use % for wildcard matching. API key names match exactly.',
                )}
              </p>
            </div>
            {validation && (
              <p className="field-error" role="alert">
                {t(validation, { days: maximumDays })}
              </p>
            )}
          </form>
          <p className="muted usage-filter-help usage-filter-scope">
            {t(
              'Spending and activity summaries include consumption for the selected period, model, group and API key. Request ID and record type filter the records only.',
            )}
          </p>
        </Card>
      </div>
      {secondaryFilters.length > 0 && (
        <div role="region" aria-label={t('Applied filters')} className="usage-applied-filters">
          <span className="muted">{t('Applied')}:</span>
          {secondaryFilters.map((filter) => (
            <Badge key={filter.label}>
              {t(filter.label)}: {filter.value}
            </Badge>
          ))}
          {filters.tokenID && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft({ ...draft, tokenID: undefined, token: '' })
                setFilters({ ...filters, tokenID: undefined, token: '' })
                setPage(1)
              }}
            >
              {t('All API keys')}
            </Button>
          )}
        </div>
      )}
      <div
        className="usage-spending-summary"
        data-testid="usage-summary"
        role="region"
        aria-label={t('Usage overview')}
        aria-busy={stats.isFetching}
      >
        <div className="usage-stat usage-stat-spending">
          <span className="eyebrow">{t('SPENT IN THIS PERIOD')}</span>
          <strong
            className="balance-number"
            title={stats.data ? formatQuota(stats.data.quota, site.data, locale) : undefined}
          >
            {stats.data ? formatBalance(stats.data.quota, site.data, locale) : '—'}
          </strong>
          <span className="muted usage-stat-caption">
            <CalendarDays size={12} aria-hidden />
            {dateFormat.format(start * 1000)} — {dateFormat.format(end * 1000)}
          </span>
        </div>
      </div>
      {stats.error && <ErrorState error={stats.error} retry={() => void stats.refetch()} />}
      <h2 className="sr-only" id="usage-records">
        {t('Request history')}
      </h2>
      <div className="query-status" role="status" hidden={!logs.isPlaceholderData}>
        {logs.isPlaceholderData
          ? t('Loading the selected page. Previous records remain visible.')
          : '\u00a0'}
      </div>

      {logs.isPending && <LoadingState />}
      {logs.error && <ErrorState error={logs.error} retry={() => void logs.refetch()} />}
      {logs.data?.items.length === 0 && (
        <EmptyState
          title={t('No usage in this period')}
          description={t(
            'Start a conversation or create an image, then your usage will appear here.',
          )}
        />
      )}
      {!!logs.data?.items.length && (
        <Card className="usage-records-card">
          <UsageRecords
            logs={logs.data.items}
            busy={logs.isFetching}
            stale={logs.isPlaceholderData}
            selectedID={selected?.id}
            onSelect={setSelected}
          />
        </Card>
      )}
      {logs.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={logs.data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
          pageSizes={[15, 30, 60]}
        />
      )}
      <details className="usage-secondary">
        <summary>{t('Usage overview')}</summary>
        <Card className="usage-stats" aria-busy={stats.isFetching}>
          <div className="usage-stat">
            <span className="eyebrow">
              <span className="usage-live-dot" />
              {t('RECENT REQUESTS / MIN')}
            </span>
            <strong className="balance-number">
              {stats.data ? formatNumber(stats.data.rpm, locale) : '—'}
            </strong>
            <span className="muted usage-stat-caption">
              {t('Recent rate, not the total for this period')}
            </span>
          </div>
          <div className="usage-stat">
            <span className="eyebrow">{t('RECENT TOKENS / MIN')}</span>
            <strong className="balance-number">
              {stats.data ? formatNumber(stats.data.tpm, locale) : '—'}
            </strong>
            <span className="muted usage-stat-caption">
              {t('Recent rate, not the total for this period')}
            </span>
          </div>
        </Card>
        {!filters.tokenID && (
          <Card
            data-testid="usage-chart-shell"
            className="usage-chart-shell"
            aria-busy={history.isFetching}
          >
            <details className="usage-trend-details" aria-busy={history.isFetching}>
              <summary className="usage-chart-heading">
                <span>
                  <strong>{t('Your spending over time')}</strong>
                  <small className="muted">
                    {t('All models and groups. Dashboard data can take a few minutes to update.')}
                  </small>
                </span>
                <span className="usage-chart-legend">{t('Cost')}</span>
              </summary>
              <div className="usage-chart-region">
                {history.data ? (
                  <SpendingChart daily={daily} />
                ) : (
                  <div className="usage-chart-placeholder">{'—'}</div>
                )}
              </div>
              <p className="muted">
                {t('Dates use your device time zone: {{zone}}', {
                  zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                })}
              </p>
              <details>
                <summary
                  aria-disabled={!history.data}
                  onClick={(event) => {
                    if (!history.data) event.preventDefault()
                  }}
                >
                  {t('View daily spending')}
                </summary>
                {history.data && (
                  <table className="consumer-table">
                    <thead>
                      <tr>
                        <th>{t('Date')}</th>
                        <th>{t('Cost')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((day) => (
                        <tr key={day.date}>
                          <td>{dateFormat.format(new Date(day.date * 1000))}</td>
                          <td>{formatQuota(day.quota, site.data, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
            </details>
          </Card>
        )}
        {!!filters.tokenID && (
          <p className="muted usage-filter-help">
            {t('Showing records and spending for this key. The account-wide trend is hidden.')}
          </p>
        )}
        {!filters.tokenID && history.error && (
          <ErrorState error={history.error} retry={() => void history.refetch()} />
        )}
        <Card className="usage-cache-summary" aria-busy={logs.isFetching}>
          <div className="usage-cache-heading">
            <h3>{t('Cache usage on this page')}</h3>
            <span className="muted">
              {formatNumber(logs.data?.items.length || 0, locale)} {t('Requests')}
            </span>
          </div>
          <dl className="usage-cache-metrics">
            <div>
              <dt>{t('Recorded cache reads')}</dt>
              <dd>
                {pageCache.some((cache) => cache.read !== undefined)
                  ? formatNumber(cacheRead, locale)
                  : t('Not recorded')}
              </dd>
            </div>
            <div>
              <dt>{t('Cache hit rate')}</dt>
              <dd>
                {hitRate === undefined
                  ? '—'
                  : `${formatNumber(hitRate, locale, { maximumFractionDigits: 1 })}%`}
              </dd>
              <small className="cache-rate-caption">
                {t('{{hits}} / {{count}} requests hit cache', {
                  hits: formatNumber(hitRequests, locale),
                  count: formatNumber(knownRequests.length, locale),
                })}
              </small>
              {cacheInput > 0 && (
                <small className="cache-rate-caption">
                  {t('Cached share of input tokens: {{share}}%', {
                    share: formatNumber((comparableReads / cacheInput) * 100, locale, {
                      maximumFractionDigits: 1,
                    }),
                  })}
                </small>
              )}
              {hitRate !== undefined && (
                <progress aria-label={t('Cache hit rate')} value={hitRate} max={100} />
              )}
            </div>
            <div>
              <dt>{t('Cache write tokens')}</dt>
              <dd>
                {pageCache.some((cache) => cache.write !== undefined)
                  ? formatNumber(cacheWrite, locale)
                  : t('Not recorded')}
              </dd>
            </div>
          </dl>
          <details className="usage-cache-explanation">
            <summary>{t('Details')}</summary>
            <p className="muted usage-filter-help">
              {t('Records with a comparable cache breakdown')}:{' '}
              {formatNumber(comparableCache.length, locale)}
            </p>
            <p className="muted usage-filter-help">
              {t(
                'Cache hit rate = requests with cache reads / requests with recorded cache-read data. Successful token-based requests on this page only.',
              )}
              {unknownRequests > 0 && (
                <>
                  {' '}
                  {t('{{count}} requests have no cache-read data and are excluded.', {
                    count: formatNumber(unknownRequests, locale),
                  })}
                </>
              )}{' '}
              {t(
                'Cache counts cover this page only. Share uses records with a known input total; missing records are excluded.',
              )}
            </p>
          </details>
        </Card>
      </details>
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={t('Request details')}
        className="request-detail-modal"
        backdropClassName="usage-detail-backdrop"
      >
        {selected && <RequestDetails log={selected} />}
      </Modal>
    </div>
  )
}
