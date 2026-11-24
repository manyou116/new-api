import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { clearAuth } from '@/lib/auth-state'
import { CatalogProvider } from '@/lib/catalog'
import { SessionProvider } from '@/lib/session'
import UsagePage from '../UsagePage'
import type { UsageLog } from '../UsagePage'

beforeEach(() => {
  clearAuth()
  document.cookie = 'new_api_has_session=; Max-Age=0; path=/'
})
afterEach(() => vi.unstubAllGlobals())

async function renderUsage(
  initialRequestId?: string,
  initialFrom?: number,
  pendingPage?: Promise<void>,
  pendingSummary?: Promise<void>,
  record?: Partial<UsageLog>,
  initialKey?: { id: number; name: string },
  additionalRecords: Partial<UsageLog>[] = [],
) {
  const fetch = vi.fn(async (path: string, _options?: RequestInit) => {
    const url = new URL(path, 'http://localhost')
    let data: unknown = {}
    if (url.pathname === '/api/status')
      data = { quota_per_unit: 500000, enable_data_export: !!pendingSummary }
    if (
      (url.pathname === '/api/log/self/stat' || url.pathname === '/api/data/self') &&
      pendingSummary &&
      (url.searchParams.get('model_name') === 'changed' ||
        (url.searchParams.get('start_timestamp') &&
          Number(url.searchParams.get('end_timestamp')) -
            Number(url.searchParams.get('start_timestamp')) <
            2 * 86400))
    )
      await pendingSummary
    if (url.pathname === '/api/data/self') data = []
    if (url.pathname === '/api/log/self/stat') data = { quota: 1, rpm: 0, tpm: 0 }
    if (url.pathname === '/api/log/self') {
      if (
        (url.searchParams.get('p') === '2' ||
          url.searchParams.get('request_id') === 'changed-filter') &&
        pendingPage
      )
        await pendingPage
      data = {
        total: pendingPage ? 30 : 1 + additionalRecords.length,
        items: [
          {
            id: 1,
            type: 2,
            model_name: 'fixture-chat',
            created_at: 1,
            quota: 1,
            prompt_tokens: 1000,
            completion_tokens: 200,
            use_time: 4,
            is_stream: true,
            group: 'default',
            token_name: 'Editor',
            request_id: 'req-synthetic',
            other: JSON.stringify({
              frt: 1000,
              billing_mode: 'tiered_expr',
              billing_unit: 'token',
              cache_tokens: 400,
              cache_write_tokens: 120,
              cache_creation_tokens_5m: 20,
              cache_creation_tokens_1h: 100,
              cache_ratio: 0.1,
              group_ratio: 1.75,
              billing_explanation: {
                status: 'available',
                unit_prices: { p: 3.5, c: 7, cr: 0, cc: 4.375 },
              },
              billing_tokens: { len: 1000, p: 480, cr: 400, cc: 120, c: 200 },
              admin_info: { channel_name: 'HIDDEN_CHANNEL', secret: 'HIDDEN_ADMIN' },
              root_info: { secret: 'HIDDEN_ROOT' },
            }),
            ...record,
          },
          ...additionalRecords.map((item, index) => ({
            id: index + 2,
            type: 2,
            model_name: 'extra-' + index,
            created_at: 1,
            quota: 0,
            prompt_tokens: 1000,
            completion_tokens: 1,
            use_time: 1,
            is_stream: false,
            group: 'default',
            token_name: 'Editor',
            other: '{}',
            ...item,
          })),
        ],
      }
    }
    if (url.pathname === '/api/pricing')
      return Response.json({
        success: true,
        data: [],
        usable_group: { default: 'Everyday' },
        group_ratio: { default: 1 },
      })
    return Response.json({ success: true, data })
  })
  vi.stubGlobal('fetch', fetch)
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <SessionProvider>
          <CatalogProvider>
            <UsagePage
              initialRequestId={initialRequestId}
              initialFrom={initialFrom}
              initialTokenId={initialKey?.id}
              initialTokenName={initialKey?.name}
            />
          </CatalogProvider>
        </SessionProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return fetch
}

async function showFilters() {
  const button = screen.getByRole('button', { name: 'Filters' })
  if (button.getAttribute('aria-expanded') === 'false') await userEvent.click(button)
}

