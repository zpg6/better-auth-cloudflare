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
					bucket: event?.platform?.env?.SVELTEKIT_PAGES_ASSETS as R2Bucket,
					maxFileSize: 2 * 1024 * 1024, // 2MB
					allowedTypes: ['.jpg', '.jpeg', '.png', '.gif'],
					additionalFields: {
						category: { type: 'string', required: false },
						isPublic: { type: 'boolean', required: false },
						description: { type: 'string', required: false }
					},
					hooks: {
						upload: {
							before: async (file, ctx) => {
								// Only allow authenticated users to upload files
								if (ctx.session === null) {
									return null; // Blocks upload
								}

								// Only allow paid users to upload files (for example)
								const isPaidUser = (userId: string) => true; // example
								if (isPaidUser(ctx.session.user.id) === false) {
									return null; // Blocks upload
								}

								// Allow upload
							},
							after: async (file, ctx) => {
								// Track your analytics (for example)
								console.log('File uploaded:', file);
							}
						},
						download: {
							before: async (file, ctx) => {
								// Only allow user to access their own files (by default all files are public)
								if (file.isPublic === false && file.userId !== ctx.session?.user.id) {
									return null; // Blocks download
								}
								// Allow download
							}
						}
					}
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
