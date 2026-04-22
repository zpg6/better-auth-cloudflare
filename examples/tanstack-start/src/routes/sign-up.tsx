import { createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import SignUpForm from '../components/sign-up-form.tsx'

export const Route = createFileRoute('/sign-up')({
  component: SignUpPage,
  loader: async () => {
    const { data: session } = await authClient.getSession()

    if (session) {
      throw redirect({
        to: '/profile',
        throw: true,
      })
    }
  },
})

function SignUpPage() {
  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Create account</h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-6">
        Sign up to get started
      </p>
      <SignUpForm />
    </div>
  )
}