async function showOverview() {
  const summary = screen.getByText('Usage overview', { selector: 'summary' })
  if (!summary.parentElement?.hasAttribute('open')) await userEvent.click(summary)
}

it('applies supported record filters on submit and keeps request IDs outside summary statistics', async () => {
  const fetch = await renderUsage()
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  await showFilters()
  await userEvent.setup().click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('textbox', { name: 'API key name' }), 'Editor')
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'req-synthetic')
  expect(
    fetch.mock.calls.some(
      ([path]) =>
        new URL(path, 'http://localhost').searchParams.get('request_id') === 'req-synthetic',
    ),
  ).toBe(false)
  await showFilters()
  await user.click(screen.getByRole('combobox', { name: 'Record type' }))
  await user.click(await screen.findByRole('option', { name: 'Errors' }))
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => {
        const url = new URL(path, 'http://localhost')
        return (
          url.pathname === '/api/log/self' &&
          url.searchParams.get('request_id') === 'req-synthetic' &&
          url.searchParams.get('token_name') === 'Editor' &&
          url.searchParams.get('type') === '5'
        )
      }),
    ).toBe(true),
  )
  const stats = fetch.mock.calls
    .map(([path]) => new URL(path, 'http://localhost'))
    .filter((url) => url.pathname === '/api/log/self/stat')
  expect(
    stats.every(
      (url) => !url.searchParams.has('request_id') && url.searchParams.get('type') === '2',
    ),
  ).toBe(true)
})

it('keeps common filters visible and preserves applied secondary filters while collapsed', async () => {
  await renderUsage()
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  expect(screen.getByRole('combobox', { name: 'Time period' })).toBeVisible()
  expect(screen.queryByRole('combobox', { name: 'Service group' })).not.toBeInTheDocument()
  await showFilters()
  expect(screen.getByRole('combobox', { name: 'Service group' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Record type' })).toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Request ID' })).not.toBeInTheDocument()
  const more = screen.getByRole('button', { name: 'More filters' })
  expect(more).toHaveAttribute('aria-expanded', 'false')
  await user.click(more)
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'req-synthetic')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await user.click(more)
  expect(more).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('textbox', { name: 'Request ID' })).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Applied filters' })).toHaveTextContent('req-synthetic')
  await user.click(more)
  expect(screen.getByRole('textbox', { name: 'Request ID' })).toHaveValue('req-synthetic')
  await user.click(screen.getByRole('button', { name: 'Reset filters' }))
  expect(screen.queryByRole('region', { name: 'Applied filters' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Request ID' })).toHaveValue('')
})

it('includes failures in the default history and exposes a persistent record-type filter', async () => {
  const fetch = await renderUsage()
  await screen.findByText('fixture-chat')
  const firstRead = fetch.mock.calls
    .map(([path]) => new URL(path, 'http://localhost'))
    .find((url) => url.pathname === '/api/log/self')!
  expect(firstRead.searchParams.get('type')).toBe('0')
  expect(firstRead.searchParams.get('request_only')).toBe('true')
  expect(
    fetch.mock.calls
      .map(([path]) => new URL(path, 'http://localhost'))
      .filter((url) => url.pathname === '/api/log/self/stat')
      .every(
        (url) => url.searchParams.get('type') === '2' && !url.searchParams.has('request_only'),
      ),
  ).toBe(true)
  const user = userEvent.setup()
  await showFilters()
  await user.click(screen.getByRole('combobox', { name: 'Record type' }))
  await user.click(await screen.findByRole('option', { name: 'Errors' }))
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => {
        const url = new URL(path, 'http://localhost')
        return url.pathname === '/api/log/self' && url.searchParams.get('type') === '5'
      }),
    ).toBe(true),
  )
  await user.click(screen.getByRole('button', { name: 'Reset filters' }))
  expect(screen.getByRole('combobox', { name: 'Record type' })).toHaveTextContent(
    'All record types',
  )
})

