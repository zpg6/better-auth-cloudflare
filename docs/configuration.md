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

| Option                  | Type          | Description                                                                                                                              |
| ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `kv`                    | `KVNamespace` | KV namespace for [secondary storage](#kv-secondary-storage). Automatically wired as `secondaryStorage` via `createKVStorage`.            |
| `kvAtomicCompatibility` | `true`        | Validates that Better Auth 1.7 verification and rate limiting are explicitly routed to supported storage. Does not change those options. |

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
        kvAtomicCompatibility: true,
        cf: request.cf,
    },
    {
        verification: { storeInDatabase: true },
        rateLimit: { enabled: true, storage: "database" },
    }
);
```

Better Auth 1.7 requires atomic `getAndDelete` and `increment` operations. Workers KV cannot provide them. The configuration above keeps KV session caching but routes verification consumption and rate limiting to the database explicitly.

`kvAtomicCompatibility: true` validates the required routing at startup. It never selects database or memory storage automatically.

This is a cost and latency choice, not a transparent compatibility shim. Database rate limiting typically adds at least one database read and one write to accepted Better Auth requests. Contention, resets, cleanup, and rejected requests can add operations. You can instead provide an atomic `rateLimit.customStorage.consume` implementation backed by a strongly consistent service such as Redis or Durable Objects. `storage: "memory"` is suitable for development, but Worker isolates do not share counters.

Database-backed rate limiting requires Better Auth's rate-limit table. Generate the schema with the same 1.7 `auth` package version you deploy. For a populated 1.6 database, follow the migration process below instead of applying a plain generated schema.

### `createKVStorage(kv)`

`createKVStorage()` exposes the `get`, `set`, and `delete` operations Workers KV can actually provide. It intentionally does not claim Better Auth 1.7's full `SecondaryStorage` contract. For Better Auth 1.7, use `withCloudflare()` as shown above. Manual wiring remains available for Better Auth 1.5 and 1.6:

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

### Upgrading a populated database to Better Auth 1.7

Better Auth 1.7 also changes account identity fields. Do not apply a plain generated Drizzle schema over a populated 1.6 account table. Pin `better-auth`, `auth`, and every `@better-auth/*` package to the same 1.7 release, set the account identity strategy required by your migration, then run `auth migrate plan` and rehearse `auth migrate apply` against a restored backup. Follow the [Better Auth 1.7 migration guide](https://better-auth.com/docs/guides/1-7-upgrade-guide) before upgrading production data.

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
