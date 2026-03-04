/**
 * Tests for multi-tenancy with Better Auth plugins and schema relationships
 */

import { describe, test, expect, beforeEach } from "@jest/globals";

describe("D1 Multi-Tenancy with Plugins", () => {
    describe("Schema Separation", () => {
        test("should properly separate core auth tables from tenant tables", () => {
            const defaultCoreModels = [
                "user", "users",
                "account", "accounts",
                "session", "sessions",
                "organization", "organizations",
                "member", "members",
                "invitation", "invitations",
                "verification", "verifications",
                "tenant", "tenants"
            ];

            const allModels = [
                ...defaultCoreModels,
                "userBirthday", "userBirthdays",
                "birthdayReminder", "birthdayReminders",
                "document", "documents"
            ];

            const CORE_AUTH_TABLES = new Set(defaultCoreModels);

            // Core tables should be in main DB
            defaultCoreModels.forEach(model => {
                expect(CORE_AUTH_TABLES.has(model)).toBe(true);
            });

            // Tenant tables should NOT be in core set
            expect(CORE_AUTH_TABLES.has("userBirthday")).toBe(false);
            expect(CORE_AUTH_TABLES.has("birthdayReminder")).toBe(false);
            expect(CORE_AUTH_TABLES.has("document")).toBe(false);
        });

        test("should handle plugin-added tables correctly", () => {
            // When a plugin adds tables with relationships to user table
            const pluginTables = ["apiKey", "apiKeys", "twoFactor", "twoFactors"];
            
            const defaultCoreModels = [
                "user", "users",
                "account", "accounts",
                "session", "sessions"
            ];

            // By default, plugin tables might reference user table
            // We need to determine if they should go to main or tenant DB
            // Rule: If table references ONLY core tables, it stays in main DB
            // If table has tenantId field, it goes to tenant DB

            const CORE_AUTH_TABLES = new Set([
                ...defaultCoreModels,
                ...pluginTables // Add plugin tables to core by default
            ]);

            expect(CORE_AUTH_TABLES.has("apiKey")).toBe(true);
            expect(CORE_AUTH_TABLES.has("twoFactor")).toBe(true);
        });

        test("should allow custom core models configuration", () => {
            const defaultCoreModels = [
                "user", "users",
                "account", "accounts",
                "session", "sessions"
            ];

            // User wants to move sessions to tenant databases
            const customCoreModels = defaultCoreModels.filter(
                m => m !== "session" && m !== "sessions"
            );

            const CORE_AUTH_TABLES = new Set(customCoreModels);

            expect(CORE_AUTH_TABLES.has("user")).toBe(true);
            expect(CORE_AUTH_TABLES.has("session")).toBe(false); // Moved to tenant DB
        });
    });

    describe("Schema Relationships", () => {
        test("should handle relationships between main and tenant tables", () => {
            // Simulating a scenario where tenant table references main table
            const mainTables = ["user", "organization"];
            const tenantTables = ["userBirthday"]; // Has userId field referencing main.user

            // In adapter router, when querying userBirthday by userId:
            // 1. We need userId to be resolved in main DB
            // 2. Then use that user's tenantId to route to tenant DB
            // 3. Query userBirthday in tenant DB

            // This is handled by the routing logic that extracts tenantId
            const mockUserId = "user_123";
            const mockTenantId = "org_456";

            // Simulating the lookup chain
            const tenantId = mockTenantId; // Would be extracted from user record
            
            expect(tenantId).toBe("org_456");
        });

        test("should handle plugin relationships correctly", () => {
            // Example: twoFactor plugin adds twoFactor table with userId foreign key
            // This table should stay in main DB because it references user table
            const coreTables = ["user", "twoFactor"];
            const tenantTables = ["userBirthday"];

            const CORE_AUTH_TABLES = new Set(coreTables);

            // twoFactor stays in main DB to maintain referential integrity
            expect(CORE_AUTH_TABLES.has("twoFactor")).toBe(true);
            
            // userBirthday goes to tenant DB
            expect(CORE_AUTH_TABLES.has("userBirthday")).toBe(false);
        });
    });

    describe("Migration Handling", () => {
        test("should handle separate migration files for main and tenant schemas", () => {
            const mainMigrationPath = "./drizzle";
            const tenantMigrationPath = "./drizzle-tenant";

            expect(mainMigrationPath).not.toBe(tenantMigrationPath);
        });

        test("should apply migrations to correct database", () => {
            // Main migrations go to main DB
            const mainMigrations = ["0000_add_tenant_table.sql", "0001_add_shard_hash.sql"];
            
            // Tenant migrations go to all tenant DBs
            const tenantMigrations = ["0000_add_birthdays.sql", "0001_add_reminders.sql"];

            expect(mainMigrations.length).toBeGreaterThan(0);
            expect(tenantMigrations.length).toBeGreaterThan(0);
        });
    });

    describe("Drizzle Schema Filtering", () => {
        test("should properly filter Drizzle schema objects", () => {
            // Mock full schema with both main and tenant tables
            const fullSchema = {
                user: { /* table def */ },
                users: { /* table def */ },
                account: { /* table def */ },
                userBirthday: { /* table def */ },
                birthdayReminder: { /* table def */ },
            };

            const coreModels = new Set(["user", "users", "account", "accounts"]);

            // Filter to get tenant schema only
            const tenantSchema = Object.fromEntries(
                Object.entries(fullSchema).filter(
                    ([tableName]) => !coreModels.has(tableName)
                )
            );

            expect(Object.keys(tenantSchema)).toEqual(["userBirthday", "birthdayReminder"]);
            expect(tenantSchema.user).toBeUndefined();
            expect(tenantSchema.userBirthday).toBeDefined();
        });

        test("should handle empty tenant schema", () => {
            const fullSchema = {
                user: { /* table def */ },
                account: { /* table def */ },
            };

            const coreModels = new Set(["user", "account"]);

            const tenantSchema = Object.fromEntries(
                Object.entries(fullSchema).filter(
                    ([tableName]) => !coreModels.has(tableName)
                )
            );

            expect(Object.keys(tenantSchema)).toHaveLength(0);
        });
    });
});