it.each([
  { type: 2, other: '{}', label: 'Consumption', state: 'consumption' },
  { type: 5, other: '{}', label: 'Errors', state: 'error' },
  { type: 6, other: '{}', label: 'Refunds', state: 'refund' },
  { type: 2, other: '{"stream_status":{"status":"ok"}}', label: 'Completed', state: 'completed' },
  {
    type: 2,
    other: '{"stream_status":{"status":"error"}}',
    label: 'Interrupted',
    state: 'interrupted',
  },
  { type: 9, other: '{}', label: 'Other', state: 'other' },
])(
  'labels $state records explicitly in the list and details',
  async ({ type, other, label, state }) => {
    await renderUsage(undefined, undefined, undefined, undefined, {
      type,
      other,
      content: 'Public request error',
    })
    const row = await screen.findByRole('row', { name: /fixture-chat/ })
    if (state !== 'consumption' && state !== 'completed') {
      const status = within(row).getByText(label)
      expect(status).toHaveAttribute('data-request-state', state)
      expect(status).toBeVisible()
      expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
    if (type !== 2) {
      expect(within(row).queryByText(/Input \/ output tokens/)).not.toBeInTheDocument()
      expect(within(row).queryByText(/Cache read tokens/)).not.toBeInTheDocument()
      expect(within(row).queryByText(/Average output speed/)).not.toBeInTheDocument()
    }
    await userEvent.setup().click(within(row).getByRole('button', { name: /^View request/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Request details' })
    expect(within(dialog).getByText(label)).toBeVisible()
    if (type !== 2) {
      expect(within(dialog).queryByRole('region', { name: 'Token usage' })).not.toBeInTheDocument()
      expect(within(dialog).queryByText('Billing details')).not.toBeInTheDocument()
    }
    if (type !== 2 && type !== 5) {
      expect(
        within(dialog).queryByRole('region', { name: 'Response performance' }),
      ).not.toBeInTheDocument()
    }
    if (type === 5) {
      expect(within(dialog).getByRole('region', { name: 'Error details' })).toHaveTextContent(
        'Public request error',
      )
      expect(within(dialog).getByRole('region', { name: 'Response performance' })).toBeVisible()
      expect(
        within(dialog).getByText(
          'An automatic retry may succeed. This error record does not determine the final request outcome.',
        ),
      ).toBeVisible()
      expect(within(dialog).queryByText('Failed')).not.toBeInTheDocument()
    }
  },
)

it('shows public cache and billing details without exposing privileged metadata', async () => {
  await renderUsage()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /^View request/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Request details' })
  await user.click(within(dialog).getByText('Token usage', { selector: 'summary' }))
  await user.click(within(dialog).getByText('Recorded pricing inputs', { selector: 'summary' }))
  expect(within(dialog).getAllByText('Cache read tokens')[0]).toBeVisible()
  expect(within(dialog).getAllByText('Cache write tokens')[0]).toBeVisible()
  expect(within(dialog).getByRole('region', { name: 'Token usage' })).toHaveTextContent('40%')
  expect(within(dialog).getByText('Billable token breakdown')).toBeVisible()
  expect(within(dialog).getByText('Dynamic pricing')).toBeVisible()
  expect(within(dialog).getByText('Billable token breakdown')).toBeVisible()
  expect(dialog).not.toHaveTextContent('HIDDEN_')
  expect(
    within(within(dialog).getByRole('region', { name: 'Token usage' }))
      .getByText('Cache write tokens')
      .closest('div'),
  ).toHaveTextContent('120')
})

it.each([3, undefined])(
  'shows recorded image quantity %s consistently in the list and detail without text-only metrics',
  async (count) => {
    await renderUsage(undefined, undefined, undefined, undefined, {
      model_name: 'fixture-image',
      prompt_tokens: 1,
      completion_tokens: 0,
      is_stream: false,
      other: JSON.stringify({
        request_path: '/v1/images/generations',
        model_price: 0.5,
        content_parts:
          count === undefined ? [] : [{ key: 'Image count {{count}}', params: { count } }],
      }),
    })
    await screen.findByText('fixture-image')
    const row = screen.getByRole('row', { name: /fixture-image/ })
    const expected = count === undefined ? 'Image count not recorded' : '3 images'
    expect(row).toHaveTextContent(expected)
    expect(within(row).getByRole('cell', { name: /Total duration 4 s/ })).not.toHaveTextContent(
      'Output speed',
    )
    await userEvent.setup().click(within(row).getByRole('button', { name: /^View request/ }))
    const dialog = screen.getByRole('dialog', { name: 'Request details' })
    expect(dialog).toHaveTextContent(expected)
    expect(dialog).not.toHaveTextContent('First response latency')
    expect(dialog).not.toHaveTextContent('Average output speed')
    expect(dialog).toHaveTextContent('Total duration4 s')
  },
)

it('rejects a reversed custom time range without querying it and resets record filters', async () => {
  const fetch = await renderUsage()
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  await showFilters()
  await userEvent.setup().click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'draft-only')
  const before = fetch.mock.calls.length
  await user.click(screen.getByRole('button', { name: 'From' }))
  const fromDialog = await screen.findByRole('dialog', { name: 'From' })
  const days = within(fromDialog)
    .getAllByRole('button')
    .filter((button) => !!button.getAttribute('aria-label')?.match(/\d+(st|nd|rd|th), \d{4}/))
  await user.click(days[15]!)
  await user.click(within(fromDialog).getByRole('button', { name: 'Apply date' }))
  await user.click(screen.getByRole('button', { name: 'Until' }))
  const untilDialog = await screen.findByRole('dialog', { name: 'Until' })
  const earlier = within(untilDialog)
    .getAllByRole('button')
    .filter((button) => !!button.getAttribute('aria-label')?.match(/\d+(st|nd|rd|th), \d{4}/))
  await user.click(earlier[10]!)
  await user.click(within(untilDialog).getByRole('button', { name: 'Apply date' }))
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid time range')
  expect(fetch.mock.calls).toHaveLength(before)
  await user.click(screen.getByRole('button', { name: 'Reset filters' }))
  expect(screen.getByRole('textbox', { name: 'Request ID' })).toHaveValue('')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('opens the server-provided creation request directly without narrowing aggregate statistics', async () => {
  const fetch = await renderUsage('creation-request-id', Math.floor(Date.now() / 1000) - 30)
  await screen.findByText('fixture-chat')
  expect(screen.getByRole('textbox', { name: 'Request ID' })).toHaveValue('creation-request-id')
  expect(
    fetch.mock.calls.some(
      ([path]) =>
        path.startsWith('/api/log/self?') && path.includes('request_id=creation-request-id'),
    ),
  ).toBe(true)
  expect(
    fetch.mock.calls
      .filter(([path]) => path.startsWith('/api/log/self/stat?'))
      .every(([path]) => !path.includes('request_id')),
  ).toBe(true)
})

it('shows historical server prices including explicit free cache without recomputing the total', async () => {
  await renderUsage()
  await userEvent.setup().click(await screen.findByRole('button', { name: /^View request/ }))
  const dialog = await screen.findByRole('dialog')
  const prices = within(dialog).getByRole('table')
  const read = within(prices).getByRole('row', { name: /Cache read tokens/ })
  expect(
    within(read)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['400', '$0.00', '$0.00'])
  const input = within(prices).getByRole('row', { name: /Input tokens/ })
  expect(
    within(input)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['480', '$3.50', '$0.00168'])
  expect(within(dialog).getAllByText('$0.000002')).toHaveLength(2)
})

it('shows scoped cache totals and distinct streamed throughput, first-response and total timing', async () => {
  await renderUsage()
  await screen.findByText('fixture-chat')
  await showOverview()
  expect(screen.getByText('Cache usage on this page')).toBeVisible()
  const cacheHelp = screen.getByText(/Cache counts cover this page only/)
  expect(cacheHelp).not.toBeVisible()
  await userEvent.setup().click(screen.getByText('Details', { selector: 'summary' }))
  expect(cacheHelp).toBeVisible()
  expect(screen.getByText('100%')).toBeVisible()
  expect(screen.getByText('Cache hit rate')).toBeVisible()
  expect(screen.getByText('Cached share of input tokens: 40%')).toBeVisible()
  const cacheCell = within(screen.getByRole('row', { name: /fixture-chat/ })).getByRole('cell', {
    name: /Cache read tokens:\s*400/,
  })
  expect(cacheCell).toHaveTextContent('Cache read tokens: 400')
  expect(cacheCell).toHaveTextContent('Input tokens: 1,000')
  await showOverview()
  expect(screen.getByRole('progressbar', { name: 'Cache hit rate' })).toHaveAttribute(
    'value',
    '100',
  )
  await userEvent.setup().click(screen.getByRole('button', { name: /^View request/ }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('Total duration4 s')
  expect(dialog).toHaveTextContent('First response latency1 s')
  expect(within(dialog).getByRole('region', { name: 'Response performance' })).toHaveTextContent(
    'Average output speed50 token/s',
  )
  await userEvent.click(within(dialog).getByText('Token usage', { selector: 'summary' }))
  expect(within(dialog).queryByText('Cache hit rate')).not.toBeInTheDocument()
  expect(within(dialog).getByText('Cache read share')).toBeVisible()
  expect(within(dialog).getByText('Cached share of input tokens')).toBeVisible()
  expect(within(dialog).getByRole('progressbar', { name: 'Cache read share' })).toHaveAttribute(
    'value',
    '40',
  )
})

it('shows that average output speed is unavailable for a non-streamed request', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, { is_stream: false })
  const row = await screen.findByRole('row', { name: /fixture-chat/ })
  const timing = within(row).getByRole('cell', {
    name: /Total duration.*Output speed Not recorded/,
  })
  expect(timing).not.toHaveTextContent('token/s')
})

it('counts cache-hit requests independently of token sizes and excludes unknown, failure and image records', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, undefined, undefined, [
    { prompt_tokens: 9000, other: '{"cache_tokens":0}' },
    { other: '{}' },
    { other: '{"cache_write_tokens":100}' },
    { type: 5, other: '{"cache_tokens":500}' },
    { other: '{"image_count":1,"cache_tokens":0}' },
  ])
  await screen.findByText('fixture-chat')
  await showOverview()
  expect(screen.getByRole('progressbar', { name: 'Cache hit rate' })).toHaveAttribute('value', '50')
  expect(screen.getByText('1 / 2 requests hit cache')).toBeVisible()
  await userEvent.setup().click(screen.getByText('Details', { selector: 'summary' }))
  expect(screen.getByText(/2 requests have no cache-read data and are excluded\./)).toBeVisible()
  expect(screen.getByText('Cached share of input tokens: 4%')).toBeVisible()
})

it('counts a known cache hit even when its total input is unavailable', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, {
    prompt_tokens: 0,
    other: '{"cache_tokens":400}',
  })
  await screen.findByText('fixture-chat')
  await showOverview()
  expect(screen.getByRole('progressbar', { name: 'Cache hit rate' })).toHaveAttribute(
    'value',
    '100',
  )
  expect(screen.queryByText(/Cached share of input tokens:/)).not.toBeInTheDocument()
})

it.each([
  { other: '{"cache_tokens":0}', rate: '0', status: 'Cache miss' },
  { other: '{}', rate: undefined, status: 'Not recorded' },
  { other: '{"cache_write_tokens":100}', rate: undefined, status: 'Not recorded' },
])('distinguishes misses from unknown read counts in $other', async ({ other, rate, status }) => {
  await renderUsage(undefined, undefined, undefined, undefined, { other })
  await screen.findByText('fixture-chat')
  await showOverview()
  if (rate === undefined)
    expect(screen.queryByRole('progressbar', { name: 'Cache hit rate' })).not.toBeInTheDocument()
  else
    expect(screen.getByRole('progressbar', { name: 'Cache hit rate' })).toHaveAttribute(
      'value',
      rate,
    )
  await userEvent.click(screen.getByRole('button', { name: /^View request/ }))
  expect(
    within(screen.getByRole('dialog')).getByText('Cache status').closest('div'),
  ).toHaveTextContent(status)
})

it('opens a key-specific history with precise identity, matching spending and all request types', async () => {
  const fetch = await renderUsage(
    undefined,
    undefined,
    Promise.resolve(),
    Promise.resolve(),
    undefined,
    { id: 11, name: 'Shared name' },
  )
  await screen.findByText('fixture-chat')
  expect(screen.getByRole('region', { name: 'Applied filters' })).toHaveTextContent(
    'Shared name (#11)',
  )
  expect(screen.queryByTestId('usage-chart-shell')).not.toBeInTheDocument()
  const reads = fetch.mock.calls.map(([path]) => new URL(path, 'http://localhost'))
  const records = reads.find((url) => url.pathname === '/api/log/self')!
  const stats = reads.find((url) => url.pathname === '/api/log/self/stat')!
  expect(records.searchParams.get('token_id')).toBe('11')
  expect(records.searchParams.get('type')).toBe('0')
  expect(records.searchParams.get('token_name')).toBe('')
  expect(stats.searchParams.get('token_id')).toBe('11')
  expect(stats.searchParams.get('type')).toBe('2')
  expect(reads.some((url) => url.pathname === '/api/data/self')).toBe(false)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => {
        const url = new URL(path, 'http://localhost')
        return (
          url.pathname === '/api/log/self' &&
          url.searchParams.get('p') === '2' &&
          url.searchParams.get('token_id') === '11'
        )
      }),
    ).toBe(true),
  )
  await user.click(screen.getByRole('button', { name: 'All API keys' }))
  await waitFor(() => expect(screen.queryByText('Shared name (#11)')).not.toBeInTheDocument())
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(([path]) => {
        const url = new URL(path, 'http://localhost')
        return (
          url.pathname === '/api/log/self' &&
          url.searchParams.get('p') === '1' &&
          !url.searchParams.has('token_id')
        )
      }),
    ).toBe(true),
  )
  await showOverview()
  expect(screen.getByTestId('usage-chart-shell')).toBeVisible()
})

