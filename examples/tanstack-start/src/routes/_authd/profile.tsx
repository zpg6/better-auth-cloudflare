import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/_authd/profile')({
  component: AuthenticatedPage,
})

type GeoSession = {
  ipAddress?: string | null
  userAgent?: string | null
  timezone?: string | null
  city?: string | null
  country?: string | null
  region?: string | null
  regionCode?: string | null
  colo?: string | null
  latitude?: string | null
  longitude?: string | null
  createdAt?: string | Date | null
  expiresAt?: string | Date | null
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (v instanceof Date) return v.toLocaleString()
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleString()
  }
  return String(v)
}

function AuthenticatedPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-5 md:px-8 py-16">
        <div
          className="h-4 w-40 mb-6 animate-pulse"
          style={{ background: 'var(--color-surface-2)' }}
        />
        <div
          className="h-32 w-full animate-pulse"
          style={{ background: 'var(--color-surface-2)' }}
        />
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div className="mx-auto max-w-6xl px-5 md:px-8 py-16">
        <p className="label-meta">not authenticated</p>
      </div>
    )
  }

  const { user } = session
  const sess = (session.session ?? {}) as GeoSession

  const userRows: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: 'user id', v: user.id, mono: true },
    { k: 'email', v: user.email, mono: true },
    { k: 'verified', v: user.emailVerified ? 'yes' : 'no' },
  ]
  if (user.createdAt) userRows.push({ k: 'created', v: fmt(user.createdAt), mono: true })
  if (user.updatedAt) userRows.push({ k: 'updated', v: fmt(user.updatedAt), mono: true })

  const sessionRows: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: 'ip', v: fmt(sess.ipAddress), mono: true },
    { k: 'colo', v: fmt(sess.colo), mono: true },
    { k: 'country', v: fmt(sess.country), mono: true },
    { k: 'region', v: fmt([sess.region, sess.regionCode].filter(Boolean).join(' / ')) },
    { k: 'city', v: fmt(sess.city) },
    { k: 'timezone', v: fmt(sess.timezone), mono: true },
    {
      k: 'coords',
      v: sess.latitude && sess.longitude ? `${sess.latitude}, ${sess.longitude}` : '—',
      mono: true,
    },
    { k: 'expires', v: fmt(sess.expiresAt), mono: true },
  ]

  const mapSrc =
    sess.latitude && sess.longitude
      ? `https://www.google.com/maps?q=${sess.latitude},${sess.longitude}&z=7&output=embed`
      : null

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
      <div className="label-meta mb-6 flex items-center gap-3">
        <span className="signal-dot" aria-hidden />
        session · active
      </div>

      {/* identity hero */}
      <div className="grid md:grid-cols-12 gap-10 mb-16">
        <div className="md:col-span-5">
          <div className="flex items-center gap-5">
            {user.image ? (
              <img
                src={user.image}
                alt=""
                className="h-20 w-20"
                style={{ border: '1px solid var(--color-line-strong)' }}
              />
            ) : (
              <div
                className="h-20 w-20 flex items-center justify-center font-display"
                style={{
                  background: 'var(--color-ink)',
                  color: 'var(--color-paper)',
                  fontSize: '32px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <div>
              <h1
                className="font-display"
                style={{
                  fontSize: 'clamp(1.75rem, 3vw, 2.5rem)',
                  fontWeight: 760,
                  letterSpacing: '-0.025em',
                  lineHeight: 1,
                }}
              >
                {user.name || 'Unnamed'}
              </h1>
              <p
                className="mt-2 text-[14px] font-mono"
                style={{ color: 'var(--color-ink-dim)' }}
              >
                {user.email}
              </p>
            </div>
          </div>

          <p
            className="mt-8 max-w-[40ch] text-[14px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            This is what a protected route looks like. If the session expires,
            the <code className="code-chip">_authd</code> layout redirects you
            back to sign-in before render.
          </p>
        </div>

        <dl className="md:col-span-7 md:pt-2">
          <div className="label-meta mb-3 flex items-center justify-between">
            <span>account</span>
            <span>d1 · users row</span>
          </div>
          {userRows.map((r, i) => (
            <div
              key={r.k}
              className="grid grid-cols-12 gap-4 py-4"
              style={{
                borderTop: '1px solid var(--color-line)',
                borderBottom: i === userRows.length - 1 ? '1px solid var(--color-line)' : undefined,
              }}
            >
              <dt className="col-span-4 label-meta" style={{ color: 'var(--color-ink-soft)' }}>
                {r.k}
              </dt>
              <dd
                className={'col-span-8 text-[14px] ' + (r.mono ? 'font-mono' : '')}
                style={{ color: 'var(--color-ink)', wordBreak: 'break-all' }}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* edge telemetry */}
      <section className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="label-meta mb-4 flex items-center gap-2">
            <span className="signal-dot" aria-hidden />
            § edge telemetry
          </div>
          <h2
            className="font-display text-3xl md:text-4xl"
            style={{ fontWeight: 720, letterSpacing: '-0.025em', lineHeight: 1 }}
          >
            Where this
            <br />
            request
            <br />
            <span style={{ color: 'var(--color-signal)' }}>landed.</span>
          </h2>
          <p
            className="mt-6 max-w-[36ch] text-[14px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            Populated by Cloudflare's <code className="code-chip">request.cf</code>{' '}
            object and persisted onto the session row by{' '}
            <code className="code-chip">better-auth-cloudflare</code> with{' '}
            <code className="code-chip">geolocationTracking: true</code>.
          </p>

          <div
            className="mt-6 p-4 text-[13px] font-mono"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              borderRadius: '2px',
              color: 'var(--color-ink-dim)',
              lineHeight: 1.5,
            }}
          >
            <span
              className="label-meta"
              style={{ color: 'var(--color-signal)', display: 'block', marginBottom: '6px' }}
            >
              ! dev environment
            </span>
            These fields stay empty under{' '}
            <code className="code-chip">pnpm dev</code>. Cloudflare only
            populates <code className="code-chip">request.cf</code> once the
            request is served by a real Worker — deploy to see live values.
          </div>

          {mapSrc && (
            <div
              className="mt-8 hidden md:block"
              style={{
                border: '1px solid var(--color-line)',
                borderRadius: '2px',
                overflow: 'hidden',
                aspectRatio: '4 / 3',
                background: 'var(--color-surface)',
              }}
            >
              <iframe
                title="Approximate edge location"
                src={mapSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                style={{ width: '100%', height: '100%', border: 0, filter: 'grayscale(0.3) contrast(1.05)' }}
              />
            </div>
          )}
        </div>

        <dl className="md:col-span-8">
          <div className="label-meta mb-3 flex items-center justify-between">
            <span>session row</span>
            <span>request.cf · fields</span>
          </div>
          {sessionRows.map((r, i) => (
            <div
              key={r.k}
              className="grid grid-cols-12 gap-4 py-4"
              style={{
                borderTop: '1px solid var(--color-line)',
                borderBottom: i === sessionRows.length - 1 ? '1px solid var(--color-line)' : undefined,
              }}
            >
              <dt className="col-span-4 label-meta" style={{ color: 'var(--color-ink-soft)' }}>
                {r.k}
              </dt>
              <dd
                className={'col-span-8 text-[14px] ' + (r.mono ? 'font-mono' : '')}
                style={{ color: 'var(--color-ink)', wordBreak: 'break-all' }}
              >
                {r.v}
              </dd>
            </div>
          ))}
          {sess.userAgent && (
            <div className="mt-6">
              <div className="label-meta mb-2">user agent</div>
              <code
                className="block text-[12px] font-mono p-3"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-line)',
                  borderRadius: '2px',
                  color: 'var(--color-ink-dim)',
                  wordBreak: 'break-all',
                }}
              >
                {sess.userAgent}
              </code>
            </div>
          )}
        </dl>
      </section>
    </div>
  )
}
