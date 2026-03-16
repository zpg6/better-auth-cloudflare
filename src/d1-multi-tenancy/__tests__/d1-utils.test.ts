/**
 * Tests for D1 Database Utilities (executeD1SQL, initializeTenantDatabase, etc.)
 *
 * Uses real D1 databases via wrangler local persistence — no Drizzle mocks.
 * The `d1-http` driver is redirected to the `d1` binding driver so that SQL
 * actually executes against SQLite-backed D1 instances.
 */

import { describe, test, expect, vi } from "vitest";
import { getD1Pool, queryD1, tableExists, listTables, assertD1FilesExist } from "./helpers";

// ---------------------------------------------------------------------------
// Mock d1-http → real d1 binding driver (no HTTP calls)
// ---------------------------------------------------------------------------
vi.mock("@zpg6-test-pkgs/drizzle-orm/d1-http", async () => {
    const { drizzle: d1Drizzle } = await import("@zpg6-test-pkgs/drizzle-orm/d1");
    return {
        drizzle: (config: any, options?: any) => {
            const pool = (globalThis as any).__d1TestPool;
            const binding = pool.allocate(config.databaseId);
            return d1Drizzle(binding, options);
        },
    };
});

import {
    executeD1SQL,
    initializeTenantDatabase,
    applyTenantMigrations,
    getTenantMigrationStatus,
    defaultChecksumGenerator,
} from "../d1-utils";
import { CloudflareD1MultiTenancyError } from "../utils";

const baseConfig = { apiToken: "tok", accountId: "acct" };

// ---------------------------------------------------------------------------
// defaultChecksumGenerator – pure function, no mocks needed
// ---------------------------------------------------------------------------
describe("defaultChecksumGenerator", () => {
    test("should return a hex string", () => {
        const checksum = defaultChecksumGenerator("SELECT 1;");
        expect(checksum).toMatch(/^-?[0-9a-f]+$/);
    });

    test("should return the same checksum for the same input", () => {
        const sql = "CREATE TABLE t (id TEXT PRIMARY KEY);";
        expect(defaultChecksumGenerator(sql)).toBe(defaultChecksumGenerator(sql));
    });

    test("should return different checksums for different inputs", () => {
        expect(defaultChecksumGenerator("SELECT 1;")).not.toBe(defaultChecksumGenerator("SELECT 2;"));
    });

    test("should handle empty string", () => {
        const checksum = defaultChecksumGenerator("");
        expect(typeof checksum).toBe("string");
    });
});

// ---------------------------------------------------------------------------
// executeD1SQL – real D1 via local persistence
// ---------------------------------------------------------------------------
describe("executeD1SQL", () => {
    test("should execute a single SQL statement and create a real table", async () => {
        const pool = getD1Pool();
        const dbId = "exec-single-001";

        await executeD1SQL(baseConfig, dbId, "CREATE TABLE exec_single (id TEXT PRIMARY KEY, name TEXT);");

        // Verify the table was actually created via D1 binding
        const binding = pool.get(dbId);
        expect(await tableExists(binding, "exec_single")).toBe(true);

        // Verify SQLite files are persisted to disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should split on statement-breakpoints and execute each statement separately", async () => {
        const pool = getD1Pool();
        const dbId = "exec-split-002";

        const sql =
            "CREATE TABLE split_a (id TEXT PRIMARY KEY);\n--> statement-breakpoint\nCREATE TABLE split_b (id TEXT PRIMARY KEY);";

        await executeD1SQL(baseConfig, dbId, sql);

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "split_a")).toBe(true);
        expect(await tableExists(binding, "split_b")).toBe(true);

        // Both tables should appear in the listing
        const tables = await listTables(binding);
        expect(tables).toContain("split_a");
        expect(tables).toContain("split_b");

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should skip empty segments after splitting", async () => {
        const pool = getD1Pool();
        const dbId = "exec-empty-003";

        const sql =
            "--> statement-breakpoint\nCREATE TABLE skip_empty (id TEXT PRIMARY KEY);\n--> statement-breakpoint\n";

        await executeD1SQL(baseConfig, dbId, sql);

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "skip_empty")).toBe(true);

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should log statements when debugLogs is true", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await executeD1SQL(
            { ...baseConfig, debugLogs: true },
            "exec-debug-004",
            "CREATE TABLE debug_table (id TEXT PRIMARY KEY);"
        );

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test("should actually insert and persist data", async () => {
        const pool = getD1Pool();
        const dbId = "exec-data-005";

        await executeD1SQL(
            baseConfig,
            dbId,
            "CREATE TABLE data_test (id TEXT PRIMARY KEY, value TEXT);"
        );
        await executeD1SQL(
            baseConfig,
            dbId,
            "INSERT INTO data_test (id, value) VALUES ('row1', 'hello');"
        );

        const binding = pool.get(dbId);
        const rows = await queryD1(binding, "SELECT * FROM data_test WHERE id = ?", "row1");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ id: "row1", value: "hello" });

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should throw CLOUDFLARE_D1_API_ERROR on invalid SQL", async () => {
        await expect(
            executeD1SQL(baseConfig, "exec-bad-006", "THIS IS NOT VALID SQL;")
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            await executeD1SQL(baseConfig, "exec-bad-006b", "INVALID;");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });
});

