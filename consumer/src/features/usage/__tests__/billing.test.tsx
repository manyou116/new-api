import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
import type { SiteStatus } from '@/lib/status'
import { BillingDetails } from '../BillingDetails'
import { RequestDetails } from '../RequestDetails'
import type { UsageLog } from '../UsagePage'

const expression =
  'len <= 200000 ? tier("standard", p * 2 + c * 10 + cr * 0.1) : tier("long_context", p * 4 + c * 20 + cr * 0.2)'
const recorded = {
  billing_mode: 'tiered_expr',
  billing_unit: 'token',
  matched_tier: 'long_context',
  expr_b64: btoa(expression),
  group_ratio: 0.2,
  billing_explanation: { status: 'available', unit_prices: { p: 0.8, c: 4, cr: 0 } },
  billing_tokens: { len: 322707, p: 403, c: 310, cr: 322304 },
  cache_tokens: 322304,
  admin_info: { secret: 'HIDDEN_ADMIN' },
  root_info: { secret: 'HIDDEN_ROOT' },
}
const log: UsageLog = {
  id: 1,
  type: 2,
  created_at: 1,
  model_name: 'fixture-chat',
  quota: 3614,
  prompt_tokens: 322707,
  completion_tokens: 310,
  is_stream: true,
  use_time: 36,
  group: 'default',
  token_name: 'Editor',
  request_id: 'req-synthetic',
  other: JSON.stringify({ ...recorded, frt: 18930 }),
}

async function renderBilling(content: ReactNode, siteStatus?: SiteStatus) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['status'], {
    quota_per_unit: 500000,
    quota_display_type: 'USD',
    ...siteStatus,
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    </I18nextProvider>,
  )
}

it('shows the recorded tier, full context and historical free unit price without recomputing a charge', async () => {
  await renderBilling(<RequestDetails log={log} />)
  const performance = screen.getByRole('region', { name: 'Response performance' })
  expect(performance).toHaveTextContent('First response latency18.93 s')
  expect(performance).toHaveTextContent('Total duration36 s')
  expect(
    within(screen.getByRole('region', { name: 'Response performance' })).getByText('8.61 token/s'),
  ).toBeVisible()
  expect(within(performance).getByText('18.93 s')).toHaveAttribute(
    'title',
    'Time to the first upstream stream event; this may precede the first text token.',
  )
  expect(screen.queryByText(/TTFT|First token latency/)).not.toBeInTheDocument()
  const tier = screen.getByRole('region', { name: 'Matched tier conditions' })
  expect(tier).toBeVisible()
  expect(tier).toHaveTextContent('Pricing tierlong_context')
  expect(tier).toHaveTextContent('len > 200000')
  expect(tier).toHaveTextContent('Input context length (len)322,707')
  expect(
    screen.getAllByText('Group multiplier').filter((item) => !item.closest('details'))[0],
  ).toBeVisible()
  const prices = screen.getByRole('table')
  const cache = within(prices).getByRole('row', { name: /Cache read tokens/ })
  expect(
    within(cache)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['322,304', '$0.00', '$0.00'])
  const input = within(prices).getByRole('row', { name: /Input tokens/ })
  expect(
    within(input)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['403', '$0.80', '$0.0003224'])
  expect(screen.getAllByText('$0.007228')).toHaveLength(2)
  expect(screen.queryByText(/HIDDEN_ADMIN|HIDDEN_ROOT/)).not.toBeInTheDocument()
})

it('uses the configured symbol and exchange rate for both calculated line costs and recorded totals', async () => {
  await renderBilling(<RequestDetails log={log} />, {
    quota_display_type: 'CUSTOM',
    custom_currency_symbol: '◇',
    custom_currency_exchange_rate: 2.5,
  })
  const table = screen.getByRole('table')
  expect(
    within(table).getByRole('columnheader', { name: 'Price per million tokens' }),
  ).toBeVisible()
  expect(within(table).getByRole('columnheader', { name: 'Cost' })).toBeVisible()
  const input = within(table).getByRole('row', { name: /Input tokens/ })
  expect(
    within(input)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['403', '◇2.00', '◇0.000806'])
  expect(screen.getAllByText('◇0.01807')).toHaveLength(2)
})

it('shows historical rates with missing billable quantities without inventing line amounts', async () => {
  await renderBilling(
    <BillingDetails
      other={JSON.stringify({ ...recorded, billing_tokens: undefined })}
      amount="$0.007228"
    />,
  )
  const input = within(screen.getByRole('table')).getByRole('row', { name: /Input tokens/ })
  expect(
    within(input)
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['—', '$0.80', '—'])
  expect(screen.getByText('$0.007228')).toBeVisible()
})

it('keeps all preceding branch exclusions in a later tier instead of judging it from cached billable input', async () => {
  const multiple =
    'len <= 1000 ? tier("small", p * 1) : len <= 200000 ? tier("standard", p * 2) : tier("long_context", p * 4)'
  await renderBilling(
    <BillingDetails other={JSON.stringify({ ...recorded, expr_b64: btoa(multiple) })} />,
  )
  expect(screen.getByText('len > 1000 && len > 200000')).toBeVisible()
  expect(screen.getByText('Billable input tokens').closest('div')).toHaveTextContent('403')
  await userEvent.click(screen.getByText('Recorded billing expression', { selector: 'summary' }))
  expect(screen.getByText(multiple)).toBeVisible()
})

it('keeps legacy pricing on demand while expression pricing is visible on opening a request', async () => {
  await renderBilling(<RequestDetails log={{ ...log, other: '{"model_ratio":2}' }} />)
  expect(screen.getByText('Model multiplier')).not.toBeVisible()
  await userEvent.click(screen.getByText('Billing details', { selector: 'summary' }))
  expect(screen.getByText('Model multiplier')).toBeVisible()
})

