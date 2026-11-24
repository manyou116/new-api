import { Link, Outlet, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/session'
import { ErrorState, LoadingState } from './ui'

// beforeLoad gates navigation and loaders; this boundary immediately hides
// an already-mounted private page when the session changes or is suspended.
export function ProtectedRoute() {
  const session = useSession()
  if (session.authenticationError) return <RouteError error={session.authenticationError} />
  if (session.status !== 'authenticated') return <LoadingState />
  return <Outlet key={session.sessionId} />
}

export function GuestRoute() {
  const session = useSession()
  if (
    session.status === 'authenticated' ||
    (session.status === 'loading' && !session.authenticationError)
  )
    return <LoadingState />
  return <Outlet />
}

export function RouteError(props: Pick<ErrorComponentProps, 'error'>) {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useSession()
  const chunkFailed =
    props.error instanceof Error &&
    (props.error.name === 'ChunkLoadError' ||
      /^(?:Loading (?:CSS )?chunk .+ failed|Failed to fetch dynamically imported module|Importing a module script failed)/i.test(
        props.error.message,
      ))
  return (
    <div className="state">
      <ErrorState
        error={
          chunkFailed
            ? new Error('Some page files could not load. Refresh the page to try again.')
            : props.error
        }
        retryLabel={chunkFailed ? t('Refresh page') : undefined}
        retry={() => {
          // React.lazy remembers the rejected import in this document.
          if (chunkFailed) {
            window.location.reload()
            return
          }
          void (async () => {
            if (session.authenticationError) await session.retryAuthentication()
            await router.invalidate()
          })()
        }}
      />
      <Link to="/" className="button button-ghost">
        {t('Back to home')}
      </Link>
    </div>
  )
}
