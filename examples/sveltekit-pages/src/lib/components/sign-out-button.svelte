<script lang="ts">
	import { Button } from './ui/button';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth/client';

	let isLoading = false;
	let isPending = false;
	let error: string | null = null;

	const handleSignOut = async () => {
		isLoading = true;
		error = null;
		try {
			// Example of client-side geolocation data fetching
			const result = await authClient.cloudflare.geolocation();
			if (result.error) {
				console.error('Error fetching geolocation:', result.error);
			} else if (result.data && !('error' in result.data)) {
				console.log('Geolocation data:', {
					timezone: result.data.timezone,
					city: result.data.city,
					country: result.data.country,
					region: result.data.region,
					regionCode: result.data.regionCode,
					colo: result.data.colo,
					latitude: result.data.latitude,
					longitude: result.data.longitude
				});
			}

			// Actually sign out
			await authClient.signOut({
				fetchOptions: {
					onSuccess: () => {
						isPending = true;
						goto('/').finally(() => {
							isPending = false;
						});
					},
					onError: (err: any) => {
						console.error('Sign out error:', err);
						error = err.error.message || 'Sign out failed. Please try again.';
					}
				}
			});
		} catch (e: any) {
			// Catch any unexpected errors during the signOut call itself
			console.error('Unexpected sign out error:', e);
			error = e.message || 'An unexpected error occurred. Please try again.';
		} finally {
			isLoading = false;
		}
	};
</script>

<div class="mt-6 flex w-full flex-col items-center">
	<!-- Container for button and error message -->
	<Button
		onclick={handleSignOut}
		disabled={isLoading || isPending}
		variant="destructive"
		class="w-full max-w-xs"
	>
		{isLoading || isPending ? 'Signing Out...' : 'Sign Out'}
	</Button>
	{#if error}
		<p class="mt-2 text-center text-sm text-red-500">{error}</p>
	{/if}
</div>
