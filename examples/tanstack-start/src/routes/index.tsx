import { authClient } from '#/lib/auth-client.ts';
import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home
})

const highlights = [
  { k: 'auth', v: 'email + password, sessions signed from worker env' },
  { k: 'db', v: 'drizzle orm against cloudflare d1' },
  { k: 'kv', v: 'rate-limit state in a cloudflare kv namespace' },
  { k: 'routing', v: 'protected routes via _authd layout in tanstack router' },
]

const steps = [
  {
    n: '01',
    title: 'Provision',
    body: (
      <>
        <code className="code-chip">pnpm wrangler d1 create db</code>
        <span className="mx-2" style={{ color: 'var(--color-ink-soft)' }}>·</span>
        <code className="code-chip">pnpm wrangler kv namespace create kv</code>
      </>
    ),
  },
  {
    n: '02',
    title: 'Generate',
    body: (
      <>
        <code className="code-chip">pnpm generate:auth</code>
        <span className="mx-2" style={{ color: 'var(--color-ink-soft)' }}>→</span>
        <code className="code-chip">generate:cf-types</code>
        <span className="mx-2" style={{ color: 'var(--color-ink-soft)' }}>→</span>
        <code className="code-chip">generate:db</code>
      </>
    ),
  },
  {
    n: '03',
    title: 'Migrate',
    body: (
      <>
        <code className="code-chip">pnpm migrate:dev</code>
      </>
    ),
  },
  {
    n: '04',
    title: 'Run',
    body: (
      <>
        <code className="code-chip">pnpm dev</code>
        <span className="ml-3 label-meta">localhost:3000</span>
      </>
    ),
  },
]

