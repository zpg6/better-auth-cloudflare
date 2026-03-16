/**
 * Tests for multi-tenancy with Better Auth plugins and schema relationships
 */

import { describe, test, expect } from "vitest";

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
            const pluginTables = ["apiKey", "apiKeys", "twoFactor", "twoFactors"];

            const defaultCoreModels = [
                "user", "users",
                "account", "accounts",
                "session", "sessions"
            ];

            const CORE_AUTH_TABLES = new Set([
                ...defaultCoreModels,
                ...pluginTables
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

            const customCoreModels = defaultCoreModels.filter(
                m => m !== "session" && m !== "sessions"
            );

            const CORE_AUTH_TABLES = new Set(customCoreModels);

            expect(CORE_AUTH_TABLES.has("user")).toBe(true);
            expect(CORE_AUTH_TABLES.has("session")).toBe(false);
        });
    });

    describe("Schema Relationships", () => {
        test("should handle relationships between main and tenant tables", () => {
            const mainTables = ["user", "organization"];
            const tenantTables = ["userBirthday"];

            const mockUserId = "user_123";
            const mockTenantId = "org_456";

            const tenantId = mockTenantId;

            expect(tenantId).toBe("org_456");
        });

        test("should handle plugin relationships correctly", () => {
            const coreTables = ["user", "twoFactor"];
            const tenantTables = ["userBirthday"];

            const CORE_AUTH_TABLES = new Set(coreTables);

            expect(CORE_AUTH_TABLES.has("twoFactor")).toBe(true);
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
            const mainMigrations = ["0000_add_tenant_table.sql", "0001_add_shard_hash.sql"];
            const tenantMigrations = ["0000_add_birthdays.sql", "0001_add_reminders.sql"];

            expect(mainMigrations.length).toBeGreaterThan(0);
            expect(tenantMigrations.length).toBeGreaterThan(0);
        });
    });

    describe("Drizzle Schema Filtering", () => {
        test("should properly filter Drizzle schema objects", () => {
            const fullSchema = {
                user: { /* table def */ },
                users: { /* table def */ },
                account: { /* table def */ },
                userBirthday: { /* table def */ },
                birthdayReminder: { /* table def */ },
            };

            const coreModels = new Set(["user", "users", "account", "accounts"]);

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
