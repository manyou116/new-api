import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { request } from '@/lib/api'
import { toIntlLocale } from '@/i18n/languages'
import { useSession } from '@/lib/session'
import { Pagination } from '@/components/pagination'
import { formatDate, formatNumber } from '@/lib/format'
import './wallet.css'
import { PaymentReturnStatus } from './PaymentReturnStatus'
import { OrderDateFilter, orderDateBounds, orderDatePreset } from './OrderDateFilter'

interface TopupOrder {
  id: number
  amount: number
  money: number
  trade_no: string
  payment_method: string
  create_time: number
  status: string
}
interface OrderPage {
  items: TopupOrder[]
  total: number
}
export default function OrdersPage() {
  const { t, i18n } = useTranslation()
  const { user } = useSession()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [search, setSearch] = useState('')
  const [keyword, setKeyword] = useState('')
  const [dates, setDates] = useState(() => orderDatePreset('last30'))
  const { start, end } = orderDateBounds(dates)
  const rangeParams = `start_timestamp=${start}&end_timestamp=${end}`
  const orders = useQuery<OrderPage>({
    queryKey: ['topup-orders', user?.id, keyword, page, pageSize, rangeParams],
    placeholderData: (previous, query) =>
      query?.queryKey[1] === user?.id &&
      query?.queryKey[2] === keyword &&
      query?.queryKey[5] === rangeParams
        ? previous
        : undefined,
    queryFn: ({ signal }) =>
      request<OrderPage>(
        `/api/user/topup/self?p=${page}&page_size=${pageSize}&status=success&keyword=${encodeURIComponent(keyword)}&${rangeParams}`,
        { signal },
      ),
  })
  return (
    <div className="page-stack">
      <PaymentReturnStatus />
      <PageHeader
        eyebrow={t('YOUR RECORDS')}
        title={t('Payment records')}
        description={t('Only completed payments are shown.')}
        actions={
          <Button
            variant="secondary"
            onClick={() => void orders.refetch()}
            busy={orders.isFetching}
          >
            {!orders.isFetching && <RefreshCw size={16} aria-hidden="true" />}
            {t('Refresh')}
          </Button>
        }
      />
      <div className="order-filter-bar">
        <OrderDateFilter
          value={dates}
          onChange={(next) => {
            setDates(next)
            setPage(1)
          }}
        />
        <form
          className="order-filter-search"
          onSubmit={(event) => {
            event.preventDefault()
            setKeyword(search)
            setPage(1)
          }}
        >
          <Input
            type="search"
            aria-label={t('Search orders')}
            placeholder={t('Search by order number')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button variant="secondary" type="submit" aria-label={t('Search')} title={t('Search')}>
            <Search size={17} aria-hidden="true" />
          </Button>
        </form>
        <div className="order-filter-dates muted" aria-live="polite">
          {t('{{from}} to {{through}}', { from: dates.from, through: dates.through })}
        </div>
      </div>
      <p className="muted">
        {t(
          'This list shows payment records returned by the server, including wallet recharges and recorded plan payments. Check plan history for activated allowances.',
        )}{' '}
        <Link to="/plans" className="text-link">
          {t('View plans')}
        </Link>
      </p>
      {orders.isPending && <LoadingState />}
      <div role="status" className="query-status" data-testid="orders-page-status">
        {orders.isPlaceholderData ? t('Loading…') : null}
      </div>
      {orders.error && <ErrorState error={orders.error} retry={() => void orders.refetch()} />}
      {orders.data?.items.length === 0 && (
        <EmptyState
          title={keyword ? t('No matching payments') : t('No payment records yet')}
          description={
            keyword
              ? t('Try another order number.')
              : t('Your completed payments will appear here.')
          }
        />
      )}
      {!!orders.data?.items.length && (
        <div className="consumer-table-wrap" aria-busy={orders.isPlaceholderData}>
          <table className="consumer-table">
            <thead>
              <tr>
                <th>{t('Order')}</th>
                <th>{t('Order date')}</th>
                <th>{t('Payment method')}</th>
                <th>{t('Payment amount')}</th>
                <th>{t('Status')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((order) => (
                <tr key={order.id}>
                  <td>
                    <code>{order.trade_no}</code>
                  </td>
                  <td>{formatDate(order.create_time, locale)}</td>
                  <td>{order.payment_method}</td>
                  <td>{formatNumber(order.money, locale)}</td>
                  <td>
                    <Badge>{t(order.status)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted">{t('Payment amounts use each provider’s checkout currency.')}</p>
      {orders.data && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={orders.data.total}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            setPage(1)
          }}
        />
      )}
    </div>
  )
}