it('shows missing text timings explicitly instead of inventing a first response or total duration', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, { use_time: 0, other: '{}' })
  await screen.findByText('fixture-chat')
  expect(
    within(screen.getByRole('row', { name: /fixture-chat/ })).getByRole('cell', {
      name: /First response.*Total duration.*Output speed Not recorded/,
    }),
  ).toHaveTextContent('First response—Total duration—Output speed—Not recorded')
})

it('retains the table and paging controls while the next page loads and prevents stale record actions', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  await renderUsage(undefined, undefined, pending)
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  const table = screen.getByRole('table')
  await user.click(screen.getByRole('button', { name: 'Next page' }))
  expect(screen.getByRole('table')).toBe(table)
  expect(screen.getByRole('button', { name: /^View request/ })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Previous records remain visible')
  expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeVisible()
  finish()
  await waitFor(() => expect(screen.getByRole('button', { name: /^View request/ })).toBeEnabled())
})

it('does not label prior records as belonging to newly applied filters while loading', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  await renderUsage(undefined, undefined, pending)
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  await showFilters()
  await userEvent.setup().click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'changed-filter')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
  expect(screen.queryByText('fixture-chat')).not.toBeInTheDocument()
  finish()
  await screen.findByText('fixture-chat')
})

it('keeps first response, total duration and output speed together in the final Latency column', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, {
    use_time: 8,
    other: '{"frt":800,"cache_tokens":400}',
  })
  const row = await screen.findByRole('row', { name: /fixture-chat/ })
  const headings = within(screen.getByRole('table')).getAllByRole('columnheader')
  expect(headings).toHaveLength(5)
  expect(headings[3]).toHaveTextContent('Cost')
  expect(headings.at(-1)).toHaveAccessibleName('Latency')
  const timing = within(row).getByRole('cell', {
    name: 'First response 800 ms Total duration 8 s Output speed 25 token/s',
  })
  expect(within(row).getAllByRole('cell').at(-1)).toBe(timing)
  expect(within(timing).getByText('First response')).toBeVisible()
  expect(within(timing).getByText('Total duration')).toBeVisible()
  expect(within(timing).getByText('25 token/s')).toBeVisible()
})

