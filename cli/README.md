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

📦 Runs initial setup: `@better-auth/cli generate`, `drizzle-kit generate`, and optionally applies migrations

🚀 Deploys to Cloudflare Workers when resources are set up (automatic in non-interactive mode, prompted in interactive mode)

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
```

The migrate command automatically detects your database configuration from `wrangler.toml`. It supports:

- **D1 databases**: Offers migration options (dev/remote)
- **Hyperdrive databases**: Shows informational message
- **Multiple databases**: Prompts you to choose which D1 database to migrate
- **Multi-tenancy**: Automatically detects and handles schema splitting for tenant databases

**Multi-tenancy workflow**:

```bash
# Apply tenant migrations to all tenant databases (same account)
CLOUDFLARE_D1_API_TOKEN=xxx CLOUDFLARE_ACCT_ID=yyy CLOUDFLARE_DATABASE_ID=zzz \
  npx @better-auth-cloudflare/cli migrate:tenants
```

## Arguments

```
--app-name=<name>              Project name (default: my-app)
--template=<template>          hono | nextjs (default: hono)
--database=<db>                d1 | hyperdrive-postgres | hyperdrive-mysql (default: d1)
--geolocation=<bool>           Enable geolocation tracking (default: true)
--kv=<bool>                    Use KV as secondary storage for Better Auth (default: true)
--r2=<bool>                    Enable R2 to extend Better Auth with user file storage (default: false)
```

**KV Integration**: Provides secondary storage for Better Auth sessions, rate limiting, and other features. See [Better Auth secondary storage documentation](https://www.better-auth.com/docs/reference/options#secondarystorage).

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
--apply-migrations=<choice>    Apply D1 migrations: dev | prod | skip (default: skip)
```

### Migrate command arguments

```
--migrate-target=<target>      For migrate command: dev | remote | skip (default: skip)
```

### Multi-tenancy commands

```
migrate:tenants                Apply migrations to all tenant databases
--auto-confirm                 Skip confirmation prompts (default: false)
--dry-run                      Preview what would be migrated without applying changes
--verbose                      Show detailed migration logs and debugging info
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

Create and deploy in one command (default behavior):

```bash
npx @better-auth-cloudflare/cli generate --app-name=my-app
# Creates resources, runs migrations, and deploys automatically
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

## Multi-Tenancy Workflow

The CLI provides comprehensive support for organization-based multi-tenancy with automatic schema separation and migration management.

### Automatic Multi-Tenancy Detection

The `migrate` command automatically detects multi-tenancy configurations and handles schema splitting:

```bash
# Single command handles everything for multi-tenant setups
npx @better-auth-cloudflare/cli migrate --migrate-target=dev
```

**What happens automatically:**

- Detects multi-tenancy from auth configuration (`multiTenancy` with `mode: "organization"`)
- Splits generated schemas into core auth tables vs tenant-specific tables
- Creates separate drizzle configs (`drizzle.config.ts` vs `drizzle-tenant.config.ts`)
- Generates core migrations and applies them to main database
- Generates tenant migrations and sets up tenant migration system

### Schema Separation Logic

**Core Auth Tables (Main Database):**

- `users`, `accounts`, `sessions`, `verifications`
- `tenants`, `invitations`, `organizations`, `members`

**Tenant Tables (Individual Tenant Databases):**

- All other plugin tables (e.g., `userFiles`, custom plugin tables)

### Tenant Migration Commands

Apply migrations to all active tenant databases:

```bash
# Same account scenario (3 variables)
CLOUDFLARE_D1_API_TOKEN=xxx CLOUDFLARE_ACCT_ID=yyy CLOUDFLARE_DATABASE_ID=zzz \
  npx @better-auth-cloudflare/cli migrate:tenants

# Separate accounts scenario (5 variables)
CLOUDFLARE_MAIN_D1_API_TOKEN=aaa CLOUDFLARE_MAIN_ACCT_ID=bbb CLOUDFLARE_MAIN_DATABASE_ID=ccc \
CLOUDFLARE_D1_API_TOKEN=xxx CLOUDFLARE_ACCT_ID=yyy \
  npx @better-auth-cloudflare/cli migrate:tenants

# Non-interactive mode (same account)
CLOUDFLARE_D1_API_TOKEN=xxx CLOUDFLARE_ACCT_ID=yyy CLOUDFLARE_DATABASE_ID=zzz \
  npx @better-auth-cloudflare/cli migrate:tenants --auto-confirm

# Dry-run to preview changes (same account)
CLOUDFLARE_D1_API_TOKEN=xxx CLOUDFLARE_ACCT_ID=yyy CLOUDFLARE_DATABASE_ID=zzz \
  npx @better-auth-cloudflare/cli migrate:tenants --dry-run
```

### Environment Variables for Multi-Tenancy

**For SAME account** (main and tenant DBs in same Cloudflare account - 3 variables):

```bash
CLOUDFLARE_D1_API_TOKEN     # API token with D1:edit permissions
CLOUDFLARE_ACCT_ID          # Account ID for both main and tenant databases
CLOUDFLARE_DATABASE_ID      # Main database ID
```

**For SEPARATE accounts** (main and tenant DBs in different accounts - 5 variables):

```bash
CLOUDFLARE_MAIN_D1_API_TOKEN    # API token for main database account
CLOUDFLARE_MAIN_ACCT_ID         # Account ID for main database
CLOUDFLARE_MAIN_DATABASE_ID     # Main database ID
CLOUDFLARE_D1_API_TOKEN         # API token for tenant databases account
CLOUDFLARE_ACCT_ID              # Account ID where tenant databases are managed
```

### Multi-Tenancy File Structure

```
your-project/
├── drizzle.config.ts              # Main database configuration
├── drizzle/                       # Main database migrations
│   ├── 0000_initial.sql
│   └── meta/
├── drizzle-tenant.config.ts       # Tenant database configuration
├── drizzle-tenant/                # Tenant database migrations
│   ├── 0000_tenant_tables.sql
│   └── meta/
└── src/db/
    ├── auth.schema.ts             # Core auth schema (main DB)
    ├── tenant.schema.ts           # Tenant schema (tenant DBs)
    └── tenant.raw.ts              # Raw tenant utilities
```

---

Creates a new Better Auth Cloudflare project from Hono or OpenNext.js templates, optionally creating Cloudflare D1, KV, R2, or Hyperdrive resources for you. The migrate command runs `auth:update`, `db:generate`, handles multi-tenancy schema splitting, and optionally applies migrations. The `migrate:tenants` command applies tenant migrations to all tracked tenant databases.

## Related

- 📦 **[better-auth-cloudflare](https://github.com/zpg6/better-auth-cloudflare)** - Main package and documentation
- 🌐 **[Better Auth](https://github.com/better-auth/better-auth)** - The authentication library powering this ecosystem
- 📚 **[Examples](https://github.com/zpg6/better-auth-cloudflare/tree/main/examples)** - Ready-to-use templates and implementations
- 🐛 **[Issues](https://github.com/zpg6/better-auth-cloudflare/issues)** - Bug reports, typos, and support

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
