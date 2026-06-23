/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Eye, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Dialog } from '@/components/dialog'
import { StaticDataTable } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  getUserReview,
  getAdminUserTokens,
  revealAdminUserTokenKey,
  updateAdminUserTokenGroup,
  updateUserBillingPreference,
  updateUserGroup,
} from '../../api'
import type { AdminUserToken, User, UserReviewSummary } from '../../types'

const BILLING_PREFERENCE_OPTIONS = [
  { value: 'subscription_first', label: 'Subscription First' },
  { value: 'wallet_first', label: 'Wallet First' },
  { value: 'subscription_only', label: 'Subscription Only' },
  { value: 'wallet_only', label: 'Wallet Only' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
  onSuccess?: () => void
}

function formatTimestamp(value: unknown) {
  const timestamp = Number(value || 0)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-'
  return new Date(timestamp * 1000).toLocaleString()
}

function asNumber(value: unknown) {
  const numberValue = Number(value || 0)
  return Number.isFinite(numberValue) ? numberValue : 0
}

function getUserStatus(user?: User | null) {
  if (!user) return { label: '-', variant: 'neutral' as const }
  if (user.DeletedAt !== null && user.DeletedAt !== undefined) {
    return { label: 'Deleted', variant: 'danger' as const }
  }
  if (user.status === 1) return { label: 'Enabled', variant: 'success' as const }
  if (user.status === 2) return { label: 'Disabled', variant: 'danger' as const }
  return { label: 'Unknown', variant: 'neutral' as const }
}

function getRoleLabel(role?: number) {
  if (role === 100) return 'Root'
  if (role === 10) return 'Admin'
  if (role === 1) return 'User'
  return 'Unknown'
}

function InfoItem(props: { label: string; children: ReactNode }) {
  return (
    <div className='rounded-md border p-3'>
      <div className='text-muted-foreground text-xs'>{props.label}</div>
      <div className='mt-1 min-w-0 text-sm font-medium break-words'>
        {props.children}
      </div>
    </div>
  )
}

export function UserReviewDialog(props: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<UserReviewSummary | null>(null)
  const [billingPreference, setBillingPreference] = useState(
    'subscription_first'
  )
  const [userGroup, setUserGroup] = useState('')
  const [savingBilling, setSavingBilling] = useState(false)
  const [savingGroup, setSavingGroup] = useState(false)
  const [tokens, setTokens] = useState<AdminUserToken[]>([])
  const [revealingTokenId, setRevealingTokenId] = useState<number | null>(null)
  const [savingTokenGroupId, setSavingTokenGroupId] = useState<number | null>(
    null
  )

  const loadData = useCallback(async () => {
    if (!props.user?.id) return
    setLoading(true)
    try {
      const [res, tokenRes] = await Promise.all([
        getUserReview(props.user.id),
        getAdminUserTokens(props.user.id).catch(() => null),
      ])
      if (res.success && res.data) {
        setSummary(res.data)
        setBillingPreference(
          res.data.billing_preference || 'subscription_first'
        )
        setUserGroup(res.data.user?.group || props.user.group || 'default')
      } else {
        toast.error(res.message || t('Failed to load'))
      }
      if (tokenRes?.success) {
        setTokens(tokenRes.data?.items || [])
      } else {
        setTokens([])
      }
    } catch {
      toast.error(t('Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [props.user, t])

  useEffect(() => {
    if (props.open && props.user?.id) {
      loadData()
    } else if (!props.open) {
      setSummary(null)
      setBillingPreference('subscription_first')
      setUserGroup('')
      setTokens([])
    }
  }, [props.open, props.user?.id, loadData])

  const reviewUser = summary?.user || props.user
  const status = getUserStatus(reviewUser)
  const usage = summary?.usage || {}
  const security = summary?.security || {}
  const availableGroups = summary?.available_groups || {}
  const groupOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...Object.keys(availableGroups),
            userGroup,
            ...tokens.map((token) => token.group),
          ].filter(Boolean)
        )
      ).sort(),
    [availableGroups, tokens, userGroup]
  )
  const bindingRows = useMemo(
    () => (summary?.bindings || []).filter((binding) => binding.value),
    [summary?.bindings]
  )
  const subscriptionRows = summary?.subscriptions || []

  const handleSaveBillingPreference = async () => {
    if (!reviewUser?.id) return
    setSavingBilling(true)
    try {
      const res = await updateUserBillingPreference(
        reviewUser.id,
        billingPreference
      )
      if (res.success) {
        const nextPreference =
          res.data?.billing_preference || billingPreference
        setBillingPreference(nextPreference)
        setSummary((prev) =>
          prev ? { ...prev, billing_preference: nextPreference } : prev
        )
        toast.success(t('Saved successfully'))
        props.onSuccess?.()
      } else {
        toast.error(res.message || t('Save failed'))
      }
    } catch {
      toast.error(t('Save failed'))
    } finally {
      setSavingBilling(false)
    }
  }

  const handleSaveGroup = async () => {
    if (!reviewUser?.id || !userGroup) return
    setSavingGroup(true)
    try {
      const res = await updateUserGroup(reviewUser.id, userGroup)
      if (res.success) {
        const nextGroup = res.data?.group || userGroup
        setUserGroup(nextGroup)
        setSummary((prev) =>
          prev && prev.user
            ? { ...prev, user: { ...prev.user, group: nextGroup } }
            : prev
        )
        toast.success(t('Saved successfully'))
        props.onSuccess?.()
      } else {
        toast.error(res.message || t('Save failed'))
      }
    } catch {
      toast.error(t('Save failed'))
    } finally {
      setSavingGroup(false)
    }
  }

  const handleRevealTokenKey = async (tokenId: number) => {
    if (!reviewUser?.id) return
    setRevealingTokenId(tokenId)
    try {
      const res = await revealAdminUserTokenKey(reviewUser.id, tokenId)
      if (res.success && res.data?.key) {
        const fullKey = res.data.key
        setTokens((prev) =>
          prev.map((token) =>
            token.id === tokenId ? { ...token, key: fullKey } : token
          )
        )
        toast.success(t('API key revealed'))
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setRevealingTokenId(null)
    }
  }

  const handleSaveTokenGroup = async (tokenId: number, group: string) => {
    if (!reviewUser?.id || !group) return
    setSavingTokenGroupId(tokenId)
    try {
      const res = await updateAdminUserTokenGroup(reviewUser.id, tokenId, group)
      if (res.success) {
        const nextGroup = res.data?.group || group
        setTokens((prev) =>
          prev.map((token) =>
            token.id === tokenId ? { ...token, group: nextGroup } : token
          )
        )
        toast.success(t('Saved successfully'))
      } else {
        toast.error(res.message || t('Save failed'))
      }
    } catch {
      toast.error(t('Save failed'))
    } finally {
      setSavingTokenGroupId(null)
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <span className='flex items-center gap-2'>
          <Eye className='h-5 w-5' />
          {t('User Review')}
        </span>
      }
      description={
        reviewUser
          ? `${reviewUser.username || '-'} (ID: ${reviewUser.id})`
          : t('Loading...')
      }
      contentClassName='sm:max-w-5xl'
      bodyClassName='space-y-5'
    >
      {loading && !summary ? (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('Loading...')}
        </div>
      ) : (
        <>
          <div className='grid gap-3 md:grid-cols-4'>
            <InfoItem label={t('Status')}>
              <StatusBadge
                label={t(status.label)}
                variant={status.variant}
                copyable={false}
              />
            </InfoItem>
            <InfoItem label={t('Role')}>
              {t(getRoleLabel(reviewUser?.role))}
            </InfoItem>
            <InfoItem label={t('Group')}>
              <GroupBadge group={reviewUser?.group || userGroup} />
            </InfoItem>
            <InfoItem label={t('Display Name')}>
              {reviewUser?.display_name || '-'}
            </InfoItem>
            <InfoItem label={t('Quota')}>
              {formatQuota(asNumber(reviewUser?.quota))}
            </InfoItem>
            <InfoItem label={t('Used Quota')}>
              {formatQuota(
                asNumber(usage.used_quota ?? reviewUser?.used_quota)
              )}
            </InfoItem>
            <InfoItem label={t('Requests')}>
              {asNumber(usage.request_count ?? reviewUser?.request_count)}
            </InfoItem>
            <InfoItem label={t('Subscription')}>
              {summary?.has_subscription || reviewUser?.has_subscription
                ? summary?.subscription_plan ||
                  reviewUser?.subscription_plan ||
                  t('Subscribed')
                : t('None')}
            </InfoItem>
            <InfoItem label={t('Created At')}>
              {formatTimestamp(reviewUser?.created_at)}
            </InfoItem>
            <InfoItem label={t('Last Login')}>
              {formatTimestamp(reviewUser?.last_login_at)}
            </InfoItem>
            <InfoItem label={t('Last Request')}>
              {formatTimestamp(
                usage.last_request_at ?? reviewUser?.last_request_at
              )}
            </InfoItem>
            <InfoItem label={t('Recently Active')}>
              {summary?.is_recently_active || reviewUser?.is_recently_active
                ? t('Yes')
                : t('No')}
            </InfoItem>
          </div>

          <div className='grid gap-3 md:grid-cols-2'>
            <div className='rounded-md border p-3'>
              <div className='mb-2 text-sm font-medium'>
                {t('Billing Preference')}
              </div>
              <div className='flex gap-2'>
                <Select
                  value={billingPreference}
                  onValueChange={(value) =>
                    value && setBillingPreference(value)
                  }
                  items={BILLING_PREFERENCE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                  }))}
                >
                  <SelectTrigger className='flex-1'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {BILLING_PREFERENCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {t(option.label)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  type='button'
                  onClick={handleSaveBillingPreference}
                  disabled={savingBilling}
                >
                  <Save className='mr-1 h-4 w-4' />
                  {t('Save')}
                </Button>
              </div>
            </div>

            <div className='rounded-md border p-3'>
              <div className='mb-2 text-sm font-medium'>{t('User Group')}</div>
              <div className='flex gap-2'>
                <Select
                  value={userGroup}
                  onValueChange={(value) => value && setUserGroup(value)}
                  items={groupOptions.map((group) => ({
                    value: group,
                    label: `${group}${availableGroups[group] ? ` · ${availableGroups[group]}` : ''}`,
                  }))}
                >
                  <SelectTrigger className='flex-1'>
                    <SelectValue placeholder={t('Select group')} />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {groupOptions.map((group) => (
                        <SelectItem key={group} value={group}>
                          {group}
                          {availableGroups[group]
                            ? ` · ${availableGroups[group]}`
                            : ''}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  type='button'
                  onClick={handleSaveGroup}
                  disabled={savingGroup || !userGroup}
                >
                  <Save className='mr-1 h-4 w-4' />
                  {t('Save')}
                </Button>
              </div>
            </div>
          </div>

          <div className='grid gap-3 md:grid-cols-3'>
            <InfoItem label='2FA'>
              {summary?.has_two_fa || security.has_2fa
                ? t('Enabled')
                : t('Disabled')}
            </InfoItem>
            <InfoItem label='Passkey'>
              {summary?.has_passkey || security.has_passkey
                ? t('Enabled')
                : t('Disabled')}
            </InfoItem>
            <InfoItem label={t('Bindings')}>
              {summary?.binding_count ??
                (asNumber(security.binding_count) || bindingRows.length)}
            </InfoItem>
          </div>

          <div className='space-y-2'>
            <h3 className='text-sm font-semibold'>{t('Bindings')}</h3>
            <StaticDataTable
              data={bindingRows}
              getRowKey={(record) => record.key}
              emptyContent={t('No bindings')}
              columns={[
                {
                  id: 'provider',
                  header: t('Provider'),
                  cell: (record) => record.label || record.key,
                },
                {
                  id: 'value',
                  header: t('External ID'),
                  cell: (record) => (
                    <span className='break-all'>{record.value || '-'}</span>
                  ),
                },
                {
                  id: 'type',
                  header: t('Type'),
                  cell: (record) => (
                    <StatusBadge
                      label={record.is_custom ? t('Custom') : t('Built-in')}
                      variant='neutral'
                      copyable={false}
                    />
                  ),
                },
              ]}
            />
          </div>

          <div className='space-y-2'>
            <h3 className='text-sm font-semibold'>{t('API Keys')}</h3>
            <StaticDataTable
              data={tokens}
              getRowKey={(record) => record.id}
              emptyContent={t('No API keys')}
              columns={[
                {
                  id: 'id',
                  header: t('ID'),
                  cell: (record) => <TableId value={record.id} />,
                },
                {
                  id: 'name',
                  header: t('Name'),
                  cell: (record) => record.name || '-',
                },
                {
                  id: 'key',
                  header: 'Key',
                  cell: (record) => (
                    <div className='flex max-w-72 items-center gap-2'>
                      <span className='min-w-0 truncate font-mono text-xs'>
                        {record.key || '-'}
                      </span>
                      <Button
                        type='button'
                        size='sm'
                        variant='outline'
                        onClick={() => handleRevealTokenKey(record.id)}
                        disabled={revealingTokenId === record.id}
                      >
                        {t('Reveal')}
                      </Button>
                    </div>
                  ),
                },
                {
                  id: 'group',
                  header: t('Group'),
                  cell: (record) => (
                    <div className='flex items-center gap-2'>
                      <Select
                        value={record.group || userGroup}
                        onValueChange={(value) =>
                          value && handleSaveTokenGroup(record.id, value)
                        }
                        items={groupOptions.map((group) => ({
                          value: group,
                          label: group,
                        }))}
                      >
                        <SelectTrigger className='w-36'>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent alignItemWithTrigger={false}>
                          <SelectGroup>
                            {groupOptions.map((group) => (
                              <SelectItem key={group} value={group}>
                                {group}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {savingTokenGroupId === record.id && (
                        <span className='text-muted-foreground text-xs'>
                          {t('Saving...')}
                        </span>
                      )}
                    </div>
                  ),
                },
                {
                  id: 'quota',
                  header: t('Quota'),
                  cell: (record) =>
                    record.unlimited_quota
                      ? t('Unlimited')
                      : formatQuota(asNumber(record.remain_quota)),
                },
              ]}
            />
          </div>

          <div className='space-y-2'>
            <h3 className='text-sm font-semibold'>{t('Subscriptions')}</h3>
            <StaticDataTable
              data={subscriptionRows}
              getRowKey={(record, index) => record.subscription?.id ?? index}
              emptyContent={t('No subscription records')}
              columns={[
                {
                  id: 'id',
                  header: t('ID'),
                  cell: (record) =>
                    record.subscription?.id ? (
                      <TableId value={record.subscription.id} />
                    ) : (
                      '-'
                    ),
                },
                {
                  id: 'plan',
                  header: t('Plan'),
                  cell: (record) => `#${record.subscription?.plan_id || '-'}`,
                },
                {
                  id: 'status',
                  header: t('Status'),
                  cell: (record) => (
                    <StatusBadge
                      label={record.subscription?.status || '-'}
                      variant={
                        record.subscription?.status === 'active'
                          ? 'success'
                          : 'neutral'
                      }
                      copyable={false}
                    />
                  ),
                },
                {
                  id: 'usage',
                  header: t('Usage'),
                  cell: (record) => {
                    const sub = record.subscription
                    const total = asNumber(sub?.amount_total)
                    const used = asNumber(sub?.amount_used)
                    return total > 0
                      ? `${formatQuota(used)} / ${formatQuota(total)}`
                      : `${formatQuota(used)} / ${t('Unlimited')}`
                  },
                },
                {
                  id: 'period',
                  header: t('Period'),
                  cell: (record) => {
                    const sub = record.subscription
                    return `${formatTimestamp(sub?.start_time)} → ${formatTimestamp(sub?.end_time)}`
                  },
                },
              ]}
            />
          </div>
        </>
      )}
    </Dialog>
  )
}