it('preserves the exact model ID in the keyboard-accessible drawer', async () => {
  await renderUsage(undefined, undefined, undefined, undefined, {
    model_name: 'gpt-6.2-sol',
    use_time: 8,
    other: '{"frt":800,"cache_tokens":400}',
  })
  const row = await screen.findByRole('row', { name: /GPT-6.2 Sol/ })
  const table = screen.getByRole('table')
  const headings = within(table).getAllByRole('columnheader')
  expect(headings[1]).toHaveTextContent('API key / charged group')
  expect(within(row).getAllByRole('cell')[1]).toHaveTextContent(/Editor.*default/)
  expect(headings[2]).toHaveTextContent(/Input tokens.*Output tokens.*Cache read tokens/)
  expect(row).toHaveTextContent(/Input tokens: 1,000.*Output tokens: 200.*Cache read tokens: 400/)
  expect(row).toHaveTextContent('$0.000002')
  const trigger = within(row).getByRole('button', { name: 'View request req-synthetic' })
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  const dialog = screen.getByRole('dialog', { name: 'Request details' })
  expect(within(dialog).getByText('GPT-6.2 Sol')).toBeVisible()
  expect(within(dialog).getByText('gpt-6.2-sol')).toBeVisible()
  await userEvent.keyboard('{Escape}')
  expect(trigger).toHaveFocus()
})

