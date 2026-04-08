# Configuration Reference

## `withCloudflare(cloudflareOptions, authOptions)`

Wraps your Better Auth config with Cloudflare integrations. The result is spread into `betterAuth()`:

```typescript
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

const auth = betterAuth({
    ...withCloudflare(
        {
            /* WithCloudflareOptions */
        },
        {
            /* BetterAuthOptions */
        }
    ),
});
```

> **Do not** add `cloudflare()` to your `plugins` array when using `withCloudflare` — it is injected automatically. Adding it manually results in a duplicate plugin.

### Override Behavior

`withCloudflare` returns a merged config object. The following keys are **always set** by the wrapper and take precedence over values in `authOptions`:

| Key                | Behavior                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`         | Set from your `d1` / `d1Native` / `postgres` / `mysql` option. Omit `database` from `authOptions`.                                                          |
| `secondaryStorage` | Set to `createKVStorage(kv)` when `kv` is provided, otherwise `undefined`. Omit from `authOptions`.                                                         |
| `plugins`          | The `cloudflare()` plugin is prepended to your `authOptions.plugins` array.                                                                                 |
| `advanced`         | Merges your `authOptions.advanced` with IP detection headers when `autoDetectIpAddress` is enabled.                                                         |
| `session`          | Merges your `authOptions.session`, forcing `storeSessionInDatabase: true` when `geolocationTracking` is enabled — even if you explicitly set it to `false`. |

If you need a custom `secondaryStorage` that is not KV, omit the `kv` option and set `secondaryStorage` outside the spread:

```typescript
const auth = betterAuth({
    ...withCloudflare(cloudflareOpts, authOpts),
    secondaryStorage: myCustomStorage,
});
```

---

## `WithCloudflareOptions`

Extends [`CloudflarePluginOptions`](#cloudflarepluginoptions) with database and KV configuration.

### Database Options

Only **one** database option may be provided — passing more than one throws at startup. All are optional; omitting them all is valid for CLI schema generation (`database` will be `undefined`).

| Option     | Type                                    | Description                                                          |
| ---------- | --------------------------------------- | -------------------------------------------------------------------- |
| `d1`       | `DrizzleConfig<typeof d1Drizzle>`       | D1 via Drizzle ORM                                                   |
| `d1Native` | `D1Database`                            | Native D1 binding (no Drizzle, uses better-auth's Kysely D1 dialect) |
| `postgres` | `DrizzleConfig<typeof postgresDrizzle>` | Postgres via Hyperdrive + Drizzle                                    |
| `mysql`    | `DrizzleConfig<typeof mysqlDrizzle>`    | MySQL via Hyperdrive + Drizzle                                       |

### KV Option

| Option | Type          | Description                                                                                                                   |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `kv`   | `KVNamespace` | KV namespace for [secondary storage](#kv-secondary-storage). Automatically wired as `secondaryStorage` via `createKVStorage`. |

### `DrizzleConfig<T>`

```typescript
type DrizzleConfig<T> = {
    db: ReturnType<T>;
    options?: Omit<DrizzleAdapterConfig, "provider">;
};
```

The `provider` is inferred from which option you use (`"sqlite"` / `"pg"` / `"mysql"`). Common adapter options: `usePlural`, `debugLogs`.

---

## `CloudflarePluginOptions`

Inherited by `WithCloudflareOptions`.

| Option                | Type                                          | Default     | Description                                                                                                                   |
| --------------------- | --------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `autoDetectIpAddress` | `boolean`                                     | `true`      | Adds `cf-connecting-ip` and `x-real-ip` to IP detection headers.                                                              |
| `geolocationTracking` | `boolean`                                     | `true`      | Enriches sessions with geolocation fields. Overrides `session.storeSessionInDatabase` to `true`.                              |
| `cf`                  | `CloudflareGeolocation \| Promise<…> \| null` | `undefined` | **Required** unless both options above are disabled. Typically `request.cf` (Hono) or `getCloudflareContext().cf` (OpenNext). |
| `r2`                  | `R2Config`                                    | `undefined` | R2 bucket configuration. See the [R2 File Storage Guide](./r2.md).                                                            |

### `CloudflareGeolocation`

When `geolocationTracking` is enabled, these optional `string` fields are added to the `session` table and populated on session creation from `cf`:

```typescript
interface CloudflareGeolocation {
    timezone?: string | null;
    city?: string | null;
    country?: string | null;
    region?: string | null;
    regionCode?: string | null;
    colo?: string | null;
    latitude?: string | null;
    longitude?: string | null;
}
```

This is the subset of Cloudflare's `IncomingRequestCfProperties` that the library extracts. You can pass the full `request.cf` object — only these fields are read.

---

## KV Secondary Storage

Passing `kv` to `withCloudflare` enables [Better Auth Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage) backed by Cloudflare KV — used for rate limiting, session caching, and verification tokens.

```typescript
withCloudflare(
    {
        d1: { db, options: { usePlural: true } },
        kv: env.KV,
        cf: request.cf,
    },
    {
        rateLimit: { enabled: true, window: 60, max: 100 },
    }
);
```

### `createKVStorage(kv)`

If you need to wire secondary storage manually (without `withCloudflare`):

```typescript
import { createKVStorage, cloudflare } from "better-auth-cloudflare";

