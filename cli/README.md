# @better-auth-cloudflare/cli

[![NPM Version](https://img.shields.io/npm/v/@better-auth-cloudflare/cli)](https://www.npmjs.com/package/@better-auth-cloudflare/cli)
[![NPM Downloads](https://img.shields.io/npm/dt/@better-auth-cloudflare/cli)](https://www.npmjs.com/package/@better-auth-cloudflare/cli)
[![License: MIT](https://img.shields.io/npm/l/@better-auth-cloudflare/cli)](https://opensource.org/licenses/MIT)

> Part of the [Better Auth Cloudflare](https://github.com/zpg6/better-auth-cloudflare) ecosystem - A complete authentication solution for Cloudflare Workers with Better Auth, featuring ready-to-use templates and integrations.

Generate a Better Auth Cloudflare project with D1, KV, R2, or Hyperdrive. This CLI tool provides scaffolding for both Hono and Next.js (OpenNext.js) applications with automatic Cloudflare resource setup.

**Note**: The `generate` command configures one primary database (D1, Postgres via Hyperdrive, or MySQL via Hyperdrive). You can add additional database connections manually after project creation.

## What This CLI Replaces

**The `generate` command** eliminates manual project setup:

🏗️ Creates complete Hono or Next.js projects with pre-configured auth (more types coming)

- Sets up TypeScript configs, package.json scripts, file structure, and API routes
- Creates database adapters for D1, Postgres, or MySQL

☁️ Handles Cloudflare resource creation:

- Runs `wrangler d1/kv/r2 create` commands and configures `wrangler.toml`
- Sets up Hyperdrive connections and auth integrations

📦 Runs initial setup: `auth generate`, `drizzle-kit generate`, and optionally applies migrations

🚀 Deploys only after an interactive production migration succeeds; otherwise it prints the migration and deploy commands

**The `migrate` command** streamlines schema updates:

🔄 Handles the workflow when you modify auth configuration: generates auth schema, creates Drizzle migrations, and optionally applies them

## Quick Start

**Check version and get help**:

```bash
npx @better-auth-cloudflare/cli --version    # Show version
npx @better-auth-cloudflare/cli -v           # Show version (short)
npx @better-auth-cloudflare/cli version      # Show version (command)
npx @better-auth-cloudflare/cli              # Show help with version
```

**Interactive mode** (asks questions):

```bash
npx @better-auth-cloudflare/cli generate
```

**Non-interactive mode** (use arguments):

```bash
# Simple D1 app with KV (ready to run)
npx @better-auth-cloudflare/cli generate \
  --app-name=my-auth-app \
  --template=hono \
  --database=d1 \
  --kv=true \
  --r2=false \
  --apply-migrations=dev
```

**Migration workflow**:

```bash
npx @better-auth-cloudflare/cli migrate              # Interactive
npx @better-auth-cloudflare/cli migrate --migrate-target=dev  # Non-interactive
npx @better-auth-cloudflare/cli migrate --migrate-target=remote --confirm-remote
```

Remote migrations require confirmation that you reviewed the SQL, backed up the database, and rehearsed the migration.

Non-interactive generation does not apply production migrations. Generate the project with the default `skip`, review its SQL, then run the remote `migrate` command from the new project.

`migrate` searches the current directory and its parents for `wrangler.json`, then `wrangler.jsonc`, then `wrangler.toml`. It handles:

- D1 databases with local and remote migration options
- Hyperdrive databases with migration guidance

## Arguments

```
--app-name=<name>              Project name (default: my-app)
--template=<template>          hono | nextjs (default: hono)
--database=<db>                d1 | hyperdrive-postgres | hyperdrive-mysql (default: d1)
--geolocation=<bool>           Enable geolocation tracking (default: true)
--kv=<bool>                    Use KV as secondary storage for Better Auth (default: true)
--r2=<bool>                    Enable R2 to extend Better Auth with user file storage (default: false)
```

**KV Integration**: Provides session caching. Generated projects route Better Auth 1.7 verification and rate limiting to the configured database because Workers KV cannot provide the required atomic operations.

**R2 Integration**: Enables file upload and management capabilities. See [R2 setup guide](../docs/r2.md) for detailed configuration and usage.

### Database-specific arguments

```
--d1-name=<name>               D1 database name (default: <app-name>-db)
--d1-binding=<binding>         D1 binding name (default: DATABASE)
--hd-name=<name>               Hyperdrive instance name (default: <app-name>-hyperdrive)
--hd-binding=<binding>         Hyperdrive binding name (default: HYPERDRIVE)
--hd-connection-string=<url>   Database connection string (required for hyperdrive)
```

### Storage arguments

```
--kv-binding=<binding>         KV binding name (default: KV)
--kv-namespace-name=<name>     KV namespace name (default: <app-name>-kv)
--r2-binding=<binding>         R2 binding name (default: R2_BUCKET)
--r2-bucket-name=<name>        R2 bucket name (default: <app-name>-files)
```

### Cloudflare account arguments

```
--account-id=<id>              Cloudflare account ID (only required if you have multiple accounts)
--skip-cloudflare-setup=<bool> Skip Cloudflare resource creation and deployment (default: false)
--apply-migrations=<choice>    Apply migrations during generation: dev | skip (default: skip)
```

### Migrate command arguments

```
--migrate-target=<target>      For migrate command: dev | remote | skip (default: skip)
--confirm-remote               Confirm review, backup, and rehearsal before a remote migration
```

## Examples

Create a Hono app with D1 database:

```bash
npx @better-auth-cloudflare/cli generate --app-name=my-hono-app --template=hono --database=d1
```

Create a Next.js app with PostgreSQL via Hyperdrive:

```bash
npx @better-auth-cloudflare/cli generate --app-name=my-next-app --template=nextjs \
  --database=hyperdrive-postgres --hd-connection-string=postgres://user:pass@host:5432/db
```

Create app without KV or R2:

```bash
npx @better-auth-cloudflare/cli generate --app-name=minimal-app --kv=false --r2=false
```

Create a project and apply its migrations locally:

```bash
npx @better-auth-cloudflare/cli generate --app-name=my-app --apply-migrations=dev
# Creates resources and applies local migrations without deploying
```

Skip Cloudflare setup and deployment (useful for CI/CD):

```bash
npx @better-auth-cloudflare/cli generate --app-name=ci-app --skip-cloudflare-setup=true
# Only generates project files, no Cloudflare resources or deployment
```

Specify account ID for non-interactive mode:

```bash
npx @better-auth-cloudflare/cli generate --app-name=prod-app --account-id=your-account-id
```

Apply migrations automatically in non-interactive mode:

```bash
npx @better-auth-cloudflare/cli generate --app-name=auto-app --apply-migrations=dev
```

Run migration workflow interactively:

```bash
npx @better-auth-cloudflare/cli migrate
```

Run migration workflow with non-interactive target:

```bash
npx @better-auth-cloudflare/cli migrate --migrate-target=dev
```

---

Creates a Better Auth Cloudflare project from Hono or OpenNext.js templates and can create Cloudflare D1, KV, R2, or Hyperdrive resources. The migrate command updates the auth schema, generates migrations, and applies D1 migrations to the selected binding. Hyperdrive projects use their generated migration scripts.

## Troubleshooting

**Error `...Error [ERR_REQUIRE_ESM]: require() of ES Module...`**:

Loading ECMAScript modules using `require()` should be supported by your nodejs.
Make sure your node version is at least `v23.0.0`, `v22.12.0`, or `v20.19.0`, depending on the major version you use.
Read more [here](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)

## Related

- 📦 **[better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)** - Main package and documentation
- 🌐 **[Better Auth](https://github.com/better-auth/better-auth)** - The authentication library powering this ecosystem
- 📚 **[Examples](https://github.com/zpg6/better-auth-cloudflare/tree/main/examples)** - Ready-to-use templates and implementations
- 🐛 **[Issues](https://github.com/zpg6/better-auth-cloudflare/issues)** - Bug reports, typos, and support

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
