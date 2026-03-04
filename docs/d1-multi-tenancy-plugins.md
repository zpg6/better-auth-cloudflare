# Handling Better Auth Plugins with D1 Multi-Tenancy

This guide explains how D1 multi-tenancy handles Better Auth plugins and their schema modifications, including relationships between tables.

## Table Placement Strategy

### Core Auth Tables (Main Database)
The following tables always remain in the main database:
- `user`, `users` - User accounts
- `account`, `accounts` - OAuth/social accounts
- `session`, `sessions` - User sessions (optional, can be moved to tenant DB)
- `organization`, `organizations` - Organization records
- `member`, `members` - Organization members
- `invitation`, `invitations` - Organization invitations
- `verification`, `verifications` - Email/phone verifications
- `tenant`, `tenants` - Tenant database mappings

### Tenant Tables (Tenant Databases)
All other tables go to tenant databases, including:
- Custom application tables with `tenantId` field
- Tenant-scoped plugin tables
- Tables that don't reference core auth tables

## Plugin Considerations

### 1. Plugins That Add Core Tables

Some plugins add tables that reference core auth tables and should stay in the main database:

```typescript
// Example: twoFactor plugin adds twoFactor table
import { twoFactor } from "better-auth/plugins";

// twoFactor table has userId foreign key -> stays in main DB
const auth = betterAuth({
    plugins: [twoFactor()],
    // ...
});
```

**Rule**: If a plugin table only references core tables and has no `tenantId` field, it should stay in the main database.

To keep plugin tables in the main database, add them to `coreModels`:

```typescript
d1: {
    multiTenancy: {
        coreModels: (defaultModels) => [
            ...defaultModels,
            "twoFactor", "twoFactors",  // Add plugin tables
            "apiKey", "apiKeys"
        ],
        // ...
    }
}
```

### 2. Plugins That Add Tenant-Scoped Tables

If your custom plugin adds tables with a `tenantId` field, they automatically go to tenant databases:

```typescript
// Custom plugin that adds tenant-scoped tables
export const birthdayPlugin = () => {
    return {
        schema: {
            userBirthday: {
                fields: {
                    tenantId: { type: "string", required: true },
                    userId: { type: "string", required: true },
                    birthday: { type: "date", required: true },
                }
            }
        }
    };
};
```

**No additional configuration needed** - these tables are automatically routed to tenant databases.

### 3. Moving Core Tables to Tenant Databases

You can move some core tables (like sessions) to tenant databases:

```typescript
d1: {
    multiTenancy: {
        coreModels: (defaultModels) => 
            defaultModels.filter(m => m !== "session" && m !== "sessions"),
        // ...
    }
}
```

**Important**: When moving sessions to tenant databases, you must add `tenantId` to session creation logic.

## Handling Cross-Database Relationships

### Problem

When a tenant table references a main table (e.g., `userBirthday.userId` → `user.id`), the databases are separate, breaking foreign key constraints.

### Solution

The adapter router handles this through multi-step resolution:

```typescript
// Example: Query birthdays for a specific user
const birthdays = await adapter.findMany({
    model: "userBirthday",
    where: [
        { field: "userId", value: "user_123" },
        { field: "tenantId", value: "org_456" }  // Required for routing
    ]
});

// Behind the scenes:
// 1. Extract tenantId from query -> "org_456"
// 2. Look up tenant database ID
// 3. Route query to tenant database
// 4. Query userBirthday table (userId is just data, not enforced FK)
```

### Best Practices

1. **Always include `tenantId` in queries** for tenant-scoped tables
2. **Don't rely on foreign key constraints** across databases
3. **Validate references in application code** instead of database constraints
4. **Use Universal IDs** for better routing performance

## Schema Generation with Plugins

### Separate Schema Files

Maintain separate schemas for main and tenant databases:

```
src/db/
├── auth.schema.ts      # Main DB: core auth tables
├── tenant.schema.ts    # Tenant DB: tenant-scoped tables
└── schema.ts           # Combined export
```

### Generating Main Schema

```bash
# Generate core auth schema with plugins
npx @better-auth/cli generate \
    --config src/auth/index.ts \
    --output src/db/auth.schema.ts \
    -y
```

This includes:
- Core auth tables
- Plugin tables configured to stay in main DB

### Generating Tenant Schema

Manually create or use a separate drizzle config:

