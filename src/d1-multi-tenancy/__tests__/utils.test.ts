/**
 * Tests for D1 Multi-Tenancy Utility Functions
 *
 * Uses real local D1 via wrangler local persistence for createD1Database
 * and deleteD1Database tests.  Error handling tests use createErrorD1Fetch
 * to simulate specific Cloudflare API error responses.
 */

import { describe, test, expect, vi } from "vitest";
import { getD1Pool, createErrorD1Fetch, assertD1FilesExist } from "./helpers";
import {
    CloudflareD1MultiTenancyError,
    CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES,
    validateCloudflareCredentials,
    createD1Database,
    deleteD1Database,
    getCloudflareD1TenantDatabaseName,
} from "../utils";

// ---------------------------------------------------------------------------
// CloudflareD1MultiTenancyError
// ---------------------------------------------------------------------------
describe("CloudflareD1MultiTenancyError", () => {
    test("should create error with code and default message", () => {
        const error = new CloudflareD1MultiTenancyError("MISSING_API_TOKEN");

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(CloudflareD1MultiTenancyError);
        expect(error.name).toBe("CloudflareD1MultiTenancyError");
        expect(error.code).toBe("MISSING_API_TOKEN");
        expect(error.message).toBe(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.MISSING_API_TOKEN);
    });

    test("should create error with custom message", () => {
        const customMessage = "Custom error message";
        const error = new CloudflareD1MultiTenancyError("DATABASE_CREATION_FAILED", customMessage);

        expect(error.code).toBe("DATABASE_CREATION_FAILED");
        expect(error.message).toBe(customMessage);
    });

    test("should create errors for all valid codes", () => {
        const codes = Object.keys(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES) as Array<
            keyof typeof CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES
        >;

        for (const code of codes) {
            const error = new CloudflareD1MultiTenancyError(code);
            expect(error.code).toBe(code);
            expect(error.message).toBe(CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES[code]);
        }
    });
});

// ---------------------------------------------------------------------------
// validateCloudflareCredentials
// ---------------------------------------------------------------------------
describe("validateCloudflareCredentials", () => {
    test("should not throw with valid credentials", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "acct123" })
        ).not.toThrow();
    });

    test("should throw MISSING_API_TOKEN when apiToken is empty string", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "", accountId: "acct123" })
        ).toThrow(CloudflareD1MultiTenancyError);

        try {
            validateCloudflareCredentials({ apiToken: "", accountId: "acct123" });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("MISSING_API_TOKEN");
        }
    });

    test("should throw MISSING_API_TOKEN when apiToken is whitespace only", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "   ", accountId: "acct123" })
        ).toThrow(CloudflareD1MultiTenancyError);
    });

    test("should throw MISSING_ACCOUNT_ID when accountId is empty string", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "" })
        ).toThrow(CloudflareD1MultiTenancyError);

        try {
            validateCloudflareCredentials({ apiToken: "token123", accountId: "" });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("MISSING_ACCOUNT_ID");
        }
    });

    test("should throw MISSING_ACCOUNT_ID when accountId is whitespace only", () => {
        expect(() =>
            validateCloudflareCredentials({ apiToken: "token123", accountId: "  " })
        ).toThrow(CloudflareD1MultiTenancyError);
    });
});

// ---------------------------------------------------------------------------
// createD1Database – uses real local D1 via the fetch interceptor
// ---------------------------------------------------------------------------
describe("createD1Database", () => {
    const config = { apiToken: "test-token", accountId: "test-account" };

    test("should return a valid database UUID via real local D1", async () => {
        const result = await createD1Database(config, "DB_20240101_test");

        // Should return a valid UUID from the local D1 interceptor
        expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

        // The D1 pool should have allocated a binding for this database
        const pool = getD1Pool();
        const binding = pool.get(result);
        expect(binding).toBeDefined();

        // Verify SQLite files exist on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should create a usable D1 database that can store data", async () => {
        const dbUuid = await createD1Database(config, "DB_data_test");

        // Use the allocated D1 binding to verify it's a real database
        const pool = getD1Pool();
        const binding = pool.get(dbUuid);
        expect(binding).toBeDefined();

        // Execute SQL on the real D1 database
        await binding.exec("CREATE TABLE util_test (id TEXT PRIMARY KEY, value TEXT);");
        await binding.exec("INSERT INTO util_test (id, value) VALUES ('row1', 'created');");

        const result = await binding.prepare("SELECT * FROM util_test WHERE id = ?").bind("row1").first();
        expect(result).toEqual({ id: "row1", value: "created" });
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when response is not ok", async () => {
        globalThis.fetch = createErrorD1Fetch({
            httpError: { status: 400, statusText: "Bad Request" },
        });

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when API returns errors array", async () => {
        globalThis.fetch = createErrorD1Fetch({
            createError: { code: 1001, message: "Database already exists" },
        });

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );
    });

    test("should throw INVALID_CREDENTIALS when fetch throws authentication error", async () => {
        globalThis.fetch = createErrorD1Fetch({
            networkError: "authentication failed",
        });

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });

    test("should throw INVALID_CREDENTIALS when fetch throws unauthorized error", async () => {
        globalThis.fetch = createErrorD1Fetch({
            networkError: "unauthorized access",
        });

        await expect(createD1Database(config, "DB_test")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await createD1Database(config, "DB_test");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });
});

