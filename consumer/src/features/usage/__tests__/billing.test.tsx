import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, it } from 'vitest'
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

async function renderBilling(content: ReactNode) {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['status'], { quota_per_unit: 500000, quota_display_type: 'USD' })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>{content}</QueryClientProvider>
    </I18nextProvider>,
  )
}

it('shows the recorded tier, full context and historical free unit price without recomputing a charge', async () => {
  await renderBilling(<RequestDetails log={log} />)
  const performance = screen.getByRole('region', { name: 'Response performance' })
  expect(performance).toHaveTextContent('First response latency18.93 sec')
  expect(performance).toHaveTextContent('Total duration36 sec')
  expect(performance).toHaveTextContent('Average output speed8.61 token/s')
  expect(performance).toHaveTextContent(
    'Time to the first upstream stream event; this may precede the first text token.',
  )
  expect(screen.queryByText(/TTFT|First token latency/)).not.toBeInTheDocument()
  const tier = screen.getByRole('region', { name: 'Matched tier conditions' })
  expect(tier).toBeVisible()
  expect(tier).toHaveTextContent('Pricing tierlong_context')
  expect(tier).toHaveTextContent('len > 200000')
  expect(tier).toHaveTextContent('Input context length (len)322,707')
  expect(screen.getByText('Group multiplier').closest('div')).toHaveTextContent('0.2×')
  expect(screen.getByText('$0.00 per million tokens')).toBeVisible()
  expect(screen.getByText('$0.80 per million tokens')).toBeVisible()
  expect(screen.getByText('Recorded amount').closest('div')).toHaveTextContent('$0.007228')
  expect(screen.queryByText(/HIDDEN_ADMIN|HIDDEN_ROOT/)).not.toBeInTheDocument()
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
