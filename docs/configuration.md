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

`withCloudflare` returns a merged config object:

| Key                | Behavior                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database`         | Set from `d1` / `d1Native` / `postgres` / `mysql` when provided. Otherwise preserves `authOptions.database`.                                                |
| `secondaryStorage` | Set to `createKVStorage(kv)` when `kv` is provided. Otherwise preserves `authOptions.secondaryStorage`. Supplying both `kv` and a custom store throws.      |
| `plugins`          | The `cloudflare()` plugin is prepended to your `authOptions.plugins` array.                                                                                 |
| `advanced`         | Merges your `authOptions.advanced` with IP detection headers when `autoDetectIpAddress` is enabled.                                                         |
| `session`          | Merges your `authOptions.session`, forcing `storeSessionInDatabase: true` when `geolocationTracking` is enabled — even if you explicitly set it to `false`. |

If you need a custom `secondaryStorage` that is not KV, omit the `kv` option and pass it through `authOptions`:

```typescript
const auth = betterAuth({
    ...withCloudflare(cloudflareOpts, {
        ...authOpts,
        secondaryStorage: myCustomStorage,
    }),
});
```

---

## `WithCloudflareOptions`

Extends [`CloudflarePluginOptions`](#cloudflarepluginoptions) with database and KV configuration.

### Database Options

Only **one** database option may be provided. Passing more than one throws at startup. All are optional; when none is supplied, `authOptions.database` is preserved.

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

Passing `kv` to `withCloudflare` enables [Better Auth Secondary Storage](https://www.better-auth.com/docs/concepts/database#secondary-storage) backed by Cloudflare KV.

```typescript
withCloudflare(
    {
        d1: { db, options: { usePlural: true } },
        kv: env.KV,
        cf: request.cf,
    },
    {
        verification: { storeInDatabase: true },
        rateLimit: { enabled: true, storage: "database" },
    }
);
```

Better Auth 1.7 requires atomic `getAndDelete` and `increment` operations. Workers KV cannot provide them. The configuration above keeps KV session caching but routes verification consumption and rate limiting to the database explicitly.

`withCloudflare()` validates the required routing when Better Auth initializes. It never selects database or memory storage automatically.

This is a cost and latency choice, not a transparent compatibility shim. Database rate limiting typically adds at least one database read and one write to accepted Better Auth requests. Contention, resets, cleanup, and rejected requests can add operations. You can instead provide an atomic `rateLimit.customStorage.consume` implementation backed by a strongly consistent service such as Redis or Durable Objects. `storage: "memory"` is suitable for development, but Worker isolates do not share counters.

Database-backed rate limiting requires Better Auth's rate-limit table. Generate the schema with the same `auth` package version you deploy and apply it with your migration tooling. Better Auth 1.7.3 validates the Drizzle schema you pass against the tables it expects (`advanced.database.validateSchema`, on by default) and fails writes with `SchemaMismatchError` (logged as `Drizzle schema mismatch`) while they disagree, so regenerate `auth.schema.ts` whenever you change an option that adds a table.

### KV session consistency

Better Auth accepts a positive secondary-storage session without checking the mirrored database. Workers KV changes may take 60 seconds or more to appear in another location, so logout and other direct token revocations can lag.

Better Auth also updates each user's active-session list with separate secondary-storage reads and writes. Concurrent session changes can lose a token reference. Bulk revocation, role or ban changes, or user deletion may then miss that cached token until its original session expiry. A strongly consistent full secondary store removes KV propagation lag for direct token reads and deletes, but it does not make the active-session update atomic.

`session.storeSessionInDatabase: true` does not repair a stale positive hit. Strict bulk revocation and immediate user or authorization changes require omitting secondary session caching and leaving `session.cookieCache` disabled unless Better Auth adds an atomic active-list update.

### `createKVStorage(kv)`

`createKVStorage()` exposes the `get`, `set`, and `delete` operations Workers KV can provide. It does not claim Better Auth 1.7's full `SecondaryStorage` contract. For Better Auth 1.7, use `withCloudflare()` as shown above. Manual wiring remains available for Better Auth 1.5 and 1.6:

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

Workers KV enforces a **minimum physical TTL of 60 seconds**. `createKVStorage` clamps shorter TTLs to 60 seconds and logs a warning. Better Auth 1.5 and 1.6 rate limiting keeps its own timestamps, so a shorter logical window can still expire while the KV key remains stored. Do not weaken Better Auth's protected sign-in rules just to match KV's physical TTL. This limitation does not apply when Better Auth 1.7 uses database or custom rate-limit storage.

### Upgrading to Better Auth 1.7

Use Better Auth 1.7.3 or later, and pin `better-auth`, `auth`, and every `@better-auth/*` package to the same release. Releases 1.7.0 through 1.7.2 added a required `issuer` column to the account table and a unique index on `issuer` and `accountId`; 1.7.3 removed both, so the core account schema is unchanged from 1.6 and a populated 1.6 database needs no backfill. Check for duplicate `(providerId, accountId)` rows first; 1.7 rejects account lookups that match more than one row. Regenerate `auth.schema.ts` with the 1.7.3 CLI and apply the diff with your migration tooling: it adds the rate-limit table when `rateLimit.storage` is `"database"` and, with `usePlural`, renames relation keys from `users` to `user`, which affects your own `with:` queries.

If you already applied the 1.7.0–1.7.2 account schema, relax the `issuer` column and drop the index as described in the [upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-keeps-the-provider-key) before deploying 1.7.3. The rest of the [upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) still applies.

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

## Wrangler configuration reference

The `migrate` command searches the current directory and its parents for `wrangler.json`, then `wrangler.jsonc`, then `wrangler.toml`.

Complete example with all supported binding types. Include only what you need.

```toml
name = "my-auth-app"
main = "src/index.ts"
compatibility_date = "2025-04-01"
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

### Binding names and `env.d.ts`

Each `binding` becomes a property on `env`. Declare those properties in `env.d.ts` so TypeScript checks binding access:

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

If you change `binding = "KV"` to `binding = "AUTH_KV"` in your Wrangler config, update `env.d.ts` and the auth config. During project generation, use `--kv-binding`, `--d1-binding`, or `--r2-binding` to set these names.

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
