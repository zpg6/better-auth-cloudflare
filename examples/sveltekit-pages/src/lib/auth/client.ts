import { cloudflareClient } from 'better-auth-cloudflare/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/svelte';

export const authClient = createAuthClient({
	plugins: [cloudflareClient(), anonymousClient()]
});
