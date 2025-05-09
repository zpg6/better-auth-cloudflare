# better-auth-cloudflare

[![NPM Version](https://img.shields.io/npm/v/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![NPM Downloads](https://img.shields.io/npm/dt/better-auth-cloudflare)](https://www.npmjs.com/package/better-auth-cloudflare)
[![License: MIT](https://img.shields.io/npm/l/better-auth-cloudflare)](https://opensource.org/licenses/MIT)

This plugin makes it easy to integrate [Better Auth](https://github.com/better-auth/better-auth) with Cloudflare Workers and other Cloudflare services. For now, this focuses OpenNext for connecting context to Cloudflare Workers and Drizzle for connecting to D1 Database.

## Features

- 🗄️ **D1 integration** - Seamlessly use Cloudflare D1 as the primary database for Better Auth
- 🔌 **KV integration** - Easily use Cloudflare KV for Better Auth Secondary Storage
- 🔍 **IP detection** - Extract from Cloudflare headers for IP tracking features like rate limiting
- 📍 **Rich geolocation context data** - Access timezone, country, city, and other Cloudflare request context
- 🌐 **Automatic geolocation** - Track user location data with multiple storage options

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

| Option                          | Type    | Default   | Description                                                                                                                 |
| ------------------------------- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `autoDetectIpAddress`           | boolean | `true`    | Auto-detect IP address from Cloudflare headers                                                                              |
| `enableUserGeolocationTracking` | string  | undefined | How to store geolocation data (`"user_table"`, `"session_table"`, `"geolocation_table"`, or `"kv"`). By default not stored. |

#### Geolocation Tracking Options

This plugin supports four different ways to track user geolocation:

1. **User Table** (`user_table`): Stores all geolocation data directly in the user table
2. **Session Table** (`session_table`): Stores geolocation data in the session table
3. **Geolocation Table** (`geolocation_table`): Creates a separate table for geolocation data
4. **KV Storage** (`kv`): Lightweight option that stores only IP address in KV storage

Geolocation is updated when new sessions are created.

## Setup

### Server

```typescript
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

const auth = betterAuth(
    withCloudflare(
        // Cloudflare-specific options
        {
            autoDetectIpAddress: true,
            enableUserGeolocationTracking: "user_table",
            kv: process.env.USER_SESSIONS as KVNamespace<string>,
            d1: process.env.DATABASE as D1Database,
            d1Options: {
                usePlural: true,
                debugLogs: true,
            },
        },
        // ... your Better Auth config
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
```

### D1 as Primary Database

D1 integrates with Better Auth through the Drizzle ORM adapter, providing automatic schema management for your authentication database. To generate or update your auth schema:

```bash
npx @better-auth/cli@latest generate
```

This command creates the necessary database tables based on your Better Auth configuration and enabled plugins. For integrating with your existing Drizzle schema, see [managing schema across multiple files](https://orm.drizzle.team/docs/sql-schema-declaration#schema-in-multiple-files) in the Drizzle documentation. More details on schema generation and migration are available in the [Better Auth docs](https://www.better-auth.com/docs/adapters/drizzle#schema-generation--migration).

### KV as Secondary Storage

If provided, your KV will be configured as [Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage).

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

    // Use timezone to display a local timestamp
    const localTime = new Intl.DateTimeFormat("en-US", {
        timeZone: data.timezone,
        dateStyle: "full",
        timeStyle: "long",
    }).format(new Date());
    console.log(`Local time: ${localTime}`);
    // Example: "Local time: Friday, May 9, 2025 at 7:06:30 PM EDT"
};

// Server-side direct access
import { getGeolocation } from "better-auth-cloudflare";

const locationData = getGeolocation();
console.log(locationData.country, locationData.city);
```

## License

[MIT](./LICENSE)

## Contributing

Contributions are welcome! Whether it's bug fixes, feature additions, or documentation improvements, we appreciate your help in making this project better.

Please feel free to:

- Open an issue to report bugs or suggest new features
- Submit a pull request with improvements
- Help improve the documentation

When submitting a pull request:

1. Fork the repository
2. Create a new branch for your changes
3. Add tests if applicable
4. Update documentation as needed
5. Submit the PR with a clear description of the changes

For major changes or new features, please open an issue first to discuss what you would like to change.
