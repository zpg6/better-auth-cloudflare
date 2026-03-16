/**
 * Tests for D1 Database Utilities (executeD1SQL, initializeTenantDatabase, etc.)
 * Drizzle ORM is mocked so that no real HTTP calls are made.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Drizzle ORM before any imports that pull in the real module
// ---------------------------------------------------------------------------
const { mockRun, mockDb } = vi.hoisted(() => {
    const mockRun = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockDb = { run: mockRun };
    return { mockRun, mockDb };
});

vi.mock("@zpg6-test-pkgs/drizzle-orm/d1-http", () => ({
    drizzle: vi.fn(() => mockDb),
}));

vi.mock("@zpg6-test-pkgs/drizzle-orm", () => ({
    sql: Object.assign(
        (_strings: TemplateStringsArray, ..._values: unknown[]) => ({ __sql: true }),
        {
            raw: vi.fn((str: string) => ({ __sql: true, rawStr: str })),
        }
    ),
}));

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
// executeD1SQL – Drizzle's db.run is mocked
// ---------------------------------------------------------------------------
describe("executeD1SQL", () => {
    beforeEach(() => {
        mockRun.mockClear();
    });

    test("should execute a single SQL statement", async () => {
        await executeD1SQL(baseConfig, "db-id-1", "CREATE TABLE t (id TEXT);");

        expect(mockRun).toHaveBeenCalledTimes(1);
    });

    test("should split on statement-breakpoints and execute each statement separately", async () => {
        const sql =
            "CREATE TABLE a (id TEXT);\n--> statement-breakpoint\nCREATE TABLE b (id TEXT);";

        await executeD1SQL(baseConfig, "db-id-1", sql);

        expect(mockRun).toHaveBeenCalledTimes(2);
    });

    test("should skip empty segments after splitting", async () => {
        const sql =
            "--> statement-breakpoint\nCREATE TABLE t (id TEXT);\n--> statement-breakpoint\n";

        await executeD1SQL(baseConfig, "db-id-1", sql);

        // Only one non-empty statement
        expect(mockRun).toHaveBeenCalledTimes(1);
    });

    test("should log statements when debugLogs is true", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        await executeD1SQL(
            { ...baseConfig, debugLogs: true },
            "db-id-1",
            "CREATE TABLE t (id TEXT);"
        );

        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    test("should throw INVALID_CREDENTIALS on authentication error from Drizzle", async () => {
        mockRun.mockRejectedValueOnce(new Error("authentication failed unexpectedly"));

        await expect(executeD1SQL(baseConfig, "db-id-1", "SELECT 1;")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            mockRun.mockRejectedValueOnce(new Error("authentication failed"));
            await executeD1SQL(baseConfig, "db-id-1", "SELECT 1;");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("INVALID_CREDENTIALS");
        }
    });

    test("should throw CLOUDFLARE_D1_API_ERROR on generic Drizzle error", async () => {
        mockRun.mockRejectedValueOnce(new Error("connection timeout"));

        await expect(executeD1SQL(baseConfig, "db-id-1", "SELECT 1;")).rejects.toThrow(
            CloudflareD1MultiTenancyError
        );

        try {
            mockRun.mockRejectedValueOnce(new Error("connection timeout"));
            await executeD1SQL(baseConfig, "db-id-1", "SELECT 1;");
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("CLOUDFLARE_D1_API_ERROR");
        }
    });
});

// ---------------------------------------------------------------------------
// initializeTenantDatabase – relies on executeD1SQL (Drizzle mocked)
// ---------------------------------------------------------------------------
describe("initializeTenantDatabase", () => {
    beforeEach(() => {
        mockRun.mockClear().mockResolvedValue(undefined);
    });

    test("should execute schema SQL and return schema and version", async () => {
        const result = await initializeTenantDatabase(baseConfig, "db-id-2", {
            currentSchema: "CREATE TABLE t (id TEXT);",
            currentVersion: "v1.0.0",
        });

        expect(result.schema).toBe("CREATE TABLE t (id TEXT);");
        expect(result.version).toBe("v1.0.0");
        expect(mockRun).toHaveBeenCalledTimes(1);
    });

    test("should resolve schema and version from functions", async () => {
        const result = await initializeTenantDatabase(baseConfig, "db-id-2", {
            currentSchema: () => "CREATE TABLE t (id TEXT);",
            currentVersion: () => "v2.0.0",
        });

        expect(result.version).toBe("v2.0.0");
    });

    test("should resolve schema and version from async functions", async () => {
        const result = await initializeTenantDatabase(baseConfig, "db-id-2", {
            currentSchema: async () => "CREATE TABLE async_t (id TEXT);",
            currentVersion: async () => "v3.0.0",
        });

        expect(result.schema).toBe("CREATE TABLE async_t (id TEXT);");
        expect(result.version).toBe("v3.0.0");
    });

    test("should throw DATABASE_CREATION_FAILED when schema is empty", async () => {
        await expect(
            initializeTenantDatabase(baseConfig, "db-id-2", {
                currentSchema: "",
                currentVersion: "v1.0.0",
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            await initializeTenantDatabase(baseConfig, "db-id-2", {
                currentSchema: "   ",
                currentVersion: "v1.0.0",
            });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });

    test("should throw DATABASE_CREATION_FAILED when Drizzle run fails", async () => {
        mockRun.mockRejectedValueOnce(new Error("disk full"));

        await expect(
            initializeTenantDatabase(baseConfig, "db-id-2", {
                currentSchema: "CREATE TABLE t (id TEXT);",
                currentVersion: "v1.0.0",
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            mockRun.mockRejectedValueOnce(new Error("disk full"));
            await initializeTenantDatabase(baseConfig, "db-id-2", {
                currentSchema: "CREATE TABLE t (id TEXT);",
                currentVersion: "v1.0.0",
            });
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });
});

// ---------------------------------------------------------------------------
// applyTenantMigrations – relies on executeD1SQL (Drizzle mocked)
// ---------------------------------------------------------------------------
describe("applyTenantMigrations", () => {
    beforeEach(() => {
        mockRun.mockClear().mockResolvedValue(undefined);
    });

    test("should apply each migration in order", async () => {
        await applyTenantMigrations(baseConfig, "db-id-3", [
            "CREATE TABLE a (id TEXT);",
            "CREATE TABLE b (id TEXT);",
        ]);

        expect(mockRun).toHaveBeenCalledTimes(2);
    });

    test("should do nothing for empty migrations array", async () => {
        await applyTenantMigrations(baseConfig, "db-id-3", []);

        expect(mockRun).not.toHaveBeenCalled();
    });

    test("should throw DATABASE_CREATION_FAILED when a migration fails", async () => {
        mockRun.mockRejectedValueOnce(new Error("syntax error"));

        await expect(
            applyTenantMigrations(baseConfig, "db-id-3", ["BAD SQL;"])
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        try {
            mockRun.mockRejectedValueOnce(new Error("syntax error"));
            await applyTenantMigrations(baseConfig, "db-id-3", ["BAD SQL;"]);
        } catch (e) {
            expect((e as CloudflareD1MultiTenancyError).code).toBe("DATABASE_CREATION_FAILED");
        }
    });
});

// ---------------------------------------------------------------------------
// getTenantMigrationStatus – uses Better Auth adapter mock (no Drizzle)
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
