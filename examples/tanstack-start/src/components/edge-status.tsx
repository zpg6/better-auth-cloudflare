import { authClient } from '#/lib/auth-client'

type GeoSession = {
  ipAddress?: string | null
  timezone?: string | null
  city?: string | null
  country?: string | null
  region?: string | null
  regionCode?: string | null
  colo?: string | null
  latitude?: string | null
  longitude?: string | null
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

export function EdgeStatus() {
  const { data: session } = authClient.useSession()
  const sess = (session?.session ?? {}) as GeoSession
  const signedIn = Boolean(session?.user)

  const rows: Array<[string, string]> = signedIn
    ? [
        ['colo', fmt(sess.colo)],
        ['country', fmt(sess.country)],
        ['region', fmt([sess.region, sess.regionCode].filter(Boolean).join(' / '))],
        ['city', fmt(sess.city)],
        ['timezone', fmt(sess.timezone)],
        ['ip', fmt(sess.ipAddress)],
        [
          'coords',
          sess.latitude && sess.longitude ? `${sess.latitude}, ${sess.longitude}` : '—',
        ],
        ['expires', fmt(sess.expiresAt)],
      ]
    : []

  return (
    <span
      className="edge-status"
      tabIndex={0}
      aria-describedby="edge-status-popover"
      role="button"
    >
      <span className="inline-flex items-center gap-2 label-meta">
        <span className="signal-dot" aria-hidden />
        edge · live
      </span>

      <span
        id="edge-status-popover"
        role="tooltip"
        className="edge-status__pop panel"
      >
        <span className="edge-status__arrow" aria-hidden />

        <span className="flex items-center justify-between mb-3">
          <span className="label-meta" style={{ color: 'var(--color-signal)' }}>
            § session telemetry
          </span>
          <span className="label-meta">request.cf</span>
        </span>

        {signedIn ? (
          <span className="block">
            {rows.map(([k, v], i) => (
              <span
                key={k}
                className="grid grid-cols-12 gap-3 py-2 text-[12px]"
                style={{
                  borderTop: i === 0 ? 'none' : '1px solid var(--color-line)',
                }}
              >
                <span
                  className="col-span-5 label-meta"
                  style={{ color: 'var(--color-ink-soft)' }}
                >
                  {k}
                </span>
                <span
                  className="col-span-7 font-mono"
                  style={{ color: 'var(--color-ink)', wordBreak: 'break-all' }}
                >
                  {v}
                </span>
              </span>
            ))}
            <span
              className="block mt-3 pt-3 text-[11px] font-mono"
              style={{
                borderTop: '1px solid var(--color-line)',
                color: 'var(--color-ink-soft)',
                lineHeight: 1.5,
              }}
            >
              fields stay empty under <code className="code-chip">pnpm dev</code>
              {' '}— only populated when served by a real Worker.
            </span>
          </span>
        ) : (
          <span
            className="block text-[12px]"
            style={{ color: 'var(--color-ink-dim)', lineHeight: 1.5 }}
          >
            Sign in to see session telemetry: colo, country, city, timezone,
            IP, and coordinates — all sourced from{' '}
            <code className="code-chip">request.cf</code> and persisted on the
            session row.
          </span>
        )}
      </span>
    </span>
  )
}
