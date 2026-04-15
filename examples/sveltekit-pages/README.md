# Better Auth Cloudflare SvelteKit Example (deploy on Cloudflare Pages)

This example demonstrates how to integrate [Better Auth](https://github.com/better-auth/better-auth) with [SvelteKit](https://svelte.dev/docs/kit/) on Cloudflare Pages using the `better-auth-cloudflare` plugin.

## Features

- **User Authentication**: Secure sign-in options including email/password and passwordless logins.
- **Session Management**: Leverages Cloudflare KV for efficient session storage.
- **File Management**: Upload, download, and manage files securely using Cloudflare R2.
- **Data Persistence**: Utilizes Postgres database via Cloudflare Hyperdrive.
- **Geolocation**: Fetches and displays user's location data via Cloudflare headers.
- **Protected Routes**: Example of a dashboard page accessible only to authenticated users.

## Getting Started

### Prerequisites

- You will need a [Cloudflare account](https://dash.cloudflare.com/sign-up).
- You will need [Node.js](https://nodejs.org/en/) installed, preferably the latest LTS version.
- You will need a Postgres database (local via Docker or remote).
- This project uses `pnpm` as a package manager, but you can use `npm` or `bun`.

### Installation

#### 1. Navigate to this directory

```shell
cd examples/sveltekit-pages && pnpm install
```

#### 2. Set up Postgres Database

For local development, start Postgres using Docker:

```shell
docker-compose up -d
```

This starts a Postgres 17 container with:
- Host: `127.0.0.1:5432`
- User: `user`
- Password: `password`
- Database: `local_db`

For production, set up a Postgres database (e.g., Neon, Supabase, or your own) and create a Hyperdrive configuration:

```shell
pnpm wrangler hyperdrive create your-hyperdrive-name --connection-string="postgres://user:password@your-postgres-host:5432/your_db?sslmode=require"
```

After that, you can see the following content.

```shell
🚧 Creating 'your-hyperdrive-name'
✔ Select an account › your Account
✅ Created new Hyperdrive PostgreSQL config: your-hyperdrive-id
📋 To start using your config from a Worker, add the following binding configuration to your wrangler.json file:

{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "your-hyperdrive-id"
    }
  ]
}
``` 

This process can also be done from the Cloudflare dashboard.

#### 3. Create Cloudflare Storages (KV and R2)

Create KV Storage and R2 bucket in your Cloudflare account. (KV is optional and used for secondary session storage).

```shell
pnpm wrangler kv namespace create "SVELTEKIT_PAGES_AUTH_SESSION_KV"
pnpm wrangler kv namespace create "SVELTEKIT_PAGES_AUTH_SESSION_KV" --preview #This is for `wrangler pages dev`
pnpm wrangler r2 bucket create "your-sveltekit-pages-assets"
```

#### 4. Configure your Cloudflare bindings in `wrangler.jsonc`

Update the information in `wrangler.jsonc` based on the resources created.

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "your-hyperdrive-id",
    "localConnectionString": "postgres://user:password@127.0.0.1:5432/local_db"
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

> Support for `wrangler.jsonc` requires wrangler version v3.91.0 or higher.[^1]

#### 5. Environment Variables

Create environment files for database connections. The project uses `dotenv-cli` to load the appropriate environment file for each script.

**.env** (for local development):
```
DATABASE_URL=postgres://user:password@127.0.0.1:5432/local_db
```

**.env.production** (for production - e.g., Neon DB):
```
DATABASE_URL=postgres://user:password@your.neon.host.neon.tech:5432/your_db?sslmode=require
```

#### 6. Apply Database Migrations

After configuring your bindings, apply the database schema to your Postgres database using Drizzle:

```shell
# Generate migration files from schema changes
pnpm run db:generate

# Apply migrations to local database (uses .env)
pnpm run db:migrate:local

# Apply migrations to production database (uses .env.production)
pnpm run db:migrate:prod
```

You can also use Drizzle Studio to browse your database:

```shell
# Local database
pnpm run db:studio:local

# Production database
pnpm run db:studio:prod
```

### Local Development

To start the local development server, run the following command:

```shell
# Start Postgres first (if not already running)
docker-compose up -d

# Start the dev server
pnpm run dev
```

This command starts the SvelteKit development server and uses `wrangler` to simulate the Cloudflare environment locally. The `localConnectionString` in `wrangler.jsonc` connects to your local Postgres container.

### Deploy

```shell
pnpm run deploy
```

[^1]: [Configuration - Wrangler · Cloudflare Workers docs](https://developers.cloudflare.com/workers/wrangler/configuration/)
