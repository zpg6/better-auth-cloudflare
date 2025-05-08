# Better Auth Cloudflare Plugin

This plugin makes it easy to integrate [Better Auth](https://github.com/better-auth/better-auth) with Cloudflare Workers and other Cloudflare services.

## Features

- 🔌 **Easy KV integration** - Use Cloudflare KV for Better Auth Secondary Storage
- 🌐 **Automatic geolocation** - Track user location data with multiple storage options
- 🔍 **IP detection** - Automatically extract client IP from Cloudflare headers for the IP tracking features (like rate limiting)
- 📍 **Rich geolocation context data** - Access timezone, country, city, and other Cloudflare request context
- 🛠️ **Flexible storage options** - Store geolocation in user table, session table, separate table, or KV

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

## Setup

### Server

```typescript
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

const auth = betterAuth(
    withCloudflare(
        {
            autoDetectIpAddress: true,
            enableUserGeolocationTracking: "user_table",
            kv: env.USER_SESSIONS,
        },
        {
            // ... your Better Auth config
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
    // Example: "Local time: Thursday, May 23, 2024 at 2:45:30 PM Pacific Daylight Time"
};

// Server-side direct access
import { getGeolocation } from "better-auth-cloudflare";

const locationData = getGeolocation();
console.log(locationData.country, locationData.city);
```

## Configuration Options

| Option                          | Type    | Default   | Description                                                                                                                 |
| ------------------------------- | ------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `autoDetectIpAddress`           | boolean | `true`    | Auto-detect IP address from Cloudflare headers                                                                              |
| `enableUserGeolocationTracking` | string  | undefined | How to store geolocation data (`"user_table"`, `"session_table"`, `"geolocation_table"`, or `"kv"`). By default not stored. |

## Geolocation Tracking Options

This plugin supports four different ways to track user geolocation:

1. **User Table** (`user_table`): Stores all geolocation data directly in the user table
2. **Session Table** (`session_table`): Stores geolocation data in the session table
3. **Geolocation Table** (`geolocation_table`): Creates a separate table for geolocation data
4. **KV Storage** (`kv`): Lightweight option that stores only IP address in KV storage

Be sure to run `@better-auth/cli generate` to regenerate the auth schema. The [Better Auth CLI](https://www.better-auth.com/docs/adapters/drizzle#schema-generation--migration) allows you to generate or migrate your database schema based on your Better Auth configuration and plugins.

## License

MIT
