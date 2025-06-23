import type { RequestEvent } from '@sveltejs/kit';
import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins';
import { type DrizzleClient } from '$lib/server/db';
import { withCloudflare } from 'better-auth-cloudflare';

function createAuth(db: DrizzleClient, event?: RequestEvent) {
	return betterAuth(
		withCloudflare(
			{
				autoDetectIpAddress: true,
				geolocationTracking: true,
				cf: event?.platform?.cf || {},
				d1: {
					db,
					options: {
						usePlural: true,
						debugLogs: true
					}
				},
				// @ts-expect-error FIX: `@cloudflare/workers-types` is not compatible
				kv: event?.platform?.env?.SVELTEKIT_PAGES_AUTH_SESSION_KV as KVNamespace,
				r2: {
					bucket: event?.platform?.env?.SVELTEKIT_PAGES_ASSETS as R2Bucket
					// options: {
					// 	// Optional R2 options
					// }
				}
			},
			{
				emailAndPassword: {
					enabled: true
				},
				plugins: [anonymous()],
				rateLimit: {
					enabled: true
				}
			}
		)
	);
}

export type Auth = ReturnType<typeof createAuth>;

// Export for CLI schema generation
// export const auth = createAuth(event.locals.db);

export { createAuth };
