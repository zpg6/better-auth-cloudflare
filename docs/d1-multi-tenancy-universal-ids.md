# D1 Multi-Tenancy with Universal ID-Based Sharding

This document describes the Universal ID-based sharding approach for D1 multi-tenancy in `better-auth-cloudflare`.

## Overview

The D1 multi-tenancy feature enables automatic tenant database creation and routing for user or organization-level multi-tenancy. It uses a **hybrid approach** that combines:

- ✅ `d1-http` Drizzle driver for accessing unbound databases
- ✅ Better Auth hooks for database creation/deletion on user/org lifecycle events
- ✅ AdapterRouter for directing queries to the correct database
- ✅ **Universal IDs with embedded shard/routing metadata**
- ✅ **Self-describing IDs that eliminate central lookup dependencies**
- ✅ **Structured database naming convention for easier management**

## Key Concepts

### Universal IDs

Universal IDs are self-describing identifiers that embed routing metadata directly within the ID itself. This eliminates the need to query the tenant mapping table on every read operation.

**ID Format**: `<timestamp><shardHash><typeHash><random>`

- **timestamp** (11 chars): Base36-encoded milliseconds since epoch
- **shardHash** (8 chars): Hash derived from the database UUID for routing
- **typeHash** (4 chars): Hash of the record type (e.g., "birthday", "document")
- **random** (10 chars): Random component for uniqueness

Example: `2k7h3m9n5abc12345xyz9a8b7c6d5e`

### Shard Cache

The shard cache is an in-memory mapping of `shardHash → databaseId` that enables fast routing without database lookups. The cache:

- Hydrates once at startup (lazy initialization)
- Updates automatically when tenant databases are created/deleted
- Has configurable TTL and max entries
- Provides graceful degradation if lookup fails

### Structured Database Naming

Databases use a structured naming convention: `DB_{date}_{tenantHash}`

Example: `DB_20260102_a3f4c2d1`

This makes it easier to:
- Identify when databases were created
- Group databases by time period
- Debug and manage databases manually

## How It Works

### 1. Tenant Database Creation

When a user or organization is created:

```typescript
1. Generate database name: DB_20260102_a3f4c2d1
2. Create D1 database via Cloudflare API
3. Generate shard hash from database UUID: abc12345
4. Initialize database with current schema
5. Store tenant record with shard hash in main DB
6. Cache the shard hash mapping
```

### 2. Record Creation with Universal IDs

When creating a tenant-scoped record:

```typescript
// Generate Universal ID with embedded shard hash
const universalId = defaultIdGenerator.generate({
    shardHash: "abc12345",  // From tenant record
    recordType: "birthday"
});

// Create record with Universal ID
await db.create({
    model: "birthday",
    data: {
        id: universalId,
        tenantId: "user_123",
        name: "John's Birthday",
        date: new Date("1990-01-15")
    }
});
```

### 3. Record Routing (Fast Path)

When querying by Universal ID:

```typescript
// Fast path: No tenant table lookup needed!
const birthday = await db.findOne({
    model: "birthday",
    where: [{ field: "id", value: universalId }]
});

// Behind the scenes:
// 1. Extract shard hash from ID: "abc12345"
// 2. Lookup in cache: shardHash -> databaseId
// 3. Route directly to tenant database
// ✅ Zero additional database queries!
```

### 4. Fallback Routing

For backward compatibility, the system falls back to traditional routing:

```typescript
// Query by tenantId (fallback path)
const birthdays = await db.findMany({
    model: "birthday",
    where: [{ field: "tenantId", value: "user_123" }]
});

// Behind the scenes:
// 1. Extract tenantId from query
// 2. Query tenant table for databaseId
// 3. Route to tenant database
```

## Configuration

### Basic Setup

```typescript
import { withCloudflare, cloudflareD1MultiTenancy } from "better-auth-cloudflare";
import { betterAuth } from "better-auth";

const auth = betterAuth({
    ...withCloudflare(
        {
            d1: {
                db: mainDb,
                options: {
                    schema: yourSchema,
                    usePlural: true,
                },
                multiTenancy: {
                    cloudflareD1Api: {
                        apiToken: env.CLOUDFLARE_D1_API_TOKEN,
                        accountId: env.CLOUDFLARE_ACCT_ID,
                        debugLogs: true,
                    },
                    mode: "organization", // or "user"
                    databasePrefix: "DB", // Optional, default: "DB"
                    migrations: {
                        currentSchema: tenantSchemaSQL,
                        currentVersion: "1.0.0",
                    },
                },
            },
        },
        {
            // Your Better Auth options
        }
    ),
});
```

### Using Universal IDs

