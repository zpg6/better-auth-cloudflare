import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { Field } from '#/components/field'

export default function SignUpForm() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { error } = await authClient.signUp.email({ name, email, password })
      if (error) setError(error.message || 'Failed to sign up')
      else navigate({ to: '/profile' })
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
        id="name"
        label="Name"
        type="text"
        value={name}
        required
        autoComplete="name"
        onChange={setName}
      />
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
        autoComplete="new-password"
        minLength={8}
        hint="Minimum 8 characters."
        onChange={setPassword}
      />

      <button type="submit" disabled={isLoading} className="btn-primary mt-2">
        {isLoading ? 'Creating account…' : 'Create account →'}
      </button>

      <p className="text-[13px] pt-2" style={{ color: 'var(--color-ink-dim)' }}>
        Already registered?{' '}
        <Link to="/sign-in" className="link-signal">
          Sign in
        </Link>
      </p>
    </form>
  )
}
