# `better-auth-cloudflare` Example: Multi-tenancy with D1 and Next.js

This example demonstrates how to use [`better-auth-cloudflare`](https://github.com/better-auth/better-auth), our authentication package specifically designed for Cloudflare, with a Next.js application deployed to [Cloudflare Workers](https://workers.cloudflare.com/) using the [OpenNext Cloudflare adapter](https://github.com/opennextjs/opennextjs-cloudflare).

## About `better-auth-cloudflare`

`better-auth-cloudflare` provides seamless authentication capabilities for applications deployed to Cloudflare's serverless platform. This package handles:

- User authentication and session management
- Integrating with Cloudflare's D1 database
- Support for the App Router architecture in Next.js
- Schema generation with Drizzle ORM

This example project showcases a complete implementation of our authentication solution in a real-world Next.js application.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the authentication features in action.

## Authentication Scripts

Our package provides several scripts to help manage authentication:

- `pnpm auth:generate`: Generates the Drizzle schema for Better Auth based on your configuration in `src/auth/index.ts`. The output is saved to `src/db/auth.schema.ts`.
- `pnpm auth:format`: Formats the generated `auth.schema.ts` file using Prettier.
- `pnpm auth:update`: A convenience script that runs both `auth:generate` and `auth:format` in sequence.

## Database Management

The example configures `better-auth-cloudflare` to work with Cloudflare's D1 database:

- `pnpm db:generate`: Generates SQL migration files based on changes in your Drizzle schema (defined in `src/db/schema.ts` and the generated `src/db/auth.schema.ts`).
- `pnpm db:migrate:dev`: Applies pending migrations to your local D1 database.
- `pnpm db:migrate:prod`: Applies pending migrations to your remote/production D1 database.
- `pnpm db:studio:dev`: Starts Drizzle Studio, a local GUI for browsing your local D1 database.
- `pnpm db:studio:prod`: Starts Drizzle Studio for your remote/production D1 database.

## Multi-Tenancy Architecture

This example demonstrates organization-based multi-tenancy where each organization gets its own D1 database. The architecture cleanly separates concerns:

```
examples/opennextjs-org-d1-multi-tenancy/
├── 📄 drizzle.config.ts              # Main/Auth database configuration
├── 📁 drizzle/                       # Main/Auth migrations
│   ├── 0000_clumsy_ultimates.sql
│   ├── 0001_eminent_meggan.sql
│   └── meta/
├── 📄 drizzle-tenant.config.ts       # Tenant database configuration
├── 📁 drizzle-tenant/                # Tenant-specific migrations
│   ├── 0000_steady_falcon.sql
│   ├── 0001_wide_agent_zero.sql
│   ├── 0002_kind_carnage.sql
│   └── meta/
└── src/db/
    ├── auth.schema.ts                # Main/Auth schema definitions
    ├── tenant.schema.ts              # Tenant schema definitions
    └── tenant.raw.ts                 # Raw tenant database utilities
```

## Multi-Tenancy Migration Workflow

The CLI automatically handles schema splitting and migration generation with intelligent separation of concerns.

### Complete Setup (One Command)

```bash
# This handles everything: schema splitting, core migrations, and tenant migration setup
npx @better-auth-cloudflare/cli migrate
```

This single command will:

- Run `auth:update` to generate schemas with all plugin tables
- Automatically detect multi-tenancy and split schemas into core vs tenant
- Generate core migrations and apply them to main database
- Create tenant-specific drizzle config (`drizzle-tenant.config.ts`)
- Generate tenant migrations and set up the tenant migration system
- Provide next steps for tenant database migrations

### Schema Separation Logic

The CLI intelligently separates tables:

- **Main Database (Core Auth)**: `users`, `accounts`, `sessions`, `verifications`, `tenants`, `invitations`, `organizations`, `members`
- **Tenant Databases**: All other tables (e.g., `userFiles`, `userBirthdays`, `birthdayReminders`)

### Applying Tenant Migrations

When you have tenant databases that need migrations, use the `migrate:tenants` command with the appropriate environment variables based on your Cloudflare account setup.

#### Environment Variables

**For SAME account** (main and tenant DBs in same Cloudflare account - 3 variables):

```bash
CLOUDFLARE_D1_API_TOKEN=xxx     # API token with D1:edit permissions
CLOUDFLARE_ACCT_ID=yyy          # Account ID for both main and tenant databases
CLOUDFLARE_DATABASE_ID=zzz      # Main database ID
```

**For SEPARATE accounts** (main and tenant DBs in different accounts - 5 variables):

```bash
CLOUDFLARE_MAIN_D1_API_TOKEN=aaa    # API token for main database account
CLOUDFLARE_MAIN_ACCT_ID=bbb         # Account ID for main database
CLOUDFLARE_MAIN_DATABASE_ID=ccc     # Main database ID
CLOUDFLARE_D1_API_TOKEN=xxx         # API token for tenant databases account
CLOUDFLARE_ACCT_ID=yyy              # Account ID where tenant databases are managed
```

#### Usage Examples

```bash
# Same account scenario
CLOUDFLARE_D1_API_TOKEN=your_token CLOUDFLARE_ACCT_ID=your_account_id CLOUDFLARE_DATABASE_ID=your_db_id \
  npx @better-auth-cloudflare/cli migrate:tenants

# Separate accounts scenario
CLOUDFLARE_MAIN_D1_API_TOKEN=main_token CLOUDFLARE_MAIN_ACCT_ID=main_account CLOUDFLARE_MAIN_DATABASE_ID=main_db \
CLOUDFLARE_D1_API_TOKEN=tenant_token CLOUDFLARE_ACCT_ID=tenant_account \
  npx @better-auth-cloudflare/cli migrate:tenants

# Non-interactive mode (skip confirmation)
CLOUDFLARE_D1_API_TOKEN=your_token CLOUDFLARE_ACCT_ID=your_account_id CLOUDFLARE_DATABASE_ID=your_db_id \
  npx @better-auth-cloudflare/cli migrate:tenants --auto-confirm

# Dry-run to preview changes
CLOUDFLARE_D1_API_TOKEN=your_token CLOUDFLARE_ACCT_ID=your_account_id CLOUDFLARE_DATABASE_ID=your_db_id \
  npx @better-auth-cloudflare/cli migrate:tenants --dry-run
```

The `migrate:tenants` command:

- Fetches all active tenant databases from the main database
- Checks each tenant database for pending migrations
- Applies migrations using Drizzle's built-in migrator
- Updates tenant status in the main database
- Provides detailed progress and error reporting

### Manual Tenant Migration Generation

If you need to generate new tenant migrations after schema changes:

```bash
# Generate new tenant migrations
npx drizzle-kit generate --config=drizzle-tenant.config.ts

# Apply to all tenant databases (same account)
CLOUDFLARE_D1_API_TOKEN=your_token CLOUDFLARE_ACCT_ID=your_account_id CLOUDFLARE_DATABASE_ID=your_db_id \
  npx @better-auth-cloudflare/cli migrate:tenants
```

That's it! The CLI handles all the complexity of multi-database management for you.

## Deployment Scripts

Deploy your Next.js application with Better Auth to Cloudflare:

- `pnpm build:cf`: Builds the application specifically for Cloudflare Workers using OpenNext.
- `pnpm deploy`: Builds the application for Cloudflare and deploys it.
- `pnpm preview`: Builds the application for Cloudflare and allows you to preview it locally before deploying.

## Additional Scripts

- `pnpm build`: Creates an optimized production build of your Next.js application.
- `pnpm clean`: Removes build artifacts, cached files, and `node_modules`.
- `pnpm clean-deploy`: Cleans the project, reinstalls dependencies, and then deploys.
- `pnpm format`: Formats all project files using Prettier.
- `pnpm lint`: Lints the project using Next.js's built-in ESLint configuration.

## Authentication Configuration

OpenNext.js requires a more complex auth configuration due to its async database initialization and singleton requirements. The configuration in `src/auth/index.ts` uses the following pattern:

### Async Database Initialization with Multi-Tenancy

```typescript
import { KVNamespace } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, openAPI, organization } from "better-auth/plugins";
import { getDb, schema } from "../db";
import { raw } from "../db/tenant.raw";
import { birthdayPlugin } from "./plugins/birthday";

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb();
    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: getCloudflareContext().cf,
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                        schema, // Include the full schema for tenant table filtering
                    },
                    multiTenancy: {
                        cloudflareD1Api: {
                            apiToken: process.env.CLOUDFLARE_D1_API_TOKEN!,
                            accountId: process.env.CLOUDFLARE_ACCT_ID!,
                        },
                        mode: "organization", // Create a separate database for each organization
                        databasePrefix: "org_tenant_",
                        migrations: {
                            currentSchema: raw, // Current schema applied to new tenant databases
                            currentVersion: "v1.0.0",
                        },
                        // Optional: custom routing logic for plugin tables
                        tenantRouting: ({ modelName, operation, data }) => {
                            return undefined; // Fall back to default tenantId field lookup
                        },
                        hooks: {
                            afterCreate: async ({ tenantId, databaseName }) => {
                                console.log(`✅ Created tenant database ${databaseName} for org ${tenantId}`);
                            },
                        },
                    },
                },
                kv: process.env.KV as KVNamespace<string>,
            },
            {
                rateLimit: { enabled: true },
                plugins: [
                    openAPI(),
                    anonymous(),
                    organization(),
                    birthdayPlugin({ enableReminders: true, reminderDaysBefore: 7 }),
                ],
            }
        )
    );
}

// Singleton pattern to ensure a single auth instance
let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null;

// Asynchronously initializes and retrieves the shared auth instance
export async function initAuth() {
    if (!authInstance) {
        authInstance = await authBuilder();
    }
    return authInstance;
}
```

### CLI Schema Generation Configuration

For the Better Auth CLI to generate schemas, a separate static configuration is required:

```typescript
// This simplified configuration is used by the Better Auth CLI for schema generation.
// It's necessary because the main `authBuilder` performs async operations like `getDb()`
// which use `getCloudflareContext` (not available in CLI context).
export const auth = betterAuth({
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: {},
            d1: {
                db: {} as any, // Mock database for schema generation
                options: {
                    usePlural: true,
                    schema,
                },
                multiTenancy: {
                    cloudflareD1Api: { apiToken: "mock-token", accountId: "mock-account" },
                    mode: "organization",
                    databasePrefix: "org_tenant_",
                },
            },
        },
        {
            plugins: [
                openAPI(),
                anonymous(),
                organization(),
                birthdayPlugin({ enableReminders: true, reminderDaysBefore: 7 }),
            ],
        }
    ),

    // Used by the Better Auth CLI for schema generation
    database: drizzleAdapter(process.env.DATABASE as any, {
        provider: "sqlite",
        usePlural: true,
    }),
});
```

### Why This Pattern is Needed

Unlike simpler frameworks, OpenNext.js requires this dual configuration because:

1. **Async Database Access**: `getCloudflareContext()` and `getDb()` are async operations not available during CLI execution
2. **Singleton Pattern**: Ensures single auth instance across serverless functions
3. **CLI Compatibility**: The static `auth` export allows schema generation to work

For simpler frameworks like Hono, see the [Hono example](../hono/README.md) for a more streamlined single-configuration approach.

## Learn More

To learn more about Better Auth and its features, visit [our documentation](https://github.com/better-auth/better-auth).

For Next.js resources:

- [Next.js Documentation](https://nextjs.org/docs)
- [Learn Next.js](https://nextjs.org/learn)
