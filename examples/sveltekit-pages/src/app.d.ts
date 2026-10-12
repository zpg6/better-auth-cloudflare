import type { DrizzleClient } from '$lib/server/db';
import type { Auth } from '$lib/server/auth';
import 'unplugin-icons/types/svelte';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	interface Env {
		SVELTEKIT_PAGES_AUTH_SESSION_KV: KVNamespace;
		SVELTEKIT_PAGES_ASSETS: R2Bucket;
		HYPERDRIVE: Hyperdrive;
	}
	namespace App {
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}
		interface Locals {
			auth: Auth;
			db: DrizzleClient;
		}
	}
}

export {};
