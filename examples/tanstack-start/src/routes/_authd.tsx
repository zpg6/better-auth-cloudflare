import { createFileRoute, Outlet } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import SignInForm from '#/components/sign-in-form.tsx'

export const Route = createFileRoute('/_authd')({
  component: () => {
    const session = authClient.useSession()

    if (session.isPending || session.isRefetching) return null

    if (session.data?.user) return <Outlet />

    return (
      <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-24">
        <div className="grid md:grid-cols-12 gap-10 md:gap-20 items-start">
          <div className="md:col-span-5">
            <div className="label-meta mb-6">auth · required</div>
            <h1
              className="font-display"
              style={{
                fontSize: 'clamp(2rem, 4.5vw, 3.25rem)',
                fontWeight: 780,
                letterSpacing: '-0.03em',
                lineHeight: 1,
              }}
            >
              Sign in to
              <br />
              <span style={{ color: 'var(--color-signal)' }}>continue.</span>
            </h1>
            <p className="mt-6 max-w-[40ch] text-[15px]" style={{ color: 'var(--color-ink-dim)' }}>
              This route is behind the <code className="code-chip">_authd</code> layout.
            </p>
          </div>
          <div className="md:col-span-6 md:col-start-7">
            <SignInForm />
          </div>
        </div>
      </div>
    )
  },
})
