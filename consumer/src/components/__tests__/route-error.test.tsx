import { fireEvent, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'
import { RouteError } from '../route-guard'

vi.mock('@/lib/session', () => ({ useSession: () => ({}) }))
afterEach(() => vi.unstubAllGlobals())

it('reloads the current document when a route chunk is missing', async () => {
  const reload = vi.fn()
  vi.stubGlobal('location', { reload })
  const error = new Error('Loading chunk s failed. (error: https://example.test/old.js)')
  error.name = 'ChunkLoadError'
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/account'] }),
    routeTree: createRootRoute({ component: () => <RouteError error={error} /> }),
  })
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={i18n}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  )
  expect(await screen.findByRole('alert')).not.toHaveTextContent('old.js')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh page' }))
  expect(reload).toHaveBeenCalledOnce()
})
