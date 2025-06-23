<script lang="ts">
	import '../app.css';
	import Github from 'virtual:icons/lucide/github';
	import Package from 'virtual:icons/lucide/package';

	let { children } = $props();
</script>

<div class="flex h-screen flex-col">
	{@render children()}

	<footer class="w-full py-4 text-center text-sm text-gray-500">
		<div class="space-y-3">
			<div>Powered by better-auth-cloudflare</div>
			<div class="flex items-center justify-center gap-4">
				<a
					href="https://github.com/zpg6/better-auth-cloudflare"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 transition-colors hover:text-gray-700"
				>
					<Github />
					<span>GitHub</span>
				</a>
				<a
					href="https://www.npmjs.com/package/better-auth-cloudflare"
					target="_blank"
					rel="noopener noreferrer"
					class="flex items-center gap-1 transition-colors hover:text-gray-700"
				>
					<Package />
					<span>npm</span>
				</a>
			</div>
		</div>
	</footer>
</div>