function Home() {
  const session = authClient.useSession()?.data

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-8">
      {/* hero */}
      <section className="pt-16 md:pt-24 pb-16 grid md:grid-cols-12 gap-10 md:gap-14">
        <div className="md:col-span-8">
          <div className="label-meta mb-6 flex items-center gap-3">
            <span>specimen · 001</span>
            <span className="rule flex-1 max-w-[120px]" />
            <span>tanstack-start</span>
          </div>

          <h1
            className="font-display"
            style={{
              fontSize: 'clamp(2.6rem, 7vw, 5.5rem)',
              fontWeight: 800,
              lineHeight: 0.94,
              letterSpacing: '-0.035em',
            }}
          >
            Auth on the edge,
            <br />
            <span style={{ color: 'var(--color-signal)' }}>wired</span> in an afternoon.
          </h1>

          <p
            className="mt-8 max-w-[62ch] text-[17px]"
            style={{ color: 'var(--color-ink-dim)', lineHeight: 1.55 }}
          >
            A reference implementation of{' '}
            <span className="code-chip">better-auth-cloudflare</span> inside a
            TanStack Start app, deployed to Cloudflare Workers with D1 and KV.
            Everything you need to copy, learn, and ship.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {session ? (
              <>
                <Link to="/profile" className="btn-primary">
                  Go to profile →
                </Link>
                <span className="label-meta">
                  signed in as {session.user.email}
                </span>
              </>
            ) : (
              <>
                <Link to="/sign-up" className="btn-primary">
                  Create an account →
                </Link>
                <Link to="/sign-in" className="btn-ghost" style={{ height: '44px' }}>
                  Sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* telemetry card */}
        <aside className="md:col-span-4 md:pt-14">
          <div className="panel p-5">
            <div className="flex items-center justify-between mb-5">
              <span className="label-meta">status</span>
              <span className="inline-flex items-center gap-2 label-meta">
                <span className="signal-dot" aria-hidden /> online
              </span>
            </div>
            <dl className="space-y-3 text-[13px]">
              <Row k="runtime" v="cloudflare workers" />
              <Row k="database" v="d1 (sqlite)" />
              <Row k="cache" v="kv namespace" />
              <Row k="framework" v="tanstack start" />
              <Row k="auth" v="better-auth 1.6" mono />
            </dl>
          </div>
          <p className="mt-4 label-meta">
            bindings: <span style={{ color: 'var(--color-ink)' }}>db</span>,{' '}
            <span style={{ color: 'var(--color-ink)' }}>kv</span>
          </p>
        </aside>
      </section>

      <div className="rule" />

      {/* what you get */}
      <section className="py-16 md:py-20 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="label-meta mb-4">§ 01 · contents</div>
          <h2
            className="font-display text-3xl md:text-4xl"
            style={{ fontWeight: 700, letterSpacing: '-0.025em' }}
          >
            What this example ships with.
          </h2>
        </div>
        <ul className="md:col-span-8 grid sm:grid-cols-2 gap-x-10 gap-y-6">
          {highlights.map((h) => (
            <li key={h.k} className="pl-4 tick">
              <div className="label-meta mb-1" style={{ color: 'var(--color-signal)' }}>
                {h.k}
              </div>
              <div className="text-[15px]" style={{ color: 'var(--color-ink)' }}>
                {h.v}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <div className="rule" />

      {/* quick start */}
      <section className="py-16 md:py-20">
        <div className="grid md:grid-cols-12 gap-10 mb-10">
          <div className="md:col-span-4">
            <div className="label-meta mb-4">§ 02 · quick start</div>
            <h2
              className="font-display text-3xl md:text-4xl"
              style={{ fontWeight: 700, letterSpacing: '-0.025em' }}
            >
              Four commands to local auth.
            </h2>
          </div>
          <p
            className="md:col-span-8 text-[15px] max-w-[60ch]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            The full walkthrough lives in the README. This is the trail of
            breadcrumbs for people who learn by running things.
          </p>
        </div>

        <ol className="divide-y" style={{ borderColor: 'var(--color-line)' }}>
          {steps.map((s) => (
            <li
              key={s.n}
              className="grid md:grid-cols-12 gap-4 py-5"
              style={{ borderTop: '1px solid var(--color-line)' }}
            >
              <div className="md:col-span-2 label-meta" style={{ color: 'var(--color-signal)' }}>
                {s.n}
              </div>
              <div className="md:col-span-3 font-display text-[20px]" style={{ fontWeight: 600 }}>
                {s.title}
              </div>
              <div className="md:col-span-7 flex flex-wrap items-center">{s.body}</div>
            </li>
          ))}
        </ol>
        <div
          className="mt-5 pt-5 text-[14px]"
          style={{ borderTop: '1px solid var(--color-line)', color: 'var(--color-ink-dim)' }}
        >
          Also needed in <code className="code-chip">.env.local</code>:{' '}
          <code className="code-chip">BETTER_AUTH_SECRET</code>,{' '}
          <code className="code-chip">BETTER_AUTH_URL</code>.
        </div>
      </section>

      <div className="rule" />

      {/* code map */}
      <section className="py-16 md:py-20 grid md:grid-cols-12 gap-10">
        <div className="md:col-span-4">
          <div className="label-meta mb-4">§ 03 · code map</div>
          <h2
            className="font-display text-3xl md:text-4xl"
            style={{ fontWeight: 700, letterSpacing: '-0.025em' }}
          >
            Where to look first.
          </h2>
        </div>
        <div className="md:col-span-8">
          <ul className="space-y-0">
            <CodeRow path="src/lib/auth.ts" note="server better-auth config · d1 · kv · cloudflare plugin" />
            <CodeRow path="src/lib/auth-client.ts" note="browser client" />
            <CodeRow path="src/routes/api/auth/$.ts" note="catch-all route → better-auth" />
            <CodeRow path="src/components/sign-in-form.tsx" note="example forms" />
            <CodeRow path="src/routes/_authd.tsx" note="protected layout" />
          </ul>
        </div>
      </section>
    </div>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="label-meta">{k}</dt>
      <dd
        className={mono ? 'font-mono' : ''}
        style={{ color: 'var(--color-ink)', fontSize: '13px' }}
      >
        {v}
      </dd>
    </div>
  )
}

function CodeRow({ path, note }: { path: string; note: string }) {
  return (
    <li
      className="grid md:grid-cols-12 gap-4 py-4"
      style={{ borderTop: '1px solid var(--color-line)' }}
    >
      <code
        className="md:col-span-5 font-mono text-[13px]"
        style={{ color: 'var(--color-ink)' }}
      >
        {path}
      </code>
      <span
        className="md:col-span-7 text-[14px]"
        style={{ color: 'var(--color-ink-dim)' }}
      >
        {note}
      </span>
    </li>
  )
}