```typescript
import { defaultIdGenerator, getShardCache } from "better-auth-cloudflare/d1-multi-tenancy";

// Get tenant's shard hash (once per tenant)
const tenant = await adapter.findOne({
    model: "tenant",
    where: [
        { field: "tenantId", value: userId },
        { field: "tenantType", value: "user" },
    ],
    select: ["shardHash", "databaseId"],
});

// Generate Universal ID for new record
const recordId = defaultIdGenerator.generate({
    shardHash: tenant.shardHash,
    recordType: "birthday",
});

// Create record with Universal ID
await db.create({
    model: "birthday",
    data: {
        id: recordId,
        tenantId: userId,
        name: "Important Date",
        date: new Date(),
    },
});
```

### Cache Management

```typescript
import { getShardCache } from "better-auth-cloudflare/d1-multi-tenancy";

// Get global cache instance
const cache = getShardCache();

// Check if cache is hydrated
if (!cache.isReady()) {
    await cache.hydrate(adapter, "user");
}

// Manual cache operations (usually not needed)
cache.set({
    shardHash: "abc12345",
    databaseId: "db-uuid",
    tenantId: "user_123",
    databaseName: "DB_20260102_abc12345",
});

const entry = cache.get("abc12345");
cache.delete("abc12345");
cache.clear();
```

## Benefits

### Performance Improvements

| Routing Method | Database Queries | Latency |
|---------------|------------------|---------|
| **Universal ID (new)** | 0 additional queries | ~5ms |
| Traditional tenantId lookup | 1 additional query | ~50ms |

### Comparison with Previous Approach

| Aspect | Previous Approach | Hybrid Approach |
|--------|------------------|-----------------|
| **Tenant Lookup** | Every tenant-scoped query | Only for non-Universal ID queries |
| **Routing Logic** | Centralized in AdapterRouter | Distributed in the IDs themselves |
| **Cache** | Not used | In-memory cache for fast routing |
| **Database Discovery** | Tenant table required | Self-describing IDs + cache fallback |
| **Graceful Degradation** | No fallback | Falls back to tenant table if needed |

### Reliability Improvements

- **Reduced dependency** on tenant table availability
- **Self-routing** IDs work even if cache is cold
- **Backward compatible** with existing non-Universal ID records
- **Easier debugging** with structured database names

## Migration Guide

### For New Installations

No migration needed! Just use the Universal ID generator when creating records:

```typescript
import { defaultIdGenerator } from "better-auth-cloudflare/d1-multi-tenancy";

const id = defaultIdGenerator.generate({
    shardHash: tenant.shardHash,
    recordType: "birthday",
});
```

### For Existing Installations

Existing tenant databases will continue to work with the fallback routing. To migrate:

1. **Add `shardHash` field** to existing tenant records:

```typescript
// One-time migration script
const tenants = await adapter.findMany({
    model: "tenant",
    where: [{ field: "status", value: "active" }],
});

for (const tenant of tenants) {
    const shardHash = generateShardHashFromDatabaseId(tenant.databaseId);
    await adapter.update({
        model: "tenant",
        where: [{ field: "id", value: tenant.id }],
        update: { shardHash },
    });
}
```