const auth = betterAuth({
    database: myDatabase,
    secondaryStorage: createKVStorage(env.KV),
    plugins: [cloudflare({ cf: request.cf })],
});
```

> **Note:** The standalone `cloudflare()` plugin does **not** throw when `cf` is missing — the geolocation endpoint returns a 404 instead. `withCloudflare` is stricter and throws at startup if `cf` is omitted while `autoDetectIpAddress` or `geolocationTracking` is enabled.

### KV TTL Limitation

Cloudflare KV enforces a **minimum TTL of 60 seconds**. `createKVStorage` clamps lower values automatically and logs a warning. Configure rate limit `window` accordingly:

```typescript
rateLimit: {
    enabled: true,
    window: 60, // Must be >= 60 when using KV
    max: 100,
},
```

Better Auth's built-in sign-in endpoints have their own default rate limit windows that may be lower than 60s, which causes KV write errors. Override them explicitly ([better-auth#5452](https://github.com/better-auth/better-auth/issues/5452)):

```typescript
rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-in/social": { window: 60, max: 5 },
    },
},
```

---

## Database Examples

### D1 with Drizzle

```typescript
import { drizzle } from "drizzle-orm/d1";

const db = drizzle(env.DATABASE, { schema });

withCloudflare(
    { d1: { db, options: { usePlural: true } }, cf: request.cf },
    {
        /* auth options */
    }
);
```

### Native D1 (No Drizzle)

```typescript
withCloudflare(
    { d1Native: env.DATABASE, cf: request.cf },
    {
        /* auth options */
    }
);
```

|                   | `d1Native`                   | `d1` (Drizzle)            |
| ----------------- | ---------------------------- | ------------------------- |
| Bundle size       | Smaller                      | Larger (includes Drizzle) |
| Schema management | Manual SQL / better-auth CLI | Drizzle Kit migrations    |
| Type-safe queries | No                           | Yes                       |

### Hyperdrive (Postgres)

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

const db = drizzle(postgres(env.HYPERDRIVE.connectionString), { schema });

withCloudflare(
    { postgres: { db }, cf: request.cf },
    {
        /* auth options */
    }
);
```

### Hyperdrive (MySQL)

```typescript
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const db = drizzle(mysql.createPool(env.HYPERDRIVE.connectionString), { schema });

withCloudflare(
    { mysql: { db }, cf: request.cf },
    {
        /* auth options */
    }
);
```

---

## `wrangler.toml` Reference

Complete example with all supported binding types. Include only what you need.

```toml
name = "my-auth-app"
main = "src/index.ts"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat"]

[observability]
enabled = true

[placement]
mode = "smart"

# D1 — Create with: wrangler d1 create my-auth-db
[[d1_databases]]
binding = "DATABASE"
database_name = "my-auth-db"
database_id = "<your-database-id>"
migrations_dir = "drizzle"

# KV — Create with: wrangler kv namespace create KV
[[kv_namespaces]]
binding = "KV"
id = "<your-kv-namespace-id>"

# R2 (optional) — Create with: wrangler r2 bucket create my-files
[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "my-files"

# Hyperdrive (optional) — Create with: wrangler hyperdrive create my-hd --connection-string="..."
# [[hyperdrive]]
# binding = "HYPERDRIVE"
# id = "<your-hyperdrive-id>"

[vars]
BETTER_AUTH_URL = "https://your-app.example.com"
BETTER_AUTH_TRUSTED_ORIGINS = "https://your-app.example.com"
```

### Binding Names and `env.d.ts`

The `binding` value in `wrangler.toml` determines the property name on `env`. Declare them for type safety:

```typescript
import type { D1Database, Hyperdrive, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace;
    R2_BUCKET: R2Bucket;
    HYPERDRIVE: Hyperdrive; // Only if using Hyperdrive
    BETTER_AUTH_URL: string;
    BETTER_AUTH_TRUSTED_ORIGINS: string;
}
```

These names are configurable — if you change `binding = "KV"` to `binding = "AUTH_KV"` in `wrangler.toml`, update `env.d.ts` and your auth config to match. The [CLI](../cli/README.md) supports `--kv-binding`, `--d1-binding`, and `--r2-binding` flags for this.

---

## Commonly Used Exports

The main entry point (`better-auth-cloudflare`) re-exports all types and functions from the library. Commonly used:

| Export                      | Kind     | Description                                                                      |
| --------------------------- | -------- | -------------------------------------------------------------------------------- |
| `withCloudflare`            | function | Wraps `BetterAuthOptions` with Cloudflare integrations (database, KV, plugin).   |
| `cloudflare`                | function | Standalone Better Auth plugin for geolocation, IP detection, and R2.             |
| `createKVStorage`           | function | Creates a `SecondaryStorage` backed by Cloudflare KV.                            |
| `createR2Config`            | function | Helper for creating a fully type-inferred `R2Config`.                            |
| `CloudflareGeolocation`     | type     | The 8 geolocation fields extracted from `request.cf`.                            |
| `CloudflareSession`         | type     | `Session` extended with geolocation fields.                                      |
| `CloudflareSessionResponse` | type     | `{ session: CloudflareSession; user: User }` — shape of `/api/auth/get-session`. |
| `CloudflarePluginOptions`   | type     | Options for the standalone `cloudflare()` plugin.                                |
| `WithCloudflareOptions`     | type     | Options for the `withCloudflare` wrapper.                                        |
| `R2Config`                  | type     | R2 bucket configuration. See the [R2 File Storage Guide](./r2.md).               |
| `FileMetadata`              | type     | Core file record shape stored in the database.                                   |
