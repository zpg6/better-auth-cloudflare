# Better Auth Cloudflare SvelteKit Example (deploy on Cloudflare Pages)

This example demonstrates how to integrate [Better Auth](https://github.com/better-auth/better-auth) with [SvelteKit](https://svelte.dev/docs/kit/) on Cloudflare Pages using the `better-auth-cloudflare` plugin.

## Features

- **User Authentication**: Secure sign-in options including email/password and passwordless logins.
- **Session Management**: Leverages Cloudflare KV for efficient session storage.
- **File Management**: Upload, download, and manage files securely using Cloudflare R2.
- **Data Persistence**: Utilizes Cloudflare D1 for database storage.
- **Geolocation**: Fetches and displays user's location data via Cloudflare headers.
- **Protected Routes**: Example of a dashboard page accessible only to authenticated users.

## Getting Started

### Prerequisites

- You will need a [Cloudflare account](https://dash.cloudflare.com/sign-up).
- You will need [Node.js](https://nodejs.org/en/) installed, preferably the latest LTS version.
- This project uses `pnpm` as a package manager, but you can use `npm` or `bun`.

### Installation

#### 1. Navigate to this directory

```shell
cd examples/sveltekit-pages && pnpm install
```

This directory initialized with `bun create cloudflare@latest sveltekit-pages --framework=svelte --platform=pages`. You can create with `npm` or `bun`

#### 2. Create Cloudflare Storages (D1, KV and R2)

To run the demo project, create a D1 Database and KV Storage in your Cloudflare account using the following CLI commands. (KV is optional and used for secondary session storage).

```shell
pnpm wrangler d1 create your-sveltekit-pages-d1
pnpm wrangler kv namespace create "SVELTEKIT_PAGES_AUTH_SESSION_KV"
pnpm wrangler kv namespace create "SVELTEKIT_PAGES_AUTH_SESSION_KV" --preview #This is for `wrangler pages dev`
pnpm wrangler r2 bucket create "your-sveltekit-pages-assets"
```

#### 3. Configure your Cloudflare bindings in `wrangler.jsonc`

Update the information in `wrangler.jsonc` based on the resources created in step 2.

```wrangler.jsonc
"d1_databases": [
 {
  "binding": "DB",
  "database_name": "your-sveltekit-pages-d1",
  "database_id": "your-sveltekit-pages-d1-id",
  "migrations_dir": "drizzle"
 }
],
"kv_namespaces": [
 {
  "binding": "SVELTEKIT_PAGES_AUTH_SESSION_KV",
  "id": "your-sveltekit-pages-auth-session-kv-id",
  "preview_id": "your-sveltekit-pages-auth-session-kv-preview-id"
 }
],
"r2_buckets": [
  {
    "binding": "SVELTEKIT_PAGES_ASSETS",
    "bucket_name": "your-sveltekit-pages-assets",
    "preview_bucket_name": "your-sveltekit-pages-assets-preview"
  }
]
```

If you used a different name when creating the resources with the Wrangler CLI, you must also change the name in the `binding:` section. Additionally, run `pnpm run cf-typegen` to update the `worker-configuration.d.ts` file.

In the D1 configuration, add `"migrations_dir": "drizzle"`. This is the migration path for the Drizzle ORM.

> Support for `wrangler.jsonc` requires wrangler version v3.91.0 or higher.[^1]

#### 4. Apply Database Migrations

After configuring your bindings, apply the database schema to your D1 database.

```shell
# For production environment
pnpm wrangler d1 migrations apply sveltekit-pages-d1

# For local development
pnpm wrangler d1 migrations apply sveltekit-pages-d1 --local
```

### Local Development

To start the local development server, run the following command:

```shell
pnpm run dev
```

This command starts the SvelteKit development server and uses `wrangler` to simulate the Cloudflare environment locally. This includes access to your local D1 database and KV namespaces.

### Deploy

```shell
pnpm run deploy
```

[^1]: [Configuration - Wrangler · Cloudflare Workers docs](https://developers.cloudflare.com/workers/wrangler/configuration/)
