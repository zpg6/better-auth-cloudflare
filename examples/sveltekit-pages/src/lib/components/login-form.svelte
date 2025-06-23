<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
		CardFooter
	} from '$lib/components/ui/card';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth/client';

	let isAuthActionInProgress = false;

	async function handleAnonymousLogin() {
		isAuthActionInProgress = true;
		try {
			const result = await authClient.signIn.anonymous();
			if (result.error) {
				console.error('Anonymous login failed:', result.error);
				alert(`Anonymous login failed: ${result.error.message}`);

				return;
			}
			console.log('Anonymous login result:', result);

			await goto('/dashboard');
		} catch (e) {
			console.error('An unexpected error occurred:', e);
		} finally {
			isAuthActionInProgress = false;
		}
	}
</script>

<Card class="mx-auto w-full max-w-sm">
	<CardHeader>
		<CardTitle class="text-2xl">Login</CardTitle>
		<CardDescription>Powered by better-auth-cloudflare.</CardDescription>
	</CardHeader>
	<CardContent>
		<div class="grid gap-4">
			<p class="text-center text-sm text-gray-600">No personal information required.</p>
		</div>
	</CardContent>
	<CardFooter>
		<Button onclick={handleAnonymousLogin} class="w-full" disabled={isAuthActionInProgress}>
			{isAuthActionInProgress ? 'Logging In...' : 'Login Anonymously'}
		</Button>
	</CardFooter>
</Card>
