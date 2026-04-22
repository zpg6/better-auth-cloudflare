import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/_authd/profile')({
  component: AuthenticatedPage,
})

function AuthenticatedPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="p-8">
        <div className="animate-pulse h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/4 mb-4" />
        <div className="animate-pulse h-4 bg-neutral-200 dark:bg-neutral-700 rounded w-1/2" />
      </div>
    )
  }

  if (!session?.user) {
    return (
      <div className="p-8">
        <p className="text-neutral-600 dark:text-neutral-400">Not authenticated</p>
      </div>
    )
  }

  const { user } = session

  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Account</h1>
      
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg p-6">
        <div className="flex items-center gap-4 mb-6">
          {user.image ? (
            <img src={user.image} alt="" className="h-16 w-16 rounded-full" />
          ) : (
            <div className="h-16 w-16 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center rounded-full">
              <span className="text-xl font-medium text-neutral-600 dark:text-neutral-400">
                {user.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
          )}
          <div>
            <h2 className="text-lg font-semibold">{user.name}</h2>
            <p className="text-neutral-600 dark:text-neutral-400">{user.email}</p>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500">User ID</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300">{user.id}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500">Email Verified</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300">
              {user.emailVerified ? 'Yes' : 'No'}
            </span>
          </div>
          {user.createdAt && (
            <div className="flex justify-between py-2">
              <span className="text-neutral-500">Created At</span>
              <span className="font-mono text-neutral-700 dark:text-neutral-300">
                {new Date(user.createdAt).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}