import { createFileRoute, Navigate, redirect } from '@tanstack/react-router'
import SignInForm from '#/components/sign-in-form.tsx'
import { getSession } from '../lib/fnc'
import { authClient } from '#/lib/auth-client.ts'

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
  beforeLoad: async () => {
    const session = await getSession()
    if (session) {
      throw redirect({ to: '/profile', throw: true })
    }
  },
})

function SignInPage() {
  const session = authClient.useSession()
  if (session.data?.user) return <Navigate to="/profile" />

  return (
    <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-24">
      <div className="grid md:grid-cols-12 gap-10 md:gap-20 items-start">
        <div className="md:col-span-5">
          <div className="label-meta mb-6">auth · session</div>
          <h1
            className="font-display"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 3.75rem)',
              fontWeight: 780,
              letterSpacing: '-0.03em',
              lineHeight: 1.0,
            }}
          >
            Welcome
            <br />
            <span style={{ color: 'var(--color-signal)' }}>back.</span>
          </h1>
          <p
            className="mt-6 max-w-[40ch] text-[15px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            Credentials are signed by a secret loaded from your Worker env and
            checked against a Cloudflare D1 row. Rate-limited at the edge.
          </p>
          <div className="mt-8 label-meta flex items-center gap-2">
            <span className="signal-dot" aria-hidden /> endpoint healthy
          </div>
        </div>

        <div className="md:col-span-6 md:col-start-7">
          <SignInForm />
        </div>
      </div>
    </div>
  )
}
