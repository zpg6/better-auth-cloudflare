import { Link } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
    )
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          to="/profile"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          {session.user.image ? (
            <img src={session.user.image} alt="" className="h-8 w-8 rounded-full" />
          ) : (
            <div className="h-8 w-8 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center rounded-full">
              <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                {session.user.name?.charAt(0).toUpperCase() || 'U'}
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={() => {
            void authClient.signOut()
          }}
          className="h-9 px-4 text-sm font-medium bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-50 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors rounded-md"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <Link
      to="/sign-in"
      className="h-9 px-4 text-sm font-medium bg-neutral-900 dark:bg-neutral-50 text-white dark:text-neutral-900 rounded-md hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors"
    >
      Sign in
    </Link>
  )
}
