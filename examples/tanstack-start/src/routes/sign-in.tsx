import { createFileRoute, Navigate, redirect } from '@tanstack/react-router'
import SignInForm from '#/components/sign-in-form.tsx'
import { getSession } from '../lib/fnc';
import { authClient } from '#/lib/auth-client.ts';

export const Route = createFileRoute('/sign-in')({
  component: SignInPage,
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) 

    if (session) {
      throw redirect({
        to: '/profile',
        throw: true,
      })
    }
  },
})

function SignInPage() {
  const session = authClient.useSession();

  if (session.data?.user) return <Navigate to="/profile"/>;

  return (
    <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Sign in</h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-6">
        Enter your credentials to access your account
      </p>
      <SignInForm />
    </div>
  )
}