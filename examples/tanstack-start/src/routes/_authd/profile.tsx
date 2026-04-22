import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/_authd/profile')({
  component: AuthenticatedPage,
})

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
  const rows: Array<{ k: string; v: string; mono?: boolean }> = [
    { k: 'user id', v: user.id, mono: true },
    { k: 'email', v: user.email, mono: true },
    { k: 'verified', v: user.emailVerified ? 'yes' : 'no' },
  ]
  if (user.createdAt) {
    rows.push({ k: 'created', v: new Date(user.createdAt).toLocaleString(), mono: true })
  }
  if (user.updatedAt) {
    rows.push({ k: 'updated', v: new Date(user.updatedAt).toLocaleString(), mono: true })
  }

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
      <div className="label-meta mb-6 flex items-center gap-3">
        <span className="signal-dot" aria-hidden />
        session · active
      </div>

      <div className="grid md:grid-cols-12 gap-10">
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
            <span>telemetry</span>
            <span>d1 · row</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.k}
              className="grid grid-cols-12 gap-4 py-4"
              style={{
                borderTop: '1px solid var(--color-line)',
                borderBottom: i === rows.length - 1 ? '1px solid var(--color-line)' : undefined,
              }}
            >
              <dt
                className="col-span-4 label-meta"
                style={{ color: 'var(--color-ink-soft)' }}
              >
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
    </div>
  )
}