it.each([
  [9_999, 'good'],
  [10_000, 'warn'],
  [29_999, 'warn'],
  [30_000, 'slow'],
  [59_999, 'slow'],
  [60_000, 'critical'],
  [undefined, undefined],
])('applies the same first-response color for %s ms in the row and drawer', async (frt, band) => {
  await renderUsage(undefined, undefined, undefined, undefined, {
    use_time: 70,
    other: JSON.stringify({ frt }),
  })
  const row = await screen.findByRole('row', { name: /fixture-chat/ })
  const firstInRow = within(row).getByText('First response').nextElementSibling
  await userEvent.click(within(row).getByRole('button', { name: 'View request req-synthetic' }))
  const details = screen.getByRole('region', { name: 'Response performance' })
  const firstInDetails = within(details).getByText('First response latency').nextElementSibling

  if (band) {
    expect(firstInRow).toHaveAttribute('data-latency', band)
    expect(firstInDetails).toHaveAttribute('data-latency', band)
  } else {
    expect(firstInRow).toHaveTextContent('—')
    expect(firstInDetails).toHaveTextContent('—')
    expect(firstInRow).not.toHaveAttribute('data-latency')
    expect(firstInDetails).not.toHaveAttribute('data-latency')
  }
  expect(within(row).getByText('Total duration').nextElementSibling).not.toHaveAttribute(
    'data-latency',
  )
  expect(within(details).getByText('Total duration').nextElementSibling).not.toHaveAttribute(
    'data-latency',
  )
})

