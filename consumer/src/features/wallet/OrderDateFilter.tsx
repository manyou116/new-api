import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Field, Input, Modal } from '@/components/ui'

type Preset = 'week' | 'month' | 'last30'

export interface OrderDateRange {
  kind: Preset | 'custom'
  from: string
  through: string
}

const maxRangeSeconds = 366 * 86400

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

export function orderDatePreset(kind: Preset, today = new Date()): OrderDateRange {
  const start = new Date(today)
  if (kind === 'month') start.setDate(1)
  else start.setDate(start.getDate() - (kind === 'week' ? 6 : 29))
  return { kind, from: dateInputValue(start), through: dateInputValue(today) }
}

// Use local midnights rather than elapsed 24-hour increments across DST changes.
export function orderDateBounds(range: OrderDateRange) {
  const start = new Date(range.from + 'T00:00:00')
  const end = new Date(range.through + 'T00:00:00')
  end.setDate(end.getDate() + 1)
  return { start: start.getTime() / 1000, end: end.getTime() / 1000 }
}

export function OrderDateFilter(props: {
  value: OrderDateRange
  onChange: (value: OrderDateRange) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const today = dateInputValue(new Date())

  return (
    <>
      <div className="order-date-presets" role="group" aria-label={t('Date range')}>
        {(
          [
            ['week', t('Last 7 days')],
            ['last30', t('Last 30 days')],
            ['month', t('This month')],
          ] as const
        ).map(([kind, label]) => (
          <Button
            key={kind}
            variant="secondary"
            aria-pressed={props.value.kind === kind}
            onClick={() => props.onChange(orderDatePreset(kind))}
          >
            {label}
          </Button>
        ))}
        <Button
          variant="secondary"
          aria-haspopup="dialog"
          aria-pressed={props.value.kind === 'custom'}
          onClick={() => {
            setOpen(true)
            setError(false)
          }}
        >
          <CalendarDays size={16} aria-hidden="true" />
          {t('Custom')}
        </Button>
      </div>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={t('Date range')}
          description={t('Uses your device time zone.')}
        >
          <form
            className="stack"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              const data = new FormData(event.currentTarget)
              const next: OrderDateRange = {
                kind: 'custom',
                from: String(data.get('from') ?? ''),
                through: String(data.get('through') ?? ''),
              }
              const { start, end } = orderDateBounds(next)
              if (
                !(start > 0 && end > start && end - start <= maxRangeSeconds) ||
                next.through > today
              ) {
                setError(true)
                return
              }
              props.onChange(next)
              setOpen(false)
            }}
          >
            <div className="order-custom-dates">
              <Field label={t('From')}>
                <Input
                  type="date"
                  name="from"
                  defaultValue={props.value.from}
                  max={today}
                  required
                />
              </Field>
              <Field
                label={t('Until')}
                error={error && t('Choose a valid date range of up to 366 days.')}
              >
                <Input
                  type="date"
                  name="through"
                  defaultValue={props.value.through}
                  max={today}
                  required
                />
              </Field>
            </div>
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit">{t('Apply filters')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