it.each([
  { name: 'missing expression', expr_b64: undefined, matched_tier: 'long_context' },
  { name: 'invalid encoding', expr_b64: 'not base64 !', matched_tier: 'long_context' },
  { name: 'unknown tier', expr_b64: btoa(expression), matched_tier: 'unknown' },
  { name: 'unrecorded tier', expr_b64: btoa(expression), matched_tier: undefined },
  {
    name: 'unsupported expression version',
    expr_b64: btoa(`v2:${expression}`),
    matched_tier: 'long_context',
  },
  {
    name: 'malformed expression',
    expr_b64: btoa('tier("long_context", p * 4'),
    matched_tier: 'long_context',
  },
  {
    name: 'duplicate labels',
    expr_b64: btoa('len <= 200000 ? tier("same", p * 1) : tier("same", p * 2)'),
    matched_tier: 'same',
  },
])('does not infer conditions or current prices for $name', async (snapshot) => {
  await renderBilling(
    <BillingDetails
      other={JSON.stringify({
        ...recorded,
        ...snapshot,
        billing_explanation: undefined,
        billing_tokens: undefined,
      })}
    />,
  )
  expect(screen.getByText('Tier conditions were not recorded or could not be read.')).toBeVisible()
  expect(
    screen.getByText(
      'Historical unit prices were not recorded. Current prices are not substituted.',
    ),
  ).toBeVisible()
  expect(screen.queryByText('len > 200000')).not.toBeInTheDocument()
  expect(screen.getByText('Input context length (len)').closest('div')).toHaveTextContent(
    'Not recorded',
  )
})

it('distinguishes an unconditional recorded tier and explicit zero context from a missing snapshot', async () => {
  await renderBilling(
    <BillingDetails
      other={JSON.stringify({
        ...recorded,
        expr_b64: btoa('tier("long_context", p * 0 + c * 0)'),
        billing_tokens: { len: 0, p: 0, c: 0 },
      })}
    />,
  )
  expect(screen.getByText('No tier condition')).toBeVisible()
  expect(screen.getByText('Input context length (len)').closest('div')).toHaveTextContent('(len)0')
})

it('renders the recorded request-rule result even when the expression or available context suggests another result', async () => {
  const condition = 'param("service_tier") == "fast"'
  await renderBilling(
    <BillingDetails
      other={JSON.stringify({
        ...recorded,
        expr_b64: btoa(`(${expression}) * (${condition} ? 2 : 1)`),
        request_rules: [{ cond: condition, multiplier: 2, matched: false }],
      })}
    />,
  )
  await userEvent.click(screen.getByText('Request pricing rules', { selector: 'summary' }))
  expect(screen.getByText(`${condition} · 2× · Not applied`)).toBeVisible()
  expect(screen.getByText('len > 200000')).toBeVisible()
})

it('keeps quoted expression punctuation and recorded task enum facts as text', async () => {
  const condition = 'u("mode") == "tier?:*"'
  await renderBilling(
    <BillingDetails
      other={JSON.stringify({
        ...recorded,
        expr_b64: btoa(
          `${condition} ? tier("long_context", u("seconds") * 0.4) : tier("other", 0)`,
        ),
        usage_facts: { mode: 'tier?:*', seconds: 8 },
      })}
    />,
  )
  expect(screen.getByText(`(${condition})`)).toBeVisible()
  expect(screen.getByRole('region', { name: 'Recorded usage facts' })).toHaveTextContent(
    'modetier?:*',
  )
})

it.each([
  { is_stream: false, other: JSON.stringify({ frt: 1000 }) },
  { is_stream: true, other: '{}' },
  { is_stream: true, other: JSON.stringify({ frt: 37000 }) },
])(
  'does not invent first-token or first-response timing from invalid stream metadata %j',
  async (timing) => {
    await renderBilling(<RequestDetails log={{ ...log, ...timing }} />)
    const performance = screen.getByRole('region', { name: 'Response performance' })
    expect(
      within(performance).getByText('First response latency').closest('div'),
    ).toHaveTextContent('—')
    expect(performance).not.toHaveTextContent('Time to the first upstream stream event')
  },
)

it.each([
  { progressive: true, amounts: ['$0.0272', '$0.0056'], total: '$0.0328' },
  { progressive: false, amounts: ['$0.06'], total: '$0.06' },
])(
  'shows only the recorded input calculation for progressive=$progressive',
  async ({ progressive, amounts, total }) => {
    await renderBilling(
      <RequestDetails
        log={{
          ...log,
          quota: progressive ? 16400 : 30000,
          other: JSON.stringify({
            ...recorded,
            group_ratio: 1,
            billing_tokens: { len: 300000, p: 300000, c: 0 },
            billing_explanation: {
              status: progressive ? 'not_separable' : 'available',
              context_rates: {
                threshold: 272000,
                within_label: 'standard',
                above_label: 'long_context',
                progressive_input: progressive,
                within: { p: 0.1, c: 0.5 },
                above: { p: 0.2, c: 0.75 },
              },
            },
          }),
        }}
      />,
    )
    const schedule = screen.getByRole('table', { name: 'Tier prices' })
    expect(schedule).toHaveTextContent('272,000')
    const lines = screen.getByRole('table', { name: 'Charge calculation' })
    for (const amount of amounts) expect(within(lines).getByText(amount)).toBeVisible()
    expect(lines).toHaveTextContent(progressive ? '28,000' : '300,000')
    const receipt = screen.getByRole('region', { name: 'Billing details' })
    expect(within(receipt).getByText('Recorded amount').parentElement).toHaveTextContent(total)
  },
)
