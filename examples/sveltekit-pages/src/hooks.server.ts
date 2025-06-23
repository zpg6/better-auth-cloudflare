import { createAuth } from '$lib/server/auth'; // path to your auth file
import { createClient } from '$lib/server/db';
import type { Handle } from '@sveltejs/kit';
import { svelteKitHandler } from 'better-auth/svelte-kit';

export const handle: Handle = async ({ event, resolve }) => {
	try {
		const db = event.platform?.env.DB;
		if (!db) {
			throw new Error('Database instance (DB) is not available in event.platform.env.');
		}
		event.locals.db = createClient(db);

		const auth = createAuth(event.locals.db, event);
		event.locals.auth = auth;

		return await svelteKitHandler({ auth, event, resolve });
	} catch (error) {
		console.error('Database connection failed:', error);
		throw error;
	}
};
