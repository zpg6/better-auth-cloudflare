# `better-auth-cloudflare` Example: Next.js on Cloudflare Workers

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

### Async Database Initialization

```typescript
import { KVNamespace } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { getDb } from "../db";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb(); // Get your D1 database instance
    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: getCloudflareContext().cf, // OpenNext.js context access
                d1: {
                    db: dbInstance, // Async database instance
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },
                kv: process.env.KV as KVNamespace<string>,
            },
            {
                emailAndPassword: {
                    enabled: true,
                },
                socialProviders: {
                    // Configure social providers as needed
                },
                rateLimit: {
                    enabled: true,
                },
                plugins: [openAPI()],
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
            // No actual database or KV instance needed, only schema-affecting options
        },
        {
            // Include only configurations that influence the Drizzle schema
            emailAndPassword: {
                enabled: true,
            },
            plugins: [openAPI()],
        }
    ),

    // Used by the Better Auth CLI for schema generation
    database: drizzleAdapter(process.env.DATABASE as any, {
        provider: "sqlite",
        usePlural: true,
        debugLogs: true,
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
