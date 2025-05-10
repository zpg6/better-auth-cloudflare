# better-auth-cloudflare

[![NPM Version](https://img.shields.io/npm/v/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![NPM Downloads](https://img.shields.io/npm/dt/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![License: MIT](https://img.shields.io/npm/l/better-auth-cloudflare)](https://opensource.org/licenses/MIT)

This plugin makes it easy to integrate [Better Auth](https://github.com/better-auth/better-auth) with Cloudflare Workers and other Cloudflare services. It provides seamless integration with Cloudflare's D1 database, KV storage, and geolocation features.

## Features

- 🗄️ **D1 Database Integration** - Use Cloudflare D1 as your primary database through Drizzle ORM
- 🔌 **KV Storage** - Configure Cloudflare KV as secondary storage
- 📍 **Geolocation Tracking** - Automatically track user location data in sessions
- 🌐 **IP Detection** - Built-in support for Cloudflare's IP detection headers
- 🔍 **Rich Context Data** - Access timezone, city, country, region, and more from Cloudflare's request context on client

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

### Server

```typescript
// src/db/schema.ts

import * as authSchema from "./auth.schema";

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    // ... more
} as const;
```

<br>

```typescript
// src/db/index.ts
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export async function getDb() {
    const { env } = await getCloudflareContext({ async: true });

    // Where "DATABASE" is my binding in my wrangler.toml file
    return drizzle(env.DATABASE, {
        schema,
        logger: true,
    });
}
```

<br>

```typescript
// src/auth/index.ts
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { getDb } from "../db";

async function authBuilder() {
    return betterAuth(
        withCloudflare(
            // Cloudflare-specific options
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                d1: {
                    db: await getDb(),
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },
                kv: process.env.USER_SESSIONS as KVNamespace<string>,
            },
            // Your Better Auth config
            {
                socialProviders: {
                    github: {
                        clientId: process.env.GITHUB_CLIENT_ID!,
                        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                    },
                },
                rateLimit: {
                    enabled: true,
                    //...other options
                },
            }
        )
    );
}

// Shared instance
let authInstance: ReturnType<typeof authBuilder> | null = null;

// Use this to retrieve the shared instance
export async function initAuth() {
    if (!authInstance) {
        authInstance = authBuilder();
    }
    return authInstance;
}

/* ======================================================================= */

// Used by the generator, not for production use
const auth = betterAuth(
    withCloudflare(
        // Cloudflare-specific options
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            // no database/kv
        },
        // Your Better Auth config
        {
            // ... just what affects the schema
        }
    )
);
```

### D1 as Primary Database

D1 integrates with Better Auth through the Drizzle ORM adapter, providing automatic schema management for your authentication database. To generate or update your auth schema:

```bash
npx @better-auth/cli@latest generate
```

This command creates the necessary database tables based on your Better Auth configuration and enabled plugins. For integrating with your existing Drizzle schema, see [managing schema across multiple files](https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-multiple-files) in the Drizzle documentation. More details on schema generation and migration are available in the [Better Auth docs](https://www.better-auth.com/docs/adapters/drizzle#schema-generation--migration).

I like to run it as:

```bash
npx @better-auth/cli@latest generate --config src/auth/index.ts --output src/db/auth.schema.ts -y
```

### KV as Secondary Storage

If provided, your KV will be configured as [Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage).

### Routes

```typescript
// src/app/api/auth/[...all]/route.ts

import { initAuth } from "@/auth";

export async function POST(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}

export async function GET(req: Request) {
    const auth = await initAuth();
    return auth.handler(req);
}
```

### Client

```typescript
import { createAuthClient } from "better-auth/client";
import { cloudflareClient } from "better-auth-cloudflare/client";

const authClient = createAuthClient({
    plugins: [cloudflareClient()],
});
```

## Usage Examples

### Accessing Geolocation Data

```typescript
// Client-side geolocation API
const getLocationInfo = async () => {
    const { data } = await authClient.cloudflare.getGeolocation();
    console.log(`Detected location: ${data.city}, ${data.country}`);
    console.log(`Timezone: ${data.timezone}`);
    console.log(`Region: ${data.region} (${data.regionCode})`);
    console.log(`Coordinates: ${data.latitude}, ${data.longitude}`);
};

// Server-side direct access
import { getGeolocation } from "better-auth-cloudflare";

const locationData = getGeolocation();
console.log(locationData.country, locationData.city);
```

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better. For major changes or new features, please open an issue first to discuss what you would like to change.
