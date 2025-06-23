<script lang="ts">
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Tabs, TabsList, TabsTrigger, TabsContent } from '$lib/components/ui/tabs/index.js';
	import MapPin from 'virtual:icons/lucide/map-pin';
	import Clock from 'virtual:icons/lucide/clock';
	import Building from 'virtual:icons/lucide/building';
	import Globe from 'virtual:icons/lucide/globe';
	import Server from 'virtual:icons/lucide/server';
	import Navigation from 'virtual:icons/lucide/navigation';
	import FileUploadDemo from '$lib/components/file-upload-demo.svelte';
	import SignOutButton from '$lib/components/sign-out-button.svelte';

	let { data } = $props();
</script>

<div class="flex flex-1 flex-col font-[family-name:var(--font-geist-sans)]">
	<main class="flex flex-1 flex-col items-center justify-center p-8">
		<div class="w-full max-w-3xl">
			<div class="mb-8 text-center">
				<h1 class="text-3xl font-bold">Dashboard</h1>
				<p class="mt-2 text-sm text-gray-500">Powered by better-auth-cloudflare</p>
			</div>

			<Tabs value="user" class="w-full">
				<TabsList class="mb-6 grid w-full grid-cols-3">
					<TabsTrigger value="user">User Info</TabsTrigger>
					<TabsTrigger value="geolocation">Geolocation</TabsTrigger>
					<TabsTrigger value="upload">File Upload</TabsTrigger>
				</TabsList>

				<TabsContent value="user" class="space-y-6">
					<Card class="w-full">
						<CardHeader>
							<CardTitle class="text-xl font-semibold">User Information</CardTitle>
						</CardHeader>
						<CardContent class="space-y-4">
							<p class="text-lg">
								Welcome,{' '}
								<span class="font-semibold">
									{data.user?.name || data.user?.email || 'Anonymous User'}
								</span>
								!
							</p>
							{#if data.user?.email}
								<p class="text-md break-words">
									<strong>Email:</strong>{' '}
									<span class="break-all">{data.user.email}</span>
								</p>
							{/if}
							{#if !data.user?.email}
								<p class="text-md">
									<strong>Account Type:</strong> Anonymous
								</p>
							{/if}
							{#if data.user?.id}
								<p class="text-md break-words">
									<strong>User ID:</strong>
									{data.user.id}
								</p>
							{/if}
							<SignOutButton /> 
							<!-- Use the client component for sign out -->
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="geolocation" class="space-y-6">
					<Card class="w-full">
						<CardHeader>
							<CardTitle class="flex items-center gap-2 text-xl font-semibold">
								<MapPin class="h-5 w-5" />
								Your Location
							</CardTitle>
							<p class="text-sm text-gray-600">
								Automatically detected using Cloudflare's global network
							</p>
						</CardHeader>
						<CardContent>
							{#if data.cloudflareGeolocationData && 'error' in data.cloudflareGeolocationData}
								<div class="flex items-center gap-2 rounded-lg bg-red-50 p-4">
									<div class="text-red-500">⚠️</div>
									<p class="text-red-700">
										<strong>Error:</strong>
										{data.cloudflareGeolocationData.error}
									</p>
								</div>
							{/if}
							{#if data.cloudflareGeolocationData && !('error' in data.cloudflareGeolocationData)}
								<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
									<div class="flex items-center gap-3 p-2">
										<Clock class="h-5 w-5 text-gray-600" />
										<div>
											<p class="font-medium text-gray-900">Timezone</p>
											<p class="text-gray-600">
												{data.cloudflareGeolocationData.timezone || 'Unknown'}
											</p>
										</div>
									</div>

									<div class="flex items-center gap-3 p-2">
										<Building class="h-5 w-5 text-gray-600" />
										<div>
											<p class="font-medium text-gray-900">City</p>
											<p class="text-gray-600">
												{data.cloudflareGeolocationData.city || 'Unknown'}
											</p>
										</div>
									</div>

									<div class="flex items-center gap-3 p-2">
										<Globe class="h-5 w-5 text-gray-600" />
										<div>
											<p class="font-medium text-gray-900">Country</p>
											<p class="text-gray-600">
												{data.cloudflareGeolocationData.country || 'Unknown'}
											</p>
										</div>
									</div>

									<div class="flex items-center gap-3 p-2">
										<MapPin class="h-5 w-5 text-gray-600" />
										<div>
											<p class="font-medium text-gray-900">Region</p>
											<p class="text-gray-600">
												{data.cloudflareGeolocationData.region || 'Unknown'}
												{data.cloudflareGeolocationData.regionCode &&
													` (${data.cloudflareGeolocationData.regionCode})`}
											</p>
										</div>
									</div>

									<div class="flex items-center gap-3 p-2">
										<Server class="h-5 w-5 text-gray-600" />
										<div>
											<p class="font-medium text-gray-900">Data Center</p>
											<p class="text-gray-600">
												{data.cloudflareGeolocationData.colo || 'Unknown'}
											</p>
										</div>
									</div>

									{#if data.cloudflareGeolocationData.latitude || data.cloudflareGeolocationData.longitude}
										<div class="flex items-center gap-3 p-2">
											<Navigation class="h-5 w-5 text-gray-600" />
											<div>
												<p class="font-medium text-gray-900">Coordinates</p>
												<p class="text-gray-600">
													{data.cloudflareGeolocationData.latitude &&
													data.cloudflareGeolocationData.longitude
														? `${data.cloudflareGeolocationData.latitude}, ${data.cloudflareGeolocationData.longitude}`
														: 'Partially available'}
												</p>
											</div>
										</div>
									{/if}
								</div>
							{/if}
						</CardContent>
					</Card>
				</TabsContent>

				<TabsContent value="upload" class="space-y-6">
					<FileUploadDemo />
				</TabsContent>
			</Tabs>
		</div>
	</main>
</div>
