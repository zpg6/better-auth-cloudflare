This is an example TanStack Start application using [better-auth-cloudflare](https://github.com/better-auth/better-auth).

# Getting Started

Install dependencies:

```bash
pnpm install
```

Then follow the setup steps below to configure Cloudflare and Better Auth before running the dev server.

## Setting up Cloudflare (Wrangler)

This app runs on Cloudflare Workers and uses a D1 database and a KV namespace. The repo does **not** ship a `wrangler.jsonc` — you need to create one and provision the resources yourself. The code expects the bindings to be named **`db`** (D1) and **`kv`** (KV).

1. Install Wrangler and log in:

   ```bash
   pnpm add -D wrangler
   pnpm wrangler login
   ```

2. Create the D1 database:

   ```bash
   pnpm wrangler d1 create db
   ```

   Copy the `database_id` from the command's output.

   > 💡 If you only intend to develop locally, you can skip the `--remote` flag (which is the default behaviour here) — Wrangler will provision a local SQLite file under `.wrangler/` on the first `pnpm dev` run, and you won't consume any of your Cloudflare D1 quota.

3. Create the KV namespace:

   ```bash
   pnpm wrangler kv namespace create kv
   ```

   Copy the `id` from the output.

4. The Wrangler commands above will create/update `wrangler.jsonc` for you and print the binding snippets to paste. Ensure your `wrangler.jsonc` ends up looking approximately like this (with the IDs from the previous steps filled in):

   ```jsonc
   {
     "$schema": "node_modules/wrangler/config-schema.json",
     "name": "tanstack-start-app",
     "compatibility_date": "2025-09-02",
     "compatibility_flags": ["nodejs_compat"],
     "main": "src/server.ts",
     "d1_databases": [
       {
         "binding": "db",
         "database_name": "db",
         "database_id": "<your-d1-database-id>"
       }
     ],
     "kv_namespaces": [
       {
         "binding": "kv",
         "id": "<your-kv-namespace-id>"
       }
     ]
   }
   ```

   > ⚠️ The `binding` values **must** be `db` and `kv` — the auth setup in `src/lib/auth.ts` reads them by those names. In addition, the D1 `database_name` **must** also be `db`, because the `generate:db`, `migrate:dev`, and `migrate:prod` scripts in `package.json` reference the database by that name (`wrangler d1 migrations apply db ...`). If you want to use a different name, update those scripts to match.

5. Generate the Better Auth schema. The repo ships **without** `src/db/auth.schema.ts` and **without** any migrations — you generate them yourself:

   ```bash
   pnpm generate:auth
   ```

   This creates `src/db/auth.schema.ts` from `src/lib/auth.ts`.

6. Generate Cloudflare binding types (needed so TypeScript knows about `db` and `kv`):

   ```bash
   pnpm generate:cf-types
   ```

7. Generate the initial Drizzle migration SQL from the schema:

   ```bash
   pnpm generate:db
   ```

   This writes a new migration file under `drizzle/`.

8. Apply the migration to your local D1 database:

   ```bash
   pnpm migrate:dev
   ```

## Setting up Better Auth

1. Generate and set the `BETTER_AUTH_SECRET` environment variable in your `.env.local`:

   ```bash
   pnpm dlx @better-auth/cli secret
   ```

2. Also set `BETTER_AUTH_URL=http://localhost:3000` in `.env.local`.

3. Visit the [Better Auth documentation](https://www.better-auth.com) to unlock the full potential of authentication in your app.

## Running the dev server

Once the steps above are complete:

```bash
pnpm dev
```

The app will be available at [http://localhost:3000](http://localhost:3000).

---

# Building & Deploying to Production

Build the app:

```bash
pnpm build
```

Apply migrations to your remote Cloudflare D1 database:

```bash
pnpm migrate:prod
```

Push your `BETTER_AUTH_SECRET` as a Cloudflare secret:

```bash
pnpm wrangler secret put BETTER_AUTH_SECRET
```

Deploy:

```bash
pnpm deploy
```
