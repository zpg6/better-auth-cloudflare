import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { Field } from '#/components/field'

export default function SignInForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { error } = await authClient.signIn.email({ email, password })
      if (error) setError(error.message || 'Failed to sign in')
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div
          role="alert"
          className="px-4 py-3 text-[13px] font-mono"
          style={{
            background: 'var(--color-signal-quiet)',
            color: 'var(--color-signal)',
            border: '1px solid var(--color-signal)',
            borderRadius: '2px',
          }}
        >
          ! {error}
        </div>
      )}

      <Field
        id="email"
        label="Email"
        type="email"
        value={email}
        required
        autoComplete="email"
        onChange={setEmail}
      />

      <Field
        id="password"
        label="Password"
        type="password"
        value={password}
        required
        autoComplete="current-password"
        onChange={setPassword}
      />

      <button type="submit" disabled={isLoading} className="btn-primary mt-2">
        {isLoading ? 'Authenticating…' : 'Sign in →'}
      </button>

      <p className="text-[13px] pt-2" style={{ color: 'var(--color-ink-dim)' }}>
        No account yet?{' '}
        <Link to="/sign-up" className="link-signal">
          Create one
        </Link>
      </p>
    </form>
  )
}
