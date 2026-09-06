# OpenNext example

This Next.js Worker runs Better Auth 1.7 through OpenNext. D1 stores users, accounts, verification values, and session records. KV caches sessions. A Durable Object implements the atomic rolling rate limiter. R2 stores uploaded files.

## Setup

Install dependencies:

```bash
pnpm install
```

Set the D1, KV, and R2 resource IDs in `wrangler.toml`. The file already declares the `BETTER_AUTH_STORAGE` binding and the SQLite-backed `BetterAuthDurableObject` class. `custom-worker.ts` wraps OpenNext's generated handler and exports that class.

Set the runtime values and secret:

```toml
[vars]
BETTER_AUTH_URL = "https://your-app.example.com"
BETTER_AUTH_TRUSTED_ORIGINS = "https://your-app.workers.dev"
```

```bash
wrangler secret put BETTER_AUTH_SECRET
```

For a new empty D1 database, apply the checked-in migrations:

```bash
pnpm db:migrate:prod
```

Build and test the Worker locally:

```bash
pnpm preview
```

Deploy it with:

```bash
pnpm run deploy
```

## Files

- `src/auth/index.ts` builds the runtime configuration from OpenNext's Cloudflare context.
- `src/auth.config.ts` is the static Better Auth CLI configuration.
- `custom-worker.ts` re-exports the Durable Object class alongside OpenNext's handler.
- `src/db/auth.schema.ts` contains the generated Better Auth schema.
- `drizzle/` contains D1 migrations.

## Scripts

- `pnpm auth:update` regenerates and formats the Better Auth schema.
- `pnpm db:generate` generates a Drizzle migration.
- `pnpm db:check` verifies that the migration chain produces the declared schema.
- `pnpm db:migrate:dev` applies migrations to local D1.
- `pnpm db:migrate:prod` applies migrations to remote D1.
- `pnpm build` builds Next.js.
- `pnpm build:cf` builds the OpenNext Worker.
- `pnpm preview` runs the built Worker locally.

Do not edit generated schema or migration files by hand. Change `src/auth.config.ts`, run `pnpm auth:update`, then run `pnpm db:generate`. CI reruns both generators, checks migration history and schema equivalence, and applies the chain to a fresh local D1 database.