2. **Gradually adopt Universal IDs** for new records
3. **Keep using traditional IDs** for existing records (they'll use fallback routing)

## API Reference

### ID Generator

```typescript
import { UniversalIdGenerator, defaultIdGenerator } from "better-auth-cloudflare/d1-multi-tenancy";

// Use default instance
const id = defaultIdGenerator.generate({
    shardHash: "abc12345",
    recordType: "birthday",
});

// Decode ID
const decoded = defaultIdGenerator.decode(id);
// {
//   id: "...",
//   timestamp: 1704153600000,
//   shardHash: "abc12345",
//   typeHash: "xyz4",
//   random: "a8b7c6d5e4"
// }

// Fast shard hash extraction
const shardHash = defaultIdGenerator.extractShardHash(id);
// "abc12345"

// Check if ID is Universal ID
const isUniversal = defaultIdGenerator.isUniversalId(id);
// true

// Custom configuration
const customGenerator = new UniversalIdGenerator({
    timestampLength: 11,
    shardHashLength: 8,
    typeHashLength: 4,
    randomLength: 10,
});
```

### Shard Cache

```typescript
import { ShardCache, getShardCache } from "better-auth-cloudflare/d1-multi-tenancy";

// Get global singleton
const cache = getShardCache();

// Create custom instance
const customCache = new ShardCache({
    ttl: 3600000,        // 1 hour
    maxEntries: 10000,
    debugLogs: true,
});

// Set entry
cache.set({
    shardHash: "abc12345",
    databaseId: "db-uuid",
    tenantId: "user_123",
    databaseName: "DB_20260102_abc12345",
});

// Get entry
const entry = cache.get("abc12345");

// Delete entry
cache.delete("abc12345");

// Clear all entries
cache.clear();

// Get size
const size = cache.size();

// Hydrate from database
await cache.hydrate(adapter, "user");

// Ensure hydrated (lazy)
await cache.ensureHydrated(adapter, "user");

// Check if hydrated
const isReady = cache.isReady();

// Get all entries
const all = cache.getAll();
```

### Helper Functions

```typescript
import {
    generateShardHashFromDatabaseId,
    generateStructuredDatabaseName,
} from "better-auth-cloudflare/d1-multi-tenancy";

// Generate shard hash from database UUID
const shardHash = generateShardHashFromDatabaseId("db-uuid-123");
// "abc12345"

// Generate structured database name
const dbName = generateStructuredDatabaseName("user_123");
// "DB_20260102_a3f4c2d1"

// With custom prefix
const customDbName = generateStructuredDatabaseName("user_123", "TENANT");
// "TENANT_20260102_a3f4c2d1"
```

## Best Practices

### 1. Always Use Universal IDs for New Records

```typescript
// ✅ Good: Use Universal IDs
const id = defaultIdGenerator.generate({
    shardHash: tenant.shardHash,
    recordType: "birthday",
});

// ❌ Avoid: Using Better Auth's default ID generator
// (it won't have routing metadata)
```

### 2. Cache Tenant Shard Hashes

```typescript
// ✅ Good: Cache shard hash per session/request
const tenantCache = new Map<string, string>();

function getShardHash(tenantId: string): string {
    if (!tenantCache.has(tenantId)) {
        const tenant = await loadTenant(tenantId);
        tenantCache.set(tenantId, tenant.shardHash);
    }
    return tenantCache.get(tenantId);
}
```

### 3. Handle Missing Shard Hashes Gracefully

```typescript
// For records created before Universal ID adoption
if (!tenant.shardHash) {
    // Fallback to traditional routing
    // or regenerate shard hash from databaseId
    const shardHash = generateShardHashFromDatabaseId(tenant.databaseId);
    // Update tenant record...
}
```

### 4. Monitor Cache Performance

```typescript
const cache = getShardCache({ debugLogs: true });

// Check cache size periodically
console.log(`Cache size: ${cache.size()}`);

// Monitor hit rate by logging when fallback is used
```

## Troubleshooting

### Cache Not Hydrating

**Symptom**: Routes fall back to tenant table lookups every time

**Solution**: Ensure cache is hydrated at application startup:

```typescript
import { getShardCache } from "better-auth-cloudflare/d1-multi-tenancy";

// In your app initialization
const cache = getShardCache();
await cache.hydrate(adapter, "user");
```

### Universal IDs Not Routing Correctly

**Symptom**: Queries by Universal ID fail or route to wrong database

**Solution**: Verify shard hash is correct:

```typescript
const decoded = defaultIdGenerator.decode(universalId);
console.log("Shard hash:", decoded.shardHash);

const cachedEntry = cache.get(decoded.shardHash);
console.log("Cached entry:", cachedEntry);
```

### Old Records Not Working

**Symptom**: Records created before migration don't route correctly

**Solution**: These records should use fallback routing automatically. Verify the tenantId is present:

```typescript
// Fallback routing requires tenantId
await db.findMany({
    model: "birthday",
    where: [{ field: "tenantId", value: userId }]
});
```

## Performance Tuning

### Cache Configuration

```typescript
const cache = getShardCache({
    ttl: 7200000,        // 2 hours (increase for less churn)
    maxEntries: 50000,   // Increase for more tenants
    debugLogs: false,    // Disable in production
});
```

### ID Configuration

```typescript
// Shorter IDs for less storage overhead
const generator = new UniversalIdGenerator({
    timestampLength: 11,
    shardHashLength: 6,   // Reduce if you have < 1M tenants
    typeHashLength: 3,    // Reduce if you have < 100 record types
    randomLength: 8,      // Reduce if collision risk is low
});
```

## Security Considerations

1. **Shard hashes are deterministic** - Don't rely on them for security
2. **Database UUIDs are in IDs** - Consider this when sharing IDs publicly
3. **Cache is in-memory** - Lost on restart (automatically rehydrates)
4. **API tokens are sensitive** - Store securely in environment variables

## Future Enhancements

- [ ] Automatic shard hash migration for existing records
- [ ] Cache persistence across restarts
- [ ] Distributed cache support (KV, Durable Objects)
- [ ] Automatic cache warming strategies
- [ ] Metrics and monitoring integration
- [ ] Multi-region shard routing

## References

- [D1 Sharding Architecture Blog Post](https://pizzaconsole.com/blog/posts/programming/d1-sharding)
- [Better Auth Documentation](https://www.better-auth.com)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
