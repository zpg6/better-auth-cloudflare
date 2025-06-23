<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from './ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
	import { Label } from './ui/label';
	import { Input } from './ui/input';
	import CheckCircle from 'virtual:icons/lucide/check-circle';
	import FolderOpen from 'virtual:icons/lucide/folder-open';
	import Upload from 'virtual:icons/lucide/upload';
	import { authClient } from '$lib/auth'; // Assuming auth client is available

	let file: File | null = null;
	let category = '';
	let isPublic = false;
	let description = '';
	let isUploading = false;
	let fileOperationResult: {
		success?: boolean;
		error?: string;
		data?: any;
	} | null = null;
	let userFiles: any[] = [];
	let isLoadingFiles = false;

	const handleUpload = async () => {
		if (!file) return;

		isUploading = true;
		fileOperationResult = null;

		try {
			// @ts-ignore TODO: improve type-safety of metadata using client action
			const result = await client.uploadFile(file, {
				isPublic,
				...(category.trim() && { category: category.trim() }),
				...(description.trim() && { description: description.trim() })
			});

			if (result.error) {
				fileOperationResult = {
					error: result.error.message || 'Failed to upload file. Please try again.'
				};
			} else {
				fileOperationResult = { success: true, data: result.data };
				// Clear form
				file = null;
				category = '';
				isPublic = false;
				description = '';
				// Refresh file list
				loadUserFiles();
			}
		} catch (error) {
			console.error('Upload failed:', error);
			fileOperationResult = {
				error:
					error instanceof Error && error.message
						? `Upload failed: ${error.message}`
						: 'Failed to upload file. Please check your connection and try again.'
			};
		} finally {
			isUploading = false;
		}
	};

	const loadUserFiles = async () => {
		isLoadingFiles = true;
		try {
			// @ts-ignore Use the inferred list endpoint with pagination support
			const result = await authClient.files.list();

			if (result.data) {
				// Types should now be properly inferred from the endpoint
				userFiles = result.data.files || [];
			} else {
				userFiles = [];
			}
		} catch (error) {
			console.error('Failed to load files:', error);
			userFiles = [];
		} finally {
			isLoadingFiles = false;
		}
	};

	const downloadFile = async (fileId: string, filename: string) => {
		try {
			// @ts-ignore
			const result = await authClient.files.download({ fileId });

			if (result.error) {
				console.error('Download failed:', result.error);
				fileOperationResult = { error: 'Failed to download file. Please try again.' };
				return;
			}

			// Extract blob from Better Auth response structure
			const response = result.data;
			const blob = response instanceof Response ? await response.blob() : response;

			if (blob instanceof Blob && blob.size === 0) {
				console.warn('Warning: Downloaded file appears to be empty');
			}

			// Create and trigger download
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.style.display = 'none';
			document.body.appendChild(a);
			a.click();

			// Cleanup
			setTimeout(() => {
				window.URL.revokeObjectURL(url);
				document.body.removeChild(a);
			}, 100);
		} catch (error) {
			console.error('Failed to download file:', error);
			fileOperationResult = { error: 'Failed to download file. Please try again.' };
		}
	};

	const deleteFile = async (fileId: string) => {
		try {
			// @ts-ignore Use the inferred delete endpoint
			const result = await authClient.files.delete({ fileId });
			if (!result.error) {
				loadUserFiles(); // Auto-refresh list
			} else {
				console.error('Delete failed:', result.error);
				fileOperationResult = { error: 'Failed to delete file. Please try again.' };
			}
		} catch (error) {
			console.error('Failed to delete file:', error);
			fileOperationResult = { error: 'Failed to delete file. Please try again.' };
		}
	};

	// Helper function for better file size formatting
	const formatFileSize = (bytes: number): string => {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	};

	// Helper function for relative time formatting
	const formatRelativeTime = (date: Date | string): string => {
		const now = new Date();
		const uploadDate = new Date(date);
		const diffInSeconds = Math.floor((now.getTime() - uploadDate.getTime()) / 1000);

		if (diffInSeconds < 60) return 'Just now';
		if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
		if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
		if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;

		return uploadDate.toLocaleDateString();
	};

	// Auto-load files when component mounts
	onMount(() => {
		loadUserFiles();
	});
