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
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'

export function FrontendEntry() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const user = useAuthStore((state) => state.auth.user)
  if (
    !user ||
    user.role < 10 ||
    !status?.frontend_enabled ||
    !status.frontend_available
  ) {
    return null
  }
  // This document navigation lets the server persist the interface preference.
  return (
    <Button
      nativeButton={false}
      role='link'
      variant='default'
      size='lg'
      className='h-10 max-w-full gap-2 rounded-xl px-3 shadow-xs transition-colors active:not-aria-[haspopup]:translate-y-0 motion-reduce:transition-none'
      aria-label={t('New interface')}
      render={<a href='/frontend/switch?version=consumer&return_to=/' />}
    >
      <span className='truncate'>{t('New interface')}</span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        strokeWidth={2}
        aria-hidden='true'
      />
    </Button>
  )
}