// ---------------------------------------------------------------------------
// deleteD1Database – uses real local D1 via the fetch interceptor
// ---------------------------------------------------------------------------
describe("deleteD1Database", () => {
    const config = { apiToken: "test-token", accountId: "test-account" };

    test("should resolve without error on success", async () => {
        // First create a database so there's something to delete
        const dbUuid = await createD1Database(config, "DB_to_delete");
        expect(dbUuid).toBeDefined();

        // Now delete it — the interceptor drops all tables
        await expect(deleteD1Database(config, dbUuid)).resolves.toBeUndefined();
    });

    test("should clean up D1 data when deleting a database", async () => {
        // Create a database and add data
        const dbUuid = await createD1Database(config, "DB_delete_data");
        const pool = getD1Pool();
        const binding = pool.get(dbUuid);

        await binding.exec("CREATE TABLE delete_test (id TEXT PRIMARY KEY);");
        await binding.exec("INSERT INTO delete_test (id) VALUES ('row1');");

        // Verify data exists
        const beforeDelete = await binding
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delete_test'")
            .all();
        expect(beforeDelete.results).toHaveLength(1);

        // Delete the database
        await deleteD1Database(config, dbUuid);

        // Verify the table was dropped
        const afterDelete = await binding
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delete_test'")
            .all();
        expect(afterDelete.results).toHaveLength(0);
    });

    test("should throw CLOUDFLARE_D1_API_ERROR when delete fails with HTTP error", async () => {
        globalThis.fetch = createErrorD1Fetch({
            deleteError: "Cloudflare API error: 404 Not Found - Database not found",
        });

        await expect(deleteD1Database(config, "db-uuid-123")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await deleteD1Database(config, "db-uuid-123");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });

    test("should throw INVALID_CREDENTIALS when fetch throws authentication error", async () => {
        globalThis.fetch = createErrorD1Fetch({
            deleteError: "authentication error",
        });

        await expect(deleteD1Database(config, "db-uuid-123")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            await deleteD1Database(config, "db-uuid-123");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });
});

// ---------------------------------------------------------------------------
// getCloudflareD1TenantDatabaseName
// ---------------------------------------------------------------------------
describe("getCloudflareD1TenantDatabaseName", () => {
    test("should return name in DB_{YYYYMMDD}_{hash} format by default", () => {
        const name = getCloudflareD1TenantDatabaseName("user_12345");

        expect(name).toMatch(/^DB_\d{8}_[a-z0-9]+$/);
    });

    test("should use provided prefix", () => {
        const name = getCloudflareD1TenantDatabaseName("user_12345", "TENANT");

        expect(name).toMatch(/^TENANT_\d{8}_[a-z0-9]+$/);
    });

    test("should produce the same name for the same tenant ID (deterministic hash)", () => {
        const name1 = getCloudflareD1TenantDatabaseName("org_abc");
        const name2 = getCloudflareD1TenantDatabaseName("org_abc");

        const hash1 = name1.split("_")[2];
        const hash2 = name2.split("_")[2];
        expect(hash1).toBe(hash2);
    });

    test("should produce different hashes for different tenant IDs", () => {
        const name1 = getCloudflareD1TenantDatabaseName("user_aaa");
        const name2 = getCloudflareD1TenantDatabaseName("user_bbb");

        const hash1 = name1.split("_")[2];
        const hash2 = name2.split("_")[2];
        expect(hash1).not.toBe(hash2);
    });

    test("should include today's year in the date part", () => {
        const name = getCloudflareD1TenantDatabaseName("tenant_xyz");
        const datePart = name.split("_")[1];

        const year = parseInt(datePart.substring(0, 4));
        expect(year).toBe(new Date().getFullYear());
    });
});
