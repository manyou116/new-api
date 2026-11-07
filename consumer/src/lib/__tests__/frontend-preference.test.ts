import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const source = readFileSync(resolve(process.cwd(), '../router/frontend-preference.js'), 'utf8')

function bootstrap(options: {
  preference?: string
  available?: boolean
  current?: string
  path?: string
  search?: string
  storage?: Storage
}) {
  const script = document.createElement('script')
  script.dataset.frontend = options.current ?? 'consumer'
  Object.defineProperty(document, 'currentScript', { configurable: true, value: script })
  const replace = vi.fn()
  const browser = {
    location: {
      pathname: options.path ?? '/keys',
      search: options.search ?? '?tab=mine&code=secret&token=secret',
      hash: '#section',
      protocol: 'https:',
      origin: 'https://gateway.test',
      replace,
    },
    factoryShouldUseConsumer: undefined as ((href: string) => boolean) | undefined,
  }
  runInNewContext(
    source.replace(
      '/* factory frontend config */',
      JSON.stringify({
        preference: options.preference ?? '',
        consumerAvailable: options.available ?? true,
        consumerPages: { '/': true, '/keys': true, '/reset': true, '/login': true },
        consumerAliases: {
          '/pricing': '/explore',
          '/console/token': '/keys',
          '/dashboard': '/usage',
          '/sign-in': '/login',
        },
      }),
    ),
    {
      document,
      localStorage: options.storage ?? localStorage,
      window: browser,
      URL,
      URLSearchParams,
    },
  )
  return Object.assign(replace, { shouldUseConsumer: browser.factoryShouldUseConsumer })
}

beforeEach(() => {
  localStorage.clear()
  document.cookie = 'factory_frontend=; Max-Age=0; Path=/'
})

describe('frontend rollout preference', () => {
  it.each(['', 'invalid', 'legacy'])(
    'opens consumer for first visits and retired choices (%s)',
    (preference) => {
      localStorage.setItem('factory:frontend', preference)
      const result = bootstrap({ preference })
      expect(result).not.toHaveBeenCalled()
      expect(result.shouldUseConsumer?.('/keys')).toBe(true)
      expect(result.shouldUseConsumer?.('/pricing')).toBe(true)
      expect(localStorage.getItem('factory:frontend')).toBe('consumer')
    },
  )

  it('restores only a fresh explicit legacy choice', () => {
    localStorage.setItem('factory:frontend', 'legacy-v2')
    const result = bootstrap({})
    expect(document.cookie).toContain('factory_frontend=legacy-v2')
    expect(result).toHaveBeenCalledWith('/keys?tab=mine#section')
    expect(bootstrap({ preference: 'legacy-v2', current: 'legacy' })).not.toHaveBeenCalled()
  })

  it('keeps a server choice ahead of local storage in both directions', () => {
    for (const preference of ['consumer', 'legacy-v2']) {
      localStorage.setItem('factory:frontend', preference === 'consumer' ? 'legacy-v2' : 'consumer')
      expect(bootstrap({ preference })).not.toHaveBeenCalled()
      expect(localStorage.getItem('factory:frontend')).toBe(preference)
    }
  })

  it('preserves bookmark and payment fields but strips callback credentials on correction', () => {
    localStorage.setItem('factory:frontend', 'legacy-v2')
    expect(
      bootstrap({
        search:
          '?keyword=bookmark&request_id=req-1&from=orders&pay=success&batch=batch-1&state=secret&code=secret&token=secret',
      }),
    ).toHaveBeenCalledWith(
      '/keys?keyword=bookmark&request_id=req-1&from=orders&pay=success&batch=batch-1#section',
    )
  })

  it.each([
    '/reset',
    '/user/reset',
    '/oauth/github',
    '/app/oauth/github',
    '/console/subscription',
    '/subscriptions',
  ])('keeps callbacks and management %s in their original application', (path) => {
    expect(bootstrap({ current: 'legacy', path })).not.toHaveBeenCalled()
  })

  it.each(['/pricing', '/pricing/gpt-image-2', '/console/token', '/dashboard'])(
    'moves historical user bookmark %s to the default consumer interface',
    (path) => {
      const result = bootstrap({ current: 'legacy', path })
      expect(result).toHaveBeenCalledWith(path + '?tab=mine#section')
      expect(result.shouldUseConsumer?.(path)).toBe(true)
    },
  )

  it('keeps administration and registered callbacks out of consumer SPA navigation', () => {
    const { shouldUseConsumer } = bootstrap({
      current: 'legacy',
      preference: 'consumer',
      path: '/system-settings',
    })
    for (const path of [
      '/keys',
      '/pricing',
      '/console/token',
      '/dashboard',
      '/sign-in?redirect=%2Fkeys',
    ])
      expect(shouldUseConsumer?.(path), path).toBe(true)
    for (const path of [
      '/subscriptions',
      '/system-settings',
      '/oauth/github?code=original',
      '/reset?token=original',
      '/login?redirect=%2Fsystem-settings',
      'https://elsewhere.test/pricing',
    ])
      expect(shouldUseConsumer?.(path), path).toBe(false)
    document.cookie = 'factory_frontend=legacy-v2; Path=/'
    expect(shouldUseConsumer?.('/pricing')).toBe(false)
  })

  it('does not reload a missing-build fallback or a deliberately selected legacy document', () => {
    expect(bootstrap({ current: 'legacy', available: false }).shouldUseConsumer?.('/pricing')).toBe(
      false,
    )
    document.cookie = 'factory_frontend=legacy-v2; Path=/'
    expect(
      bootstrap({ current: 'legacy', preference: 'legacy-v2' }).shouldUseConsumer?.('/pricing'),
    ).toBe(false)
  })

  it('sanitizes a nested login destination when restoring an explicit legacy choice', () => {
    localStorage.setItem('factory:frontend', 'legacy-v2')
    expect(
      bootstrap({ path: '/login', search: '?next=%2Fkeys%3Fgroup%3Dvip%26token%3Dsecret' }),
    ).toHaveBeenCalledWith('/login?next=%2Fkeys%3Fgroup%3Dvip#section')
  })

  it('continues with consumer when local storage is unavailable', () => {
    const storage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('blocked')
      },
    } as unknown as Storage
    expect(bootstrap({ storage }).shouldUseConsumer?.('/pricing')).toBe(true)
  })

  it('never reloads repeatedly when cookies cannot be persisted', () => {
    localStorage.setItem('factory:frontend', 'legacy-v2')
    vi.spyOn(document, 'cookie', 'set').mockImplementation(() => {})
    expect(bootstrap({})).not.toHaveBeenCalled()
  })
})
