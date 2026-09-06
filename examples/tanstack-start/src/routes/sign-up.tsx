import { createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import SignUpForm from '../components/sign-up-form.tsx'

export const Route = createFileRoute('/sign-up')({
  component: SignUpPage,
  loader: async () => {
    const { data: session } = await authClient.getSession()
    if (session) {
      throw redirect({ to: '/profile', throw: true })
    }
  },
})

function SignUpPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-24">
      <div className="grid md:grid-cols-12 gap-10 md:gap-20 items-start">
        <div className="md:col-span-5">
          <div className="label-meta mb-6">auth · new user</div>
          <h1
            className="font-display"
            style={{
              fontSize: 'clamp(2.25rem, 5vw, 3.75rem)',
              fontWeight: 780,
              letterSpacing: '-0.03em',
              lineHeight: 1.0,
            }}
          >
            Get
            <br />
            <span style={{ color: 'var(--color-signal)' }}>wired in.</span>
          </h1>
          <p
            className="mt-6 max-w-[42ch] text-[15px]"
            style={{ color: 'var(--color-ink-dim)' }}
          >
            A row in D1, a session in KV, a cookie in your browser. That's it.
            No OAuth dance, no external provider — this example keeps it
            deliberately simple.
          </p>
          <ul className="mt-8 space-y-2 text-[13px]">
            <li className="pl-4 tick">Stored in your own Cloudflare D1</li>
            <li className="pl-4 tick">Passwords hashed via better-auth</li>
            <li className="pl-4 tick">Sessions signed, not stored in LocalStorage</li>
          </ul>
        </div>

        <div className="md:col-span-6 md:col-start-7">
          <SignUpForm />
        </div>
      </div>
    </div>
  )
}
