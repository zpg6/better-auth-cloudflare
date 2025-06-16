<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	
	let isAuthActionInProgress = false;
	function handleAnonymousLogin() {}
</script>

<Card.Root class="mx-auto w-full max-w-sm">
	<Card.Header>
		<Card.Title class="text-2xl">Login</Card.Title>
		<Card.Description>Powered by better-auth-cloudflare.</Card.Description>
	</Card.Header>
	<Card.Content>
		<div class="grid gap-4">
			<p class="text-center text-sm text-gray-600">No personal information required.</p>
		</div>
	</Card.Content>
	<Card.Footer>
		<Button onclick={handleAnonymousLogin} class="w-full" disabled={isAuthActionInProgress}>
			{isAuthActionInProgress ? 'Logging In...' : 'Login Anonymously'}
		</Button>
	</Card.Footer>
</Card.Root>