// ---------------------------------------------------------------------------
// initializeTenantDatabase – real D1 via local persistence
// ---------------------------------------------------------------------------
describe("initializeTenantDatabase", () => {
    test("should execute schema SQL and return schema and version", async () => {
        const pool = getD1Pool();
        const dbId = "init-basic-001";

        const result = await initializeTenantDatabase(baseConfig, dbId, {
            currentSchema: "CREATE TABLE init_basic (id TEXT PRIMARY KEY, name TEXT);",
            currentVersion: "v1.0.0",
        });

        expect(result.schema).toBe("CREATE TABLE init_basic (id TEXT PRIMARY KEY, name TEXT);");
        expect(result.version).toBe("v1.0.0");

        // Verify the table was actually created via D1 binding
        const binding = pool.get(dbId);
        expect(await tableExists(binding, "init_basic")).toBe(true);

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should resolve schema and version from functions", async () => {
        const pool = getD1Pool();
        const dbId = "init-func-002";

        const result = await initializeTenantDatabase(baseConfig, dbId, {
            currentSchema: () => "CREATE TABLE init_func (id TEXT PRIMARY KEY);",
            currentVersion: () => "v2.0.0",
        });

        expect(result.version).toBe("v2.0.0");

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "init_func")).toBe(true);

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should resolve schema and version from async functions", async () => {
        const pool = getD1Pool();
        const dbId = "init-async-003";

        const result = await initializeTenantDatabase(baseConfig, dbId, {
            currentSchema: async () => "CREATE TABLE init_async (id TEXT PRIMARY KEY);",
            currentVersion: async () => "v3.0.0",
        });

        expect(result.schema).toBe("CREATE TABLE init_async (id TEXT PRIMARY KEY);");
        expect(result.version).toBe("v3.0.0");

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "init_async")).toBe(true);

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should throw DATABASE_CREATION_FAILED when schema is empty", async () => {
        await expect(
            initializeTenantDatabase(baseConfig, "init-empty-004", {
                currentSchema: "",
                currentVersion: "v1.0.0",
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            await initializeTenantDatabase(baseConfig, "init-empty-004b", {
                currentSchema: "   ",
                currentVersion: "v1.0.0",
            });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });

    test("should throw DATABASE_CREATION_FAILED when SQL is invalid", async () => {
        await expect(
            initializeTenantDatabase(baseConfig, "init-bad-005", {
                currentSchema: "NOT VALID SQL AT ALL;",
                currentVersion: "v1.0.0",
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            await initializeTenantDatabase(baseConfig, "init-bad-005b", {
                currentSchema: "BAD SQL;",
                currentVersion: "v1.0.0",
            });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });

    test("should create multi-table schema with statement-breakpoints", async () => {
        const pool = getD1Pool();
        const dbId = "init-multi-006";

        const schema = `CREATE TABLE documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL
        );
        --> statement-breakpoint
        CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL
        );`;

        await initializeTenantDatabase(baseConfig, dbId, {
            currentSchema: schema,
            currentVersion: "v1.0.0",
        });

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "documents")).toBe(true);
        expect(await tableExists(binding, "attachments")).toBe(true);

        // Both tables should appear in the listing
        const tables = await listTables(binding);
        expect(tables).toContain("documents");
        expect(tables).toContain("attachments");

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });
});

