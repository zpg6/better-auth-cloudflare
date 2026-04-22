import { createFileRoute, Navigate, Outlet } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import SignInForm from '#/components/sign-in-form.tsx';


export const Route = createFileRoute('/_authd')({
  component: () => {
    const session = authClient.useSession();

    if (session.isPending || session.isRefetching) return null;

    else if (session.data?.user) return <Outlet />

    return <div className="p-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-2">Sign in</h1>
      <p className="text-neutral-600 dark:text-neutral-400 mb-6">
        Enter your credentials to access your account
      </p>
      <SignInForm />
    </div>
  
  }
})