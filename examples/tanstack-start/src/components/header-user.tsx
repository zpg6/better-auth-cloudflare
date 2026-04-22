import { Link } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

type GeoSession = {
  colo?: string | null
  country?: string | null
  city?: string | null
  region?: string | null
}
interface props { geo: GeoSession }

export default function BetterAuthHeader({geo}: props) {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div
        className="h-8 w-20 animate-pulse"
        style={{ background: 'var(--color-surface-2)' }}
      />
    )
  }

  if (session?.user) {
    // const geo = (session.session ?? {})// as GeoSession
    const pieces = [geo.colo, geo.country].filter(Boolean) as string[]

    return (
      <div className="flex items-center gap-3">
        {pieces.length > 0 && (
          <span
            className="hidden md:inline-flex items-center label-meta"
            title={[geo.city, geo.region, geo.country].filter(Boolean).join(', ')}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--color-line)',
              background: 'var(--color-surface)',
              borderRadius: '2px',
            }}
          >
            {pieces.join(' · ')}
          </span>
        )}
        <Link to="/profile" className="flex items-center gap-2 group" aria-label="Profile">
          {session.user.image ? (
            <img
              src={session.user.image}
              alt=""
              className="h-7 w-7 rounded-none"
              style={{ border: '1px solid var(--color-line-strong)' }}
            />
          ) : (
            <div
              className="h-7 w-7 flex items-center justify-center font-display"
              style={{
                background: 'var(--color-ink)',
                color: 'var(--color-paper)',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {session.user.name?.charAt(0).toUpperCase() || 'U'}
            </div>
          )}
          <span
            className="hidden md:inline text-[13px] font-medium transition-colors group-hover:opacity-80"
            style={{ color: 'var(--color-ink)' }}
          >
            {session.user.name || session.user.email}
          </span>
        </Link>
        <button
          onClick={() => {
            void authClient.signOut()
          }}
          className="btn-ghost"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Link to="/sign-up" className="hidden sm:inline-flex btn-ghost">
        Create account
      </Link>
      <Link
        to="/sign-in"
        className="btn-primary"
        style={{ height: '36px', fontSize: '13px', padding: '0 16px' }}
      >
        Sign in →
      </Link>
    </div>
  )
}