// ---------------------------------------------------------------------------
// applyTenantMigrations – real D1 via local persistence
// ---------------------------------------------------------------------------
describe("applyTenantMigrations", () => {
    test("should apply each migration in order", async () => {
        const pool = getD1Pool();
        const dbId = "migrate-order-001";

        await applyTenantMigrations(baseConfig, dbId, [
            "CREATE TABLE mig_a (id TEXT PRIMARY KEY);",
            "CREATE TABLE mig_b (id TEXT PRIMARY KEY);",
        ]);

        const binding = pool.get(dbId);
        expect(await tableExists(binding, "mig_a")).toBe(true);
        expect(await tableExists(binding, "mig_b")).toBe(true);

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });

    test("should do nothing for empty migrations array", async () => {
        await applyTenantMigrations(baseConfig, "migrate-empty-002", []);
        // No error = success
    });

    test("should throw DATABASE_CREATION_FAILED when a migration fails", async () => {
        await expect(
            applyTenantMigrations(baseConfig, "migrate-bad-003", ["NOT VALID SQL;"])
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            await applyTenantMigrations(baseConfig, "migrate-bad-003b", ["BAD SQL;"]);
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });

    test("should apply ALTER TABLE migration after initial schema", async () => {
        const pool = getD1Pool();
        const dbId = "migrate-alter-004";

        // Initial schema
        await executeD1SQL(
            baseConfig,
            dbId,
            "CREATE TABLE evolving (id TEXT PRIMARY KEY, name TEXT);"
        );

        // Migration adds a column
        await applyTenantMigrations(baseConfig, dbId, [
            "ALTER TABLE evolving ADD COLUMN email TEXT;",
        ]);

        // Verify by inserting data with the new column
        const binding = pool.get(dbId);
        await binding.exec("INSERT INTO evolving (id, name, email) VALUES ('1', 'test', 'a@b.com');");
        const rows = await queryD1(binding, "SELECT * FROM evolving WHERE id = ?", "1");
        expect(rows[0]).toEqual({ id: "1", name: "test", email: "a@b.com" });

        // SQLite files are on disk
        assertD1FilesExist(pool.persistDir);
    });
});

// ---------------------------------------------------------------------------
// getTenantMigrationStatus – uses Better Auth adapter mock (no D1)
// ---------------------------------------------------------------------------
describe("getTenantMigrationStatus", () => {
    test("should return currentVersion and empty migrationHistory for new tenant", async () => {
        const mockAdapter = {
            findOne: vi.fn<any>().mockResolvedValue({
                tenantId: "tenant-1",
                lastMigrationVersion: "v1.0.0",
                migrationHistory: null,
            }),
        };

        const result = await getTenantMigrationStatus(mockAdapter, "tenant-1", "user");

        expect(result.currentVersion).toBe("v1.0.0");
        expect(result.migrationHistory).toEqual([]);
    });

    test("should parse JSON migrationHistory when present", async () => {
        const history = [{ version: "v1.0.0", appliedAt: "2024-01-01" }];
        const mockAdapter = {
            findOne: vi.fn<any>().mockResolvedValue({
                tenantId: "tenant-1",
                lastMigrationVersion: "v1.0.0",
                migrationHistory: JSON.stringify(history),
            }),
        };

        const result = await getTenantMigrationStatus(mockAdapter, "tenant-1", "user");

        expect(result.migrationHistory).toEqual(history);
    });

    test("should return 'unknown' version when lastMigrationVersion is not set", async () => {
        const mockAdapter = {
            findOne: vi.fn<any>().mockResolvedValue({
                tenantId: "tenant-1",
            }),
        };

        const result = await getTenantMigrationStatus(mockAdapter, "tenant-1", "user");

        expect(result.currentVersion).toBe("unknown");
    });

    test("should throw DATABASE_CREATION_FAILED when tenant is not found", async () => {
        const mockAdapter = {
            findOne: vi.fn<any>().mockResolvedValue(null),
        };

        await expect(getTenantMigrationStatus(mockAdapter, "missing", "user")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            mockAdapter.findOne.mockResolvedValueOnce(null);
            await getTenantMigrationStatus(mockAdapter, "missing", "user");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });

    test("should throw DATABASE_CREATION_FAILED when adapter rejects", async () => {
        const mockAdapter = {
            findOne: vi.fn<any>().mockRejectedValue(new Error("DB offline")),
        };

        await expect(getTenantMigrationStatus(mockAdapter, "tenant-1", "user")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );
    });

    test("should query with correct model and where clause", async () => {
        const mockAdapter = {
            findOne: vi.fn<any>().mockResolvedValue({
                tenantId: "org-1",
                lastMigrationVersion: "v2",
            }),
        };

        await getTenantMigrationStatus(mockAdapter, "org-1", "organization");

        expect(mockAdapter.findOne).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "tenant",
                where: expect.arrayContaining([
                    expect.objectContaining({ field: "tenantId", value: "org-1" }),
                    expect.objectContaining({ field: "tenantType", value: "organization" }),
                ]),
            })
        );
    });
});
