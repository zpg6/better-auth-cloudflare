# better-auth-cloudflare

Seamlessly integrate [Better Auth](https://github.com/better-auth/better-auth) with Cloudflare Workers, D1, Hyperdrive, KV, R2, and geolocation services.

[![NPM Version](https://img.shields.io/npm/v/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![NPM Downloads](https://img.shields.io/npm/dt/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![License: MIT](https://img.shields.io/npm/l/better-auth-cloudflare)](https://opensource.org/licenses/MIT)

**LIVE DEMOS**:

- **OpenNextJS**: [https://better-auth-cloudflare.zpg6.workers.dev](https://better-auth-cloudflare.zpg6.workers.dev/)
- **Hono**: [https://better-auth-cloudflare-hono.zpg6.workers.dev](https://better-auth-cloudflare-hono.zpg6.workers.dev/)

Demo implementations are available in the [`examples/`](./examples/) directory for **OpenNextJS ◆** and **Hono 🔥**, along with recommended scripts for generating database schema, migrating, and more. The library is compatible with any framework that runs on Cloudflare Workers.

## Features

- 🗄️ **Database Integration**: Support for D1 (SQLite), Postgres, and MySQL databases via Drizzle ORM, or native D1 without Drizzle.
- 🚀 **Hyperdrive Support**: Connect to Postgres and MySQL databases through Cloudflare Hyperdrive.
- 🔌 **KV Storage Integration**: Optionally use Cloudflare KV for secondary storage (e.g., session caching).
- 🔒 **Durable Object Storage**: Atomic secondary storage and distributed rate limiting for Better Auth 1.7.
- 📁 **R2 File Storage**: Upload, download, and manage user files with Cloudflare R2 object storage and database tracking.
- 📍 **Automatic Geolocation Tracking**: Enrich user sessions with location data derived from Cloudflare.
- 🌐 **Cloudflare IP Detection**: Utilize Cloudflare's IP detection headers out-of-the-box.
- 🔍 **Rich Client-Side Context**: Access timezone, city, country, region, and more via the client plugin.
- 📦 **CLI**: Tools for getting started quickly with Hono or Next.js, managing database schema, and more.

## Roadmap

- [x] IP Detection
- [x] Geolocation
- [x] D1
- [x] Hyperdrive (Postgres/MySQL)
- [x] KV
- [x] R2
- [ ] Cloudflare Email
- [ ] Cloudflare Images
- [x] Durable Objects
- [ ] D1 Multi-Tenancy

**CLI:**

- [x] `generate` - Create new projects from Hono/Next.js templates with automatic Cloudflare resource setup
- [ ] `integrate` - Add `better-auth-cloudflare` to existing projects, creating/updating auth and schema files
- [x] `migrate` - Update auth schema and run database migrations when configuration changes
- [ ] `plugin` - Generate empty Better Auth plugin for quickly adding typesafe endpoints and schema fields
- [x] `version` - Check the version of the CLI
- [x] `help` - Show all commands and their usage

**Examples:**

- [x] Hono
- [x] OpenNextJS
- [ ] SvelteKit (+ Hyperdrive)
- [ ] TanStack Start (+ Durable Objects)

## Table of Contents

- [Quick Start with CLI](#quick-start-with-cli)
- [Configuration Options](#configuration-options)
- [Manual Installation](#manual-installation)
- [Manual Setup](#manual-setup)
    - [1. Define Your Database Schema (`src/db/schema.ts`)](#1-define-your-database-schema-srcdbschemats)
    - [2. Initialize Drizzle ORM (`src/db/index.ts`)](#2-initialize-drizzle-orm-srcdbindexts)
    - [3. Configure Better Auth (`src/auth/index.ts`)](#3-configure-better-auth-srcauthindexts)
    - [4. Generate and Manage Auth Schema](#4-generate-and-manage-auth-schema)
    - [5. Configure KV as Secondary Storage (Optional)](#5-configure-kv-as-secondary-storage-optional)
        - [KV consistency and Better Auth 1.7](#kv-consistency-and-better-auth-17)
    - [6. Set Up API Routes](#6-set-up-api-routes)
    - [7. Initialize the Client](#7-initialize-the-client)
- [Usage Examples](#usage-examples)
    - [Accessing Geolocation Data](#accessing-geolocation-data)
- [R2 File Storage Guide](./docs/r2.md)
- [Configuration Reference](./docs/configuration.md)
- [License](#license)
- [Contributing](#contributing)

## Quick Start with CLI

⚡️ For the fastest setup, use the CLI to generate a complete project (including the resources on Cloudflare):

**Interactive mode** (asks questions and provides helpful defaults):

```bash
npx @better-auth-cloudflare/cli@latest generate
```

**Non-interactive mode** (use arguments):

```bash
# Simple D1 app with KV (fully deployed to Cloudflare)
npx @better-auth-cloudflare/cli@latest generate \
  --app-name=my-auth-app \
  --template=hono \
  --database=d1 \
  --kv=true \
  --r2=false \
  --apply-migrations=prod
```

**Migration workflow**:

```bash
npx @better-auth-cloudflare/cli@latest migrate                         # Interactive
npx @better-auth-cloudflare/cli@latest migrate --migrate-target=prod   # Non-interactive
```

The CLI creates projects from Hono or Next.js templates and can automatically set up D1, KV, R2, and Hyperdrive resources. See [CLI Documentation](./cli/README.md) for full documentation and all available arguments.

**Troubleshooting**:

If you encounter this error when using the CLI: `...Error [ERR_REQUIRE_ESM]: require() of ES Module...`, make sure your node version is at least `v23.0.0`, `v22.12.0`, or `v20.19.0`, depending on the major version you use. Read more [here](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require)

## Manual Installation

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

| Option                | Type               | Default     | Description                                                                                          |
| --------------------- | ------------------ | ----------- | ---------------------------------------------------------------------------------------------------- |
| `autoDetectIpAddress` | boolean            | `true`      | Auto-detect IP address from Cloudflare headers                                                       |
| `geolocationTracking` | boolean            | `true`      | Track geolocation data in the session table                                                          |
| `cf`                  | object or resolver | `undefined` | Request geolocation context; required unless IP detection and geolocation tracking are both disabled |
| `r2`                  | object             | `undefined` | R2 bucket configuration for file storage                                                             |

For the full `WithCloudflareOptions` interface (including database, KV, and Drizzle adapter options), see the [Configuration Reference](./docs/configuration.md).

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

Properly initialize Drizzle with your database. This function will provide a database client instance to your application. For D1, you'll use Cloudflare D1 bindings, while Postgres/MySQL will use Hyperdrive connection strings.

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

Keep runtime auth and schema generation separate. `src/auth/index.ts` reads Worker bindings and creates the runtime instance. `src/auth.config.ts` exports a static `auth` instance for the Better Auth CLI and must not read Worker bindings.

The [Hono runtime config](./examples/hono/src/auth/index.ts) and [static schema config](./examples/hono/src/auth.config.ts) are the complete D1 example. OpenNext uses the same split: [runtime](./examples/opennextjs/src/auth/index.ts) and [schema config](./examples/opennextjs/src/auth.config.ts).

The `baseURL` is derived per-request in Hono middleware via `new URL(c.req.url).origin`. On Cloudflare Workers, `request.url` reflects the actual URL the client connected to — Cloudflare's edge routes requests to your worker based on DNS and [route configuration](https://developers.cloudflare.com/workers/configuration/routing/routes/), not the HTTP `Host` header alone. Alternatively, you can set the `BETTER_AUTH_URL` environment variable and omit the `baseURL` parameter.

**For OpenNext.js with complex async requirements:**
See the [OpenNext.js example](./examples/opennextjs/README.md) for a more complex configuration that handles async database initialization and singleton patterns.

**Using Hyperdrive (MySQL):**

```typescript
import { drizzle } from "drizzle-orm/mysql2";
import { createConnection } from "mysql2/promise";

async function getDb() {
    const { env } = await getCloudflareContext({ async: true });
    const connection = await createConnection({
        host: env.HYPERDRIVE.host,
        user: env.HYPERDRIVE.user,
        password: env.HYPERDRIVE.password,
        database: env.HYPERDRIVE.database,
        port: env.HYPERDRIVE.port,
        disableEval: true,
    });
    return drizzle(connection, { schema });
}

const auth = betterAuth({
    ...withCloudflare(
        {
            mysql: {
                db: await getDb(),
            },
            // other cloudflare options...
        },
        {
            // your auth options...
        }
    ),
});
```

**Using Hyperdrive (Postgres):**

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function getDb() {
    const { env } = await getCloudflareContext({ async: true });
    const sql = postgres(env.HYPERDRIVE.connectionString, {
        max: 5,
        fetch_types: false,
        prepare: true,
    });
    return drizzle(sql, { schema });
}

const auth = betterAuth({
    ...withCloudflare(
        {
            postgres: {
                db: await getDb(),
            },
            // other cloudflare options...
        },
        {
            // your auth options...
        }
    ),
});
```

**Using Native D1 (no Drizzle required):**

If you don't need Drizzle ORM's type-safe schema and migration tooling, you can pass a D1 binding directly. better-auth uses its built-in Kysely D1 dialect under the hood:

```typescript
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

const auth = betterAuth({
    ...withCloudflare(
        {
            d1Native: env.DATABASE,
            kv: env.KV,
            cf: request.cf,
        },
        {
            verification: { storeInDatabase: true },
            rateLimit: { storage: "database" },
        }
    ),
});
```

This path does **not** require `@better-auth/drizzle-adapter` at all. Trade-offs vs. the Drizzle D1 option:

|                   | `d1Native`                   | `d1` (Drizzle)            |
| ----------------- | ---------------------------- | ------------------------- |
| Bundle size       | Smaller                      | Larger (includes Drizzle) |
| Schema management | Manual SQL / better-auth CLI | Drizzle Kit migrations    |
| Type-safe queries | No                           | Yes                       |
| Setup complexity  | Simpler                      | More boilerplate          |

**Using `better-auth/minimal` for smaller bundles:**

better-auth v1.5+ provides a `better-auth/minimal` entry point that tree-shakes unused features for smaller Worker bundles:

```typescript
import { betterAuth } from "better-auth/minimal";
import { withCloudflare } from "better-auth-cloudflare";
```

This works as a drop-in replacement for `betterAuth` from `"better-auth"` but excludes features you haven't explicitly imported (e.g., social providers, admin endpoints).

### 4. Generate and Manage Auth Schema

Better Auth uses Drizzle ORM for database interactions, allowing for automatic schema management for your database (D1/SQLite, Postgres, or MySQL).

Install `auth` as a devDependency at the same version as `better-auth`, then:

```bash
npx auth generate --config src/auth.config.ts --output src/db/auth.schema.ts -y
```

Keep schema generation in a static config that does not read Worker bindings. Runtime auth can stay in `src/auth/index.ts`. Drizzle Kit can then generate and apply the database migration.

For integrating the generated `auth.schema.ts` with your existing Drizzle schema, see [managing schema across multiple files](https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-multiple-files). More details on schema generation are available in the [Better Auth docs](https://www.better-auth.com/docs/adapters/drizzle#schema-generation--migration).

### 5. Configure KV as Secondary Storage (Optional)

If you provide a KV namespace in the `withCloudflare` configuration (`kv: env.KV`), it will be used as [Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage) by Better Auth. This is typically used for caching or storing session data that doesn't need to reside in your primary database.

Ensure your KV namespace (e.g., `USER_SESSIONS`) is correctly bound in your `wrangler.toml` file.

#### KV consistency and Better Auth 1.7

Workers KV is eventually consistent and cannot implement Better Auth 1.7's atomic verification and rate-limit operations. Route those operations to a database, Durable Object, or another atomic store. Each choice changes request latency and storage costs. See [configuration](./docs/configuration.md#kv-secondary-storage) and [Durable Object storage](./docs/durable-object-storage.md) before enabling KV session caching.

#### Important: KV TTL Limitation

Workers KV has a minimum physical TTL of 60 seconds. `createKVStorage()` clamps shorter TTLs to 60 seconds and logs a warning. Better Auth 1.5 and 1.6 rate limiting keeps its own timestamps, so a shorter logical window can still expire while the KV key remains stored. Do not weaken Better Auth's protected sign-in rules just to match KV's physical TTL.

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
    plugins: [cloudflareClient()], // includes geolocation and R2 file features (if configured)
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
        const result = await authClient.cloudflare.geolocation();
        if (result.error) {
            console.error("Error fetching geolocation:", result.error);
        } else if (result.data && !("error" in result.data)) {
            console.log("📍 Geolocation data:", {
                timezone: result.data.timezone,
                city: result.data.city,
                country: result.data.country,
                region: result.data.region,
                regionCode: result.data.regionCode,
                colo: result.data.colo,
                latitude: result.data.latitude,
                longitude: result.data.longitude,
            });
        }
    } catch (err) {
        console.error("Failed to get geolocation data:", err);
    }
};

displayLocationInfo();
```

### R2 File Storage

If you've configured R2 in your server setup, you can upload and manage files:

```typescript
import authClient from "@/lib/authClient";

// Upload a file with metadata
const uploadFile = async (file: File) => {
    const result = await authClient.uploadFile(file, {
        category: "documents",
        isPublic: false,
        description: "Important document",
    });

    if (result.error) {
        console.error("Upload failed:", result.error.message || "Failed to upload file. Please try again.");
    } else {
        console.log("File uploaded:", result.data);
    }
};

// List user's files
const listFiles = async () => {
    const result = await authClient.files.list();
    if (result.data) {
        console.log("User files:", result.data);
    }
};

// Download a file
const downloadFile = async (fileId: string, filename: string) => {
    const result = await authClient.files.download({ fileId });
    if (result.error) {
        console.error("Download failed:", result.error);
        return;
    }

    // Extract blob and create download
    const response = result.data;
    const blob = response instanceof Response ? await response.blob() : response;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
};
```

For complete R2 file storage documentation, see the [R2 File Storage Guide](./docs/r2.md).

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