it('rounds the overview amount while retaining the exact recorded amount on request rows', async () => {
  await renderUsage()
  await screen.findByText('fixture-chat')
  const summary = screen.getByRole('region', { name: 'Usage overview' })
  expect(within(summary).getByText('$0.00')).toHaveAttribute('title', '$0.000002')
  await showOverview()
  expect(screen.getAllByText('Recent rate, not the total for this period')).toHaveLength(2)
  expect(screen.getByRole('row', { name: /fixture-chat/ })).toHaveTextContent('$0.000002')
})

it('keeps long request identifiers available in the detail and returns focus after closing it', async () => {
  const identifier = 'req-' + 'long-request-id-'.repeat(20)
  await renderUsage(undefined, undefined, undefined, undefined, {
    model_name: 'long-model-name-'.repeat(15),
    request_id: identifier,
  })
  const button = await screen.findByRole('button', { name: /^View request/ })
  expect(screen.getByText('long-model-name-'.repeat(15))).toHaveAttribute(
    'title',
    'long-model-name-'.repeat(15),
  )
  await userEvent.setup().click(button)
  const dialog = screen.getByRole('dialog', { name: 'Request details' })
  expect(within(dialog).getByText(identifier)).toBeVisible()
  await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(button).toHaveFocus())
})

it('cancels calendar edits without applying a filter and clears an applied date explicitly', async () => {
  await renderUsage()
  const user = userEvent.setup()
  await screen.findByText('fixture-chat')
  await showFilters()
  await userEvent.setup().click(screen.getByRole('button', { name: 'More filters' }))
  await user.click(screen.getByRole('button', { name: 'From' }))
  let dialog = screen.getByRole('dialog', { name: 'From' })
  await user.click(
    within(dialog)
      .getAllByRole('button')
      .find((button) => !!button.getAttribute('aria-label')?.match(/\d+(st|nd|rd|th), \d{4}/))!,
  )
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent('Choose date and time')
  await user.click(screen.getByRole('button', { name: 'From' }))
  dialog = screen.getByRole('dialog', { name: 'From' })
  await user.click(
    within(dialog)
      .getAllByRole('button')
      .find((button) => !!button.getAttribute('aria-label')?.match(/\d+(st|nd|rd|th), \d{4}/))!,
  )
  await user.click(within(dialog).getByRole('button', { name: 'Apply date' }))
  expect(screen.getByRole('button', { name: 'From' })).not.toHaveTextContent('Choose date and time')
  await user.click(screen.getByRole('button', { name: 'From' }))
  await user.click(
    within(screen.getByRole('dialog', { name: 'From' })).getByRole('button', {
      name: 'Clear date',
    }),
  )
  expect(screen.getByRole('button', { name: 'From' })).toHaveTextContent('Choose date and time')
})