</script>

<div class="space-y-6">
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Upload class="h-5 w-5" />
				File Upload
			</CardTitle>
		</CardHeader>
		<CardContent class="space-y-4">
			<div>
				<Label for="file" class="mb-2 block">Select File</Label>
				<Input
					id="file"
					type="file"
					accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx"
					onchange={(e) => (file = e.currentTarget.files?.[0] || null)}
				/>
				{#if file}
					<p class="mt-1 text-sm text-gray-500">
						Selected: {file.name} ({formatFileSize(file.size)})
					</p>
				{/if}
			</div>

			<div>
				<Label for="category" class="mb-2 block">Category (optional)</Label>
				<Input
					id="category"
					type="text"
					placeholder="e.g., documents, images"
					bind:value={category}
				/>
			</div>

			<div>
				<Label for="description" class="mb-2 block">Description (optional)</Label>
				<Input
					id="description"
					type="text"
					placeholder="File description"
					bind:value={description}
				/>
			</div>

			<div class="flex items-center space-x-2">
				<input
					id="isPublic"
					type="checkbox"
					bind:checked={isPublic}
					class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
				/>
				<Label for="isPublic">Make file public</Label>
			</div>

			<div class="flex justify-center">
				<Button onclick={handleUpload} disabled={!file || isUploading} class="w-full max-w-xs">
					{isUploading ? 'Uploading...' : 'Upload File'}
				</Button>
			</div>

			{#if fileOperationResult}
				<div
					class={`rounded-lg p-3 ${fileOperationResult.error ? 'border border-red-200 bg-red-50' : 'border border-green-200 bg-green-50'}`}
				>
					{#if fileOperationResult.error}
						<div class="flex items-start space-x-2">
							<span class="mt-0.5 text-red-500">❌</span>
							<p class="text-sm text-red-700">{fileOperationResult.error}</p>
						</div>
					{:else}
						<div class="flex items-start space-x-2">
							<CheckCircle class="mt-0.5 h-5 w-5 text-green-500" />
							<div>
								<p class="text-sm font-medium text-green-700">File uploaded successfully!</p>
								<p class="mt-1 text-xs text-green-600">
									Your file has been stored securely and is now available in your file list.
								</p>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</CardContent>
	</Card>

	<!-- File List -->
	<Card>
		<CardHeader class="flex flex-row items-center justify-between">
			<CardTitle>Your Files</CardTitle>
			<Button onclick={loadUserFiles} disabled={isLoadingFiles} variant="outline" size="sm">
				{isLoadingFiles ? 'Loading...' : 'Refresh'}
			</Button>
		</CardHeader>
		<CardContent>
			{#if userFiles.length === 0}
				<div class="py-8 text-center">
					<div class="mb-4 flex justify-center">
						<FolderOpen class="h-16 w-16 text-gray-400" />
					</div>
					<p class="text-lg font-medium text-gray-500">No files uploaded yet</p>
					<p class="mt-1 text-sm text-gray-400">Upload your first file using the form above</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each userFiles as file (file.id)}
						<div class="flex items-center justify-between rounded-lg border p-3">
							<div class="flex-1">
								<p class="font-medium text-gray-900">{file.originalName}</p>
								<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
									{#if file.category}
										<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
											{file.category}
										</span>
									{/if}
									<span>{formatFileSize(file.size)}</span>
									<span>•</span>
									<span>{formatRelativeTime(file.uploadedAt)}</span>
									{#if file.isPublic}
										<span>•</span>
										<span class="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
											Public
										</span>
									{/if}
								</div>
								{#if file.description}
									<p class="mt-1 text-sm text-gray-600">{file.description}</p>
								{/if}
							</div>
							<div class="ml-4 flex gap-2">
								<Button
									onclick={() => downloadFile(file.id, file.originalName)}
									variant="outline"
									size="sm"
								>
									Download
								</Button>
								<Button onclick={() => deleteFile(file.id)} variant="destructive" size="sm">
									Delete
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
