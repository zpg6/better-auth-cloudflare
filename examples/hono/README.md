# Hono example

This Worker runs Better Auth 1.7 on Hono. D1 stores users, accounts, and session records. The package's Durable Object adapter mirrors sessions and stores one-time verification values and rate-limit counters.

## Setup

Install dependencies:

```bash
pnpm install
```

Create a D1 database and put its name and ID in `wrangler.toml`:

```bash
wrangler d1 create better-auth-cloudflare-hono-db
```

The checked-in Wrangler config already declares the `BETTER_AUTH_STORAGE` binding and the SQLite-backed `BetterAuthDurableObject` class. Cloudflare creates that namespace on the first deployment.

Set a secret of at least 32 random characters:

```bash
wrangler secret put BETTER_AUTH_SECRET
```

For a new empty D1 database, apply the checked-in migrations:

```bash
pnpm db:migrate:prod
```

Run locally or deploy:

```bash
pnpm dev
pnpm run deploy
```

## Files

- `src/auth/index.ts` builds the runtime configuration from Worker bindings.
- `src/auth.config.ts` is the static Better Auth CLI configuration.
- `src/index.ts` handles requests and exports the Durable Object class.
- `src/db/auth.schema.ts` contains the generated Better Auth schema.
- `drizzle/` contains D1 migrations.

## Scripts

- `pnpm auth:update` regenerates and formats the Better Auth schema.
- `pnpm db:generate` generates a Drizzle migration.
- `pnpm db:check` verifies that the migration chain produces the declared schema.
- `pnpm db:migrate:dev` applies migrations to local D1.
- `pnpm db:migrate:prod` applies migrations to remote D1.
- `pnpm build` runs TypeScript without emitting files.
- `pnpm cf-typegen` regenerates Worker binding types.

Do not edit generated schema or migration files by hand. Change `src/auth.config.ts`, run `pnpm auth:update`, then run `pnpm db:generate`. CI reruns both generators, checks migration history and schema equivalence, and applies the chain to a fresh local D1 database.

The demo exposes `/health`, `/protected`, and Better Auth under `/api/auth/*`.