it('keeps metric and chart shells mounted while scoped summaries load without displaying prior-filter amounts', async () => {
  let finish!: () => void
  const delayed = new Promise<void>((resolve) => {
    finish = resolve
  })
  await renderUsage(undefined, undefined, undefined, delayed)
  await screen.findByText('fixture-chat')
  await showFilters()
  await userEvent.setup().click(screen.getByRole('button', { name: 'More filters' }))
  const metrics = screen.getByTestId('usage-summary')
  const chart = screen.getByTestId('usage-chart-shell')
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox', { name: 'Model name or pattern' }), 'changed')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(screen.getByTestId('usage-summary')).toBe(metrics)
  expect(screen.getByTestId('usage-chart-shell')).toBe(chart)
  expect(metrics).toHaveAttribute('aria-busy', 'true')
  expect(within(metrics).getAllByText('—').length).toBeGreaterThan(0)
  finish()
  await waitFor(() => expect(metrics).toHaveAttribute('aria-busy', 'false'))
})

it('keeps the spending shell but removes previous-range chart values until the new range arrives', async () => {
  let finish!: () => void
  const delayed = new Promise<void>((resolve) => {
    finish = resolve
  })
  await renderUsage(undefined, undefined, undefined, delayed)
  await screen.findByText('fixture-chat')
  await showOverview()
  const chart = screen.getByTestId('usage-chart-shell')
  await userEvent.setup().click(within(chart).getByText('Your spending over time'))
  await waitFor(() =>
    expect(within(chart).getByRole('group', { name: 'Daily spending chart' })).toBeVisible(),
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Time period' }))
  await user.click(await screen.findByRole('option', { name: 'Last 24 hours' }))
  expect(screen.getByTestId('usage-chart-shell')).toBe(chart)
  expect(chart).toHaveAttribute('aria-busy', 'true')
  expect(
    within(chart).queryByRole('group', { name: 'Daily spending chart' }),
  ).not.toBeInTheDocument()
  expect(within(chart).getByText('View daily spending')).toHaveAttribute('aria-disabled', 'true')
  finish()
  await waitFor(() =>
    expect(within(chart).getByRole('group', { name: 'Daily spending chart' })).toBeVisible(),
  )
})

it('cancels a pending records query when the user applies a different filter', async () => {
  let finish!: () => void
  const delayed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const fetch = await renderUsage(undefined, undefined, delayed)
  await screen.findByText('fixture-chat')
  const user = userEvent.setup()
  await showFilters()
  await user.click(screen.getByRole('button', { name: 'More filters' }))
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'changed-filter')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  const pending = fetch.mock.calls.find(
    ([path]) => path.startsWith('/api/log/self?') && path.includes('request_id=changed-filter'),
  )
  expect(pending).toBeDefined()
  const signal = pending?.[1]?.signal
  expect(signal).toBeInstanceOf(AbortSignal)
  expect(signal?.aborted).toBe(false)
  await user.clear(screen.getByRole('textbox', { name: 'Request ID' }))
  await user.type(screen.getByRole('textbox', { name: 'Request ID' }), 'latest-filter')
  await user.click(screen.getByRole('button', { name: 'Apply filters' }))
  expect(signal?.aborted).toBe(true)
  await screen.findByText('fixture-chat')
  finish()
})

it('cancels pending spending and chart queries when their filters are replaced', async () => {
  let finish!: () => void
  const delayed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const fetch = await renderUsage(undefined, undefined, undefined, delayed)
  await screen.findByText('fixture-chat')
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Time period' }))
  await user.click(await screen.findByRole('option', { name: 'Last 24 hours' }))
  const reads = fetch.mock.calls.filter(
    ([path]) => path.startsWith('/api/log/self/stat?') || path.startsWith('/api/data/self?'),
  )
  const summarySignals = reads.slice(-2).map(([, options]) => options?.signal)
  expect(summarySignals).toHaveLength(2)
  expect(summarySignals.every((signal) => signal instanceof AbortSignal && !signal.aborted)).toBe(
    true,
  )
  await user.click(screen.getByRole('combobox', { name: 'Time period' }))
  await user.click(await screen.findByRole('option', { name: 'Last 7 days' }))
  expect(summarySignals.every((signal) => signal?.aborted)).toBe(true)
  finish()
})
