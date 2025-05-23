# better-auth-cloudflare

Seamlessly integrate [Better Auth](https://github.com/better-auth/better-auth) with Cloudflare Workers, D1, KV, and geolocation services.

[![NPM Version](https://img.shields.io/npm/v/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![NPM Downloads](https://img.shields.io/npm/dt/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![License: MIT](https://img.shields.io/npm/l/better-auth-cloudflare)](https://opensource.org/licenses/MIT)

**DEMO**: [https://better-auth-cloudflare.zpg6.workers.dev/](https://better-auth-cloudflare.zpg6.workers.dev/)

The demo implementation is in [`examples/opennextjs`](./examples/opennextjs) directory along with recommended scripts for generating database schema, migrating, and more.

## Features

- 🗄️ **D1 Database Integration**: Leverage Cloudflare D1 as your primary database via Drizzle ORM.
- 🔌 **KV Storage Integration**: Optionally use Cloudflare KV for secondary storage (e.g., session caching).
- 📍 **Automatic Geolocation Tracking**: Enrich user sessions with location data derived from Cloudflare.
- 🌐 **Cloudflare IP Detection**: Utilize Cloudflare's IP detection headers out-of-the-box.
- 🔍 **Rich Client-Side Context**: Access timezone, city, country, region, and more via the client plugin.

## Table of Contents

- [Installation](#installation)
- [Configuration Options](#configuration-options)
- [Setup](#setup)
    - [1. Define Your Database Schema (`src/db/schema.ts`)](#1-define-your-database-schema-srcdbschemats)
    - [2. Initialize Drizzle ORM (`src/db/index.ts`)](#2-initialize-drizzle-orm-srcdbindexts)
    - [3. Configure Better Auth (`src/auth/index.ts`)](#3-configure-better-auth-srcauthindexts)
    - [4. Generate and Manage Auth Schema with D1](#4-generate-and-manage-auth-schema-with-d1)
    - [5. Configure KV as Secondary Storage (Optional)](#5-configure-kv-as-secondary-storage-optional)
    - [6. Set Up API Routes](#6-set-up-api-routes)
    - [7. Initialize the Client](#7-initialize-the-client)
- [Usage Examples](#usage-examples)
    - [Accessing Geolocation Data](#accessing-geolocation-data)
- [License](#license)
- [Contributing](#contributing)

## Installation

```bash
npm install better-auth-cloudflare
# or
yarn add better-auth-cloudflare
# or
pnpm add better-auth-cloudflare
# or
bun add better-auth-cloudflare
```

## Configuration Options

| Option                | Type    | Default | Description                                    |
| --------------------- | ------- | ------- | ---------------------------------------------- |
| `autoDetectIpAddress` | boolean | `true`  | Auto-detect IP address from Cloudflare headers |
| `geolocationTracking` | boolean | `true`  | Track geolocation data in the session table    |

## Setup

Integrating `better-auth-cloudflare` into your project involves a few key steps to configure your database, authentication logic, and API routes. Follow these instructions to get started:

<br>

### 1. Define Your Database Schema (`src/db/schema.ts`)

You'll need to merge the Better Auth schema with any other Drizzle schemas your application uses. This ensures that Drizzle can manage your entire database structure, including the tables required by Better Auth.

```typescript
import * as authSchema from "./auth.schema"; // This will be generated in a later step

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    // ... your other application schemas
} as const;
```

_Note: The `auth.schema.ts` file will be generated by the Better Auth CLI in a subsequent step._

<br>

### 2. Initialize Drizzle ORM (`src/db/index.ts`)

Properly initialize Drizzle with your Cloudflare D1 binding. This function will provide a database client instance to your application, configured to use your D1 database.

```typescript
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export async function getDb() {
    // Retrieves Cloudflare-specific context, including environment variables and bindings
    const { env } = await getCloudflareContext({ async: true });

    // Initialize Drizzle with your D1 binding (e.g., "DB" or "DATABASE" from wrangler.toml)
    return drizzle(env.DATABASE, {
        // Ensure "DATABASE" matches your D1 binding name in wrangler.toml
        schema,
        logger: true, // Optional
    });
}
```

<br>

### 3. Configure Better Auth (`src/auth/index.ts`)

Set up your Better Auth configuration, wrapping it with `withCloudflare` to enable Cloudflare-specific features. This is where you'll define how Better Auth interacts with D1, KV, and other services.

```typescript
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { getDb } from "../db";

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb(); // Get your D1 database instance

    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                d1: {
                    db: dbInstance, // Provide the D1 database instance
                    options: {
                        usePlural: true, // Optional: Use plural table names (e.g., "users" instead of "user")
                        debugLogs: true, // Optional
                    },
                },
                // Optionally, configure KV for session storage or other secondary storage purposes
                // Make sure "KV" is the binding in your wrangler.toml
                kv: process.env.KV as KVNamespace<string>,
            },
            // Your core Better Auth configuration (see Better Auth docs for all options)
            {
                socialProviders: {
                    github: {
                        // Example: GitHub social login
                        clientId: process.env.GITHUB_CLIENT_ID!,
                        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                    },
                    // Add other social providers as needed
                },
                rateLimit: {
                    enabled: true,
                    // ... other rate limiting options
                },
                // ... other Better Auth options
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

/* ======================================================================= */
/* Configuration for Schema Generation                                     */
/* ======================================================================= */

// This simplified configuration is used by the Better Auth CLI for schema generation.
// It includes only the options that affect the database schema.
// It's necessary because the main `authBuilder` performs operations (like `getDb()`)
// which use `getCloudflareContext` (not available in a CLI context only on Cloudflare).
// For more details, see: https://www.answeroverflow.com/m/1362463260636479488
export const auth = betterAuth({
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            // No actual database or KV instance is needed here, only schema-affecting options
        },
        {
            // Include only configurations that influence the Drizzle schema,
            // e.g., if certain features add tables or columns.
            // socialProviders: { /* ... */ } // If they add specific tables/columns
        }
    ),

    // Used by the Better Auth CLI for schema generation.
    database: drizzleAdapter(process.env.DATABASE, {
        provider: "sqlite",
        usePlural: true,
        debugLogs: true,
    }),
});
```

### 4. Generate and Manage Auth Schema with D1

Better Auth uses Drizzle ORM for database interactions, allowing for automatic schema management for your D1 database.

To generate or update your authentication-related database schema, run the Better Auth CLI:

```bash
npx @better-auth/cli@latest generate
```

This command inspects your `src/auth/index.ts` (specifically the `auth` export) and creates/updates `src/db/auth.schema.ts` with the necessary Drizzle schema definitions for tables like users, sessions, accounts, etc.

**Recommended Usage:**

Specify your configuration file and output path for more precise control:

```bash
npx @better-auth/cli@latest generate --config src/auth/index.ts --output src/db/auth.schema.ts -y
```

This command will:

- Read the `export const auth` configuration from `src/auth/index.ts`.
- Output the generated Drizzle schema to `src/db/auth.schema.ts`.
- Automatically confirm prompts (`-y`).

After generation, you can use Drizzle Kit to create and apply migrations to your D1 database. Refer to the [Drizzle ORM documentation](https://orm.drizzle.team/kit/overview) for managing migrations.

For integrating the generated `auth.schema.ts` with your existing Drizzle schema, see [managing schema across multiple files](https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-multiple-files). More details on schema generation are available in the [Better Auth docs](https://www.better-auth.com/docs/adapters/drizzle#schema-generation--migration).

### 5. Configure KV as Secondary Storage (Optional)

If you provide a KV namespace in the `withCloudflare` configuration (as shown in `src/auth/index.ts`), it will be used as [Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage) by Better Auth. This is typically used for caching or storing session data that doesn't need to reside in your primary D1 database.

Ensure your KV namespace (e.g., `USER_SESSIONS`) is correctly bound in your `wrangler.toml` file.

### 6. Set Up API Routes

Create API routes to handle authentication requests. Better Auth provides a handler that can be used for various HTTP methods.

```typescript
// Example: src/app/api/auth/[...all]/route.ts
// Adjust the path based on your project structure (e.g., Next.js App Router)

import { initAuth } from "@/auth"; // Adjust path to your auth/index.ts

export async function POST(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}

export async function GET(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}

// You can also add handlers for PUT, DELETE, PATCH if needed by your auth flows
```

### 7. Initialize the Client

Set up the Better Auth client, including the Cloudflare plugin, to interact with authentication features on the front-end.

```typescript
// Example: src/lib/authClient.ts or similar client-side setup file

import { createAuthClient } from "better-auth/client";
import { cloudflareClient } from "better-auth-cloudflare/client";

const authClient = createAuthClient({
    // baseURL: "/api/auth", // Optional: Uncomment and adjust if your auth API routes are not at /api/auth
    plugins: [cloudflareClient()], // Add the Cloudflare client plugin for geolocation features
});

export default authClient;
```

## Usage Examples

### Accessing Geolocation Data

This library enables access to Cloudflare's geolocation data both on the client and server-side.

**Client-side API:**
Use the `authClient` to fetch geolocation information.

```typescript
import authClient from "@/lib/authClient"; // Adjust path to your client setup

const displayLocationInfo = async () => {
    try {
        const { data, error } = await authClient.cloudflare.getGeolocation();
        if (error) {
            console.error("Error fetching geolocation:", error);
            return;
        }
        if (data) {
            console.log(`Detected location: ${data.city}, ${data.country}`);
            console.log(`Timezone: ${data.timezone}`);
            console.log(`Region: ${data.region} (${data.regionCode})`);
            console.log(`Coordinates: ${data.latitude}, ${data.longitude}`);
        }
    } catch (err) {
        console.error("Failed to get geolocation data:", err);
    }
};

displayLocationInfo();
```

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
