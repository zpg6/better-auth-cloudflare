import { getAuthServer } from '#/lib/auth.ts';
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET:  ({ request }) => getAuthServer().handler(request),
      POST: ({ request }) =>  getAuthServer().handler(request),
    },
  },
})
