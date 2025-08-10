# @better-auth-cloudflare/cli

## Usage

```bash
npx @better-auth-cloudflare/cli                         # Run interactive generator
npx @better-auth-cloudflare/cli generate                # Run interactive generator
npx @better-auth-cloudflare/cli migrate                 # Run migration workflow
npx @better-auth-cloudflare/cli --app-name=my-app ...   # Run with arguments
bunx @better-auth-cloudflare/cli --app-name=my-app ...  # Run with arguments
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
npx @better-auth-cloudflare/cli --app-name=my-hono-app --template=hono --database=d1
```

Create a Next.js app with PostgreSQL via Hyperdrive:

```bash
npx @better-auth-cloudflare/cli --app-name=my-next-app --template=nextjs \
  --database=hyperdrive-postgres --hd-connection-string=postgres://user:pass@host:5432/db
```

Create app without KV or R2:

```bash
npx @better-auth-cloudflare/cli --app-name=minimal-app --kv=false --r2=false
```

Skip Cloudflare setup (useful for CI/CD):

```bash
npx @better-auth-cloudflare/cli --app-name=ci-app --skip-cloudflare-setup=true
```

Specify account ID for non-interactive mode:

```bash
npx @better-auth-cloudflare/cli --app-name=prod-app --account-id=your-account-id
```

Apply migrations automatically in non-interactive mode:

```bash
npx @better-auth-cloudflare/cli --app-name=auto-app --apply-migrations=dev
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
