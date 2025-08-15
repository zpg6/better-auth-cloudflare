# Integration Tests

Comprehensive integration tests for the Better Auth Cloudflare CLI.

## Prerequisites

```bash
# Required environment variables
export CLOUDFLARE_ACCOUNT_ID="your-cloudflare-account-id"
export DATABASE_URL="postgresql://user:password@host:port/database?sslmode=require"

# Install and authenticate Wrangler CLI
npm install -g wrangler
wrangler auth login
```

NOTE: Your `DATABASE_URL` needs to be a valid cloud-hosted PostgreSQL connection string Hyperdrive can use.

## Running Tests

```bash
# All integration tests
bun run test:integration

# Unit tests only
bun run test:unit

# All tests
bun run test
```

## What Gets Tested

**7 configurations** covering Hono/Next.js with D1/Hyperdrive, KV, R2, and skip-setup scenarios.

Each test validates:

- CLI execution and file generation
- Database migrations and deployments
- Route responses (200 for home, 401/redirect for protected)
- Resource cleanup

Tests run in isolated temporary directories with unique timestamps.

## Troubleshooting

**Tests skipped?** Set `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`, ensure wrangler is authenticated.

**PostgreSQL errors?** Check connection string format and special character escaping.

**Timeouts?** Next.js deployments take up to 5 minutes, Hono takes 2-3 minutes.
