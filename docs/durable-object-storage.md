# Durable Object storage

Better Auth 1.7 requires atomic storage for one-time verification values and distributed rate limits. `BetterAuthDurableObject` provides those operations on Cloudflare.

## Configure the binding

Re-export the class from your Worker entry:

```typescript
export { BetterAuthDurableObject } from "better-auth-cloudflare/durable-object";
```

Add the binding and class export to `wrangler.jsonc`:

```jsonc
{
    "durable_objects": {
        "bindings": [
            {
                "name": "BETTER_AUTH_STORAGE",
                "class_name": "BetterAuthDurableObject",
            },
        ],
    },
    "exports": {
        "BetterAuthDurableObject": {
            "type": "durable-object",
            "storage": "sqlite",
        },
    },
}
```

Add the binding to your environment type:

```typescript
interface CloudflareBindings {
    BETTER_AUTH_STORAGE: DurableObjectNamespace;
}
```

## Use it as secondary storage

This replaces Workers KV for sessions, verification values, and rate-limit counters:

```typescript
import { createDurableObjectStorage, withCloudflare } from "better-auth-cloudflare";

const secondaryStorage = createDurableObjectStorage(env.BETTER_AUTH_STORAGE);

const options = withCloudflare(
    {
        d1: { db },
        cf: request.cf,
    },
    {
        secondaryStorage,
        verification: {
            storeInDatabase: false,
        },
        rateLimit: {
            storage: "secondary-storage",
        },
    }
);
```

The adapter implements `getAndDelete` and `increment`, so `withCloudflare()` accepts it under Better Auth 1.7.

## Keep KV for sessions

Use the rate-limit adapter when you want KV session caching without sending every rate-limit operation to D1:

```typescript
import { createDurableObjectRateLimitStorage, withCloudflare } from "better-auth-cloudflare";

const options = withCloudflare(
    {
        d1: { db },
        kv: env.KV,
        cf: request.cf,
    },
    {
        verification: {
            storeInDatabase: true,
        },
        rateLimit: {
            customStorage: createDurableObjectRateLimitStorage(env.BETTER_AUTH_STORAGE),
        },
    }
);
```

This configuration uses D1 for verification values, Durable Objects for rate limiting, and KV for session caching. The rate limiter makes one Durable Object request per client-initiated Better Auth request while rate limiting is enabled.

## Object mapping and cost

Each adapter creates one Durable Object per storage key. The full secondary adapter and custom rate-limit adapter use separate object-name domains. They hash the key with SHA-256 before deriving the object name. Operations on unrelated keys do not share an object, while every operation on one key stays serialized.

You can set an object-name prefix:

```typescript
createDurableObjectStorage(env.BETTER_AUTH_STORAGE, {
    idPrefix: "production-auth",
});
```

Treat the prefix as part of the stored-data format. Changing it makes existing values unreachable. Storage keys may be at most 2 KiB and values may be at most 120 KiB.

The prefix is also an isolation boundary. If independent auth applications or environments share a Durable Object namespace, give each one a unique, stable prefix. Reusing a prefix can make matching verification or rate-limit keys share state.

Writes also use Durable Object storage and schedule expiry alarms. This removes D1 rate-limit traffic, but it has its own latency and billing.

See Cloudflare's [Durable Objects documentation](https://developers.cloudflare.com/durable-objects/) for pricing, limits, local development, and migrations.