```typescript
// drizzle-tenant.config.ts
export default defineConfig({
    schema: "./src/db/tenant.schema.ts",
    out: "./drizzle-tenant",
});
```

```bash
# Generate tenant migrations
drizzle-kit generate
```

## Migration Strategy

### Main Database Migrations

1. Generate schema: `npm run auth:generate`
2. Create Drizzle migrations: `drizzle-kit generate`
3. Apply to main DB: `wrangler d1 migrations apply DATABASE`

### Tenant Database Migrations

Tenant databases receive the current schema on creation. For existing tenant databases:

1. Generate tenant migrations in `drizzle-tenant/`
2. Use the multi-tenancy plugin's migration system:

```typescript
d1: {
    multiTenancy: {
        migrations: {
            currentSchema: raw,  // Latest schema SQL
            currentVersion: "v1.1.0",
        },
    }
}
```

3. New tenant databases get the current schema automatically
4. Existing tenant databases: Use the CLI migration tool (if available) or apply manually

## Example: Adding a Plugin

Let's add the `anonymous` plugin to an existing multi-tenancy setup:

### Step 1: Add Plugin

```typescript
// src/auth/index.ts
import { anonymous } from "better-auth/plugins";

export const auth = betterAuth({
    plugins: [
        organization(),
        anonymous(),  // Adds anonymous user support
    ],
});
```

### Step 2: Determine Table Placement

The `anonymous` plugin adds tables that reference core auth tables, so they stay in main DB:

```typescript
d1: {
    multiTenancy: {
        coreModels: (defaultModels) => [
            ...defaultModels,
            "anonymous", "anonymous"  // Add if needed
        ],
    }
}
```

### Step 3: Regenerate Schema

```bash
npm run auth:generate
```

### Step 4: Create and Apply Migrations

```bash
# Generate migrations for main DB
drizzle-kit generate

# Apply to main DB
wrangler d1 migrations apply DATABASE --local
```

### Step 5: Test

```typescript
// Existing tenants continue working
// New features work in main DB
const anonSession = await auth.api.signInAnonymous();
```

## Troubleshooting

### Plugin Tables Not Routing Correctly

**Symptom**: Plugin tables throw errors or route to wrong database

**Solution**: Add plugin tables to `coreModels` if they should stay in main DB:

```typescript
coreModels: (defaultModels) => [
    ...defaultModels,
    "myPluginTable", "myPluginTables"
]
```

### Cross-Database Reference Errors

**Symptom**: Cannot join or reference across main and tenant databases

**Solution**: 
1. Fetch from main DB first
2. Use result to query tenant DB
3. Combine in application layer

```typescript
// DON'T: Try to join across databases
const result = await db.select()
    .from(userBirthdays)
    .leftJoin(users, eq(userBirthdays.userId, users.id));  // Won't work!

// DO: Query separately
const user = await mainDb.select().from(users).where(eq(users.id, userId));
const birthdays = await tenantDb.select()
    .from(userBirthdays)
    .where(eq(userBirthdays.userId, userId));

// Combine in code
const result = { user, birthdays };
```

### Schema Generation Issues

**Symptom**: Better Auth CLI doesn't include all tables

**Solution**: Ensure all plugins are included in the schema generation export:

```typescript
// src/auth/index.ts
export const auth = betterAuth({
    plugins: [
        organization(),
        anonymous(),
        myCustomPlugin(),  // Include all plugins
    ],
    database: drizzleAdapter(process.env.DATABASE as any, {
        provider: "sqlite",
        usePlural: true,
    }),
});
```

## Advanced: Custom Routing for Plugins

For plugins with complex routing needs, use custom routing:

```typescript
d1: {
    multiTenancy: {
        tenantRouting: ({ modelName, operation, data }) => {
            // Custom routing for plugin tables
            if (modelName === "myPluginTable") {
                // Extract tenantId from custom field
                const customField = extractFromData(data);
                return customField.tenantId;
            }
            
            return undefined;  // Fall back to default
        },
    }
}
```

## Summary

- **Core tables** (user, account, etc.) stay in main database
- **Plugin tables** that only reference core tables should stay in main DB
- **Tenant-scoped tables** (with `tenantId`) go to tenant databases
- **Cross-database relationships** are handled in application code, not database constraints
- **Schema generation** is separate for main and tenant databases
- **Migrations** are applied to main DB once, to tenant DBs on creation or via CLI

For more details, see the [main D1 Multi-Tenancy documentation](./d1-multi-tenancy-universal-ids.md).
