# @better-auth-cloudflare/cli

[![NPM Version](https://img.shields.io/npm/v/@better-auth-cloudflare/cli)](https://www.npmjs.com/package/@better-auth-cloudflare/cli)
[![NPM Downloads](https://img.shields.io/npm/dt/@better-auth-cloudflare/cli)](https://www.npmjs.com/package/@better-auth-cloudflare/cli)
[![License: MIT](https://img.shields.io/npm/l/@better-auth-cloudflare/cli)](https://opensource.org/licenses/MIT)

> Part of the [Better Auth Cloudflare](https://github.com/zpg6/better-auth-cloudflare) ecosystem - A complete authentication solution for Cloudflare Workers with Better Auth, featuring ready-to-use templates and integrations.

Generate a Better Auth Cloudflare project with D1, KV, R2, or Hyperdrive. This CLI tool provides scaffolding for both Hono and Next.js (OpenNext.js) applications with automatic Cloudflare resource setup.

## What This CLI Replaces

**The `generate` command** eliminates manual project setup:

🏗️ Creates complete Hono or Next.js projects with pre-configured auth (more types coming)
- Sets up TypeScript configs, package.json scripts, file structure, and API routes
- Creates database adapters for D1, Postgres, or MySQL

☁️ Handles Cloudflare resource creation:
- Runs `wrangler d1/kv/r2 create` commands and configures `wrangler.toml`
- Sets up Hyperdrive connections and auth integrations

📦 Runs initial setup: `@better-auth/cli generate`, `drizzle-kit generate`, and optionally applies migrations

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
# Simple D1 app
npx @better-auth-cloudflare/cli generate \
  --app-name=my-app \
  --template=hono \
  --database=d1

# Full-featured app with all options
npx @better-auth-cloudflare/cli generate \
  --app-name=my-production-app \
  --template=nextjs \
  --database=hyperdrive-postgres \
  --hd-connection-string=postgres://user:password@host:5432/db \
  --geolocation=true \
  --kv=true \
  --r2=true \
  --account-id=your-cloudflare-account-id \
  --apply-migrations=dev
```

**Migration workflow**:

```bash
npx @better-auth-cloudflare/cli migrate              # Interactive
npx @better-auth-cloudflare/cli migrate --migrate-target=dev  # Non-interactive
```

## Arguments

```
--app-name=<name>              Project name (default: my-app)
--template=<template>          hono | nextjs (default: hono)
--database=<db>                d1 | hyperdrive-postgres | hyperdrive-mysql (default: d1)
--geolocation=<bool>           Enable geolocation tracking (default: true)
--kv=<bool>                    Use KV storage (default: true)
--r2=<bool>                    Enable R2 storage (default: false)
```

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
--account-id=<id>              Cloudflare account ID (for non-interactive mode)
--skip-cloudflare-setup=<bool> Skip Cloudflare resource creation (default: false)
--apply-migrations=<choice>    Apply D1 migrations: dev | prod | skip (default: skip)
```

### Migrate command arguments

```
--migrate-target=<target>      For migrate command: dev | remote | skip (default: skip)
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

Skip Cloudflare setup (useful for CI/CD):

```bash
npx @better-auth-cloudflare/cli generate --app-name=ci-app --skip-cloudflare-setup=true
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

Creates a new Better Auth Cloudflare project from Hono or OpenNext.js templates, optionally creating Cloudflare D1, KV, R2, or Hyperdrive resources for you. The migrate command runs `auth:update`, `db:generate`, and optionally `db:migrate`.

## Related

- 📦 **[better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)** - Main package and documentation
- 🌐 **[Better Auth](https://github.com/better-auth/better-auth)** - The authentication library powering this ecosystem
- 📚 **[Examples](https://github.com/zpg6/better-auth-cloudflare/tree/main/examples)** - Ready-to-use templates and implementations
