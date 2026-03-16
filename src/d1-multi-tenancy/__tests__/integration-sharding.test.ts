/**
 * Integration tests for D1 multi-tenancy sharding flows.
 *
 * Uses real local D1 databases via wrangler local persistence.
 * Cloudflare REST API calls are intercepted and redirected to real
 * local D1 operations — no HTTP mocking.  Data is verified on the
 * filesystem via node:fs and through direct D1 binding queries.
 */

import { describe, test, expect, vi } from "vitest";
import { faker } from "@faker-js/faker";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// Redirect d1-http drizzle to real D1 binding driver
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
    cloudflareD1MultiTenancy,
    TenantDatabaseStatus,
    generateShardHashFromDatabaseId,
    defaultIdGenerator,
} from "../index";
import { ShardCache, getShardCache } from "../shard-cache";
import { CloudflareD1MultiTenancyError } from "../utils";
import {
    getD1Pool,
    makeAdapter,
    tableExists,
    queryD1,
    assertD1FilesExist,
    createErrorD1Fetch,
    listD1SqliteFiles,
    listTables,
    getD1SqliteDir,
} from "./helpers";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACCOUNT_ID = "test-acct-" + faker.string.alphanumeric(8);
const API_TOKEN = "test-token-" + faker.string.alphanumeric(16);

const cloudflareD1Api = { apiToken: API_TOKEN, accountId: ACCOUNT_ID };

// ---------------------------------------------------------------------------
// Integration: Full tenant lifecycle
// ---------------------------------------------------------------------------
describe("Integration: Full tenant lifecycle", () => {
    test("should create and then delete a user tenant database end-to-end", async () => {
        const userId = faker.string.uuid();

        const adapter = makeAdapter();
        const hooks = {
            beforeCreate: vi.fn(),
            afterCreate: vi.fn(),
            beforeDelete: vi.fn(),
            afterDelete: vi.fn(),
        };

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            hooks,
        }) as any;

        // === CREATE ===
        await plugin.databaseHooks.user.create.after(
            { id: userId, email: faker.internet.email() },
            { context: { adapter } }
        );

        expect(hooks.beforeCreate).toHaveBeenCalledOnce();

        // Extract the database UUID from the adapter.update call (set by the interceptor)
        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        expect(dbUuid).toBeTruthy();

        const shardHash = generateShardHashFromDatabaseId(dbUuid);

        expect(hooks.afterCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                tenantId: userId,
                databaseId: dbUuid,
                mode: "user",
            })
        );

        // Shard cache should now contain this tenant
        const cache = getShardCache();
        const cachedEntry = await cache.get(shardHash);
        expect(cachedEntry).not.toBeNull();
        expect(cachedEntry!.databaseId).toBe(dbUuid);

        // SQLite files should exist on disk
        const pool = getD1Pool();
        assertD1FilesExist(pool.persistDir);

        // === DELETE ===
        // Simulate the adapter returning the active tenant for lookup
        adapter.findOne.mockResolvedValueOnce({
            id: "rec-1",
            tenantId: userId,
            databaseId: dbUuid,
            databaseName: `DB_${shardHash}`,
            shardHash,
            status: TenantDatabaseStatus.ACTIVE,
        });

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );

        await deleteHook.handler({
            context: {
                adapter,
                returned: { user: { id: userId } },
            },
        });

        expect(hooks.beforeDelete).toHaveBeenCalledOnce();
        expect(hooks.afterDelete).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: userId, mode: "user" })
        );

        // Shard cache should be cleared for this tenant
        const deletedEntry = await cache.get(shardHash);
        expect(deletedEntry).toBeNull();

        // Tables should be dropped from the D1 binding after deletion
        const binding = pool.get(dbUuid);
        if (binding) {
            const tables = await listTables(binding);
            // User tables should have been dropped by the delete interceptor
            expect(tables).toHaveLength(0);
        }
    });

    test("should create and delete an organization tenant database", async () => {
        const orgId = faker.string.uuid();

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "organization",
        }) as any;

        // === CREATE ORG ===
        const createHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/create" })
        );

        await createHook.handler({
            context: {
                adapter,
                returned: { data: { id: orgId } },
                session: { user: { id: faker.string.uuid() } },
            },
        });

        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tenantId: orgId,
                    tenantType: "organization",
                }),
            })
        );

        // Extract the database UUID from adapter.update
        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        expect(dbUuid).toBeTruthy();

        // SQLite files should exist on disk
        const pool = getD1Pool();
        assertD1FilesExist(pool.persistDir);

        // === DELETE ORG ===
        adapter.findOne.mockResolvedValueOnce({
            id: "rec-org",
            tenantId: orgId,
            databaseId: dbUuid,
            databaseName: "DB_test",
            shardHash: null,
            status: TenantDatabaseStatus.ACTIVE,
        });

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/organization/delete" })
        );

        await deleteHook.handler({
            context: {
                adapter,
                session: { user: { id: faker.string.uuid() } },
            },
            body: { organizationId: orgId },
        });

        // Adapter should have updated status to DELETED
        const deleteUpdateCalls = adapter.update.mock.calls.map((c: any) => c[0]);
        const deletedUpdate = deleteUpdateCalls.find(
            (c: any) => c.update?.status === TenantDatabaseStatus.DELETED
        );
        expect(deletedUpdate).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Integration: Batch tenant creation
// ---------------------------------------------------------------------------
describe("Integration: Batch tenant creation", () => {
    test("should create 10 tenant databases via default fetch interceptor", async () => {
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        for (let i = 0; i < 10; i++) {
            await plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            );
        }

        // All 10 tenants should have been created
        expect(adapter.create).toHaveBeenCalledTimes(10);

        // Shard cache should have 10 entries
        const cache = getShardCache();
        expect(cache.size()).toBe(10);

        // Pool allocation count should reflect all 10 databases
        const pool = getD1Pool();
        expect(pool.allocationCount()).toBe(10);

        // SQLite files should exist on disk
        assertD1FilesExist(pool.persistDir);
    });
});

// ---------------------------------------------------------------------------
// Integration: Error recovery
// ---------------------------------------------------------------------------
describe("Integration: Error recovery", () => {
    test("should handle API returning database limit exceeded error", async () => {
        globalThis.fetch = createErrorD1Fetch({
            createError: { code: 7502, message: "D1 database limit exceeded for this account" },
        });

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        // Tenant record should not have been updated to ACTIVE
        const updateCalls = adapter.update.mock.calls.map((c: any) => c[0]);
        const activeUpdate = updateCalls.find(
            (c: any) => c.update?.status === TenantDatabaseStatus.ACTIVE
        );
        expect(activeUpdate).toBeUndefined();
    });

    test("should handle HTTP 500 server error from Cloudflare API", async () => {
        globalThis.fetch = createErrorD1Fetch({
            httpError: { status: 500, statusText: "Internal Server Error" },
        });

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should handle network error simulating auth failure", async () => {
        globalThis.fetch = createErrorD1Fetch({
            networkError: "unauthorized access denied",
        });

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should handle network timeout during database creation", async () => {
        globalThis.fetch = createErrorD1Fetch({
            networkError: "connect ETIMEDOUT",
        });

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should handle delete failure and not update status to DELETED", async () => {
        // First, create a tenant with the default (working) fetch
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        const userId = faker.string.uuid();

        await plugin.databaseHooks.user.create.after(
            { id: userId, email: faker.internet.email() },
            { context: { adapter } }
        );

        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        const shardHash = generateShardHashFromDatabaseId(dbUuid);

        // Now switch to an error fetch for the delete
        globalThis.fetch = createErrorD1Fetch({ deleteError: "network failure" });

        adapter.findOne.mockResolvedValueOnce({
            id: "rec-del-fail",
            tenantId: userId,
            databaseId: dbUuid,
            databaseName: `DB_${shardHash}`,
            shardHash,
            status: TenantDatabaseStatus.ACTIVE,
        });

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );

        await expect(
            deleteHook.handler({
                context: {
                    adapter,
                    returned: { user: { id: userId } },
                },
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        // Adapter should not have been updated to DELETED status
        const allUpdateCalls = adapter.update.mock.calls.map((c: any) => c[0]);
        const deletedUpdate = allUpdateCalls.find(
            (c: any) => c.update?.status === TenantDatabaseStatus.DELETED
        );
        expect(deletedUpdate).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Integration: Shard cache hydration
// ---------------------------------------------------------------------------
describe("Integration: Shard cache hydration", () => {
    test("should hydrate cache from adapter with realistic tenant data", async () => {
        const tenants = Array.from({ length: 25 }, () => {
            const dbUuid = faker.string.uuid();
            return {
                tenantId: faker.string.uuid(),
                databaseId: dbUuid,
                databaseName: `DB_${faker.date.past().toISOString().split("T")[0].replace(/-/g, "")}_${dbUuid.slice(0, 8)}`,
                shardHash: generateShardHashFromDatabaseId(dbUuid),
            };
        });

        const mockAdapter = {
            findMany: vi.fn<any>().mockResolvedValue(tenants),
        };

        const cache = new ShardCache({ debugLogs: false });
        await cache.hydrate(mockAdapter, "user");

        expect(cache.size()).toBe(25);
        expect(cache.isReady()).toBe(true);

        // Verify all tenants are cached correctly
        for (const tenant of tenants) {
            const entry = await cache.get(tenant.shardHash);
            expect(entry).not.toBeNull();
            expect(entry!.databaseId).toBe(tenant.databaseId);
            expect(entry!.tenantId).toBe(tenant.tenantId);
        }
    });

    test("should handle hydration failure gracefully", async () => {
        const mockAdapter = {
            findMany: vi.fn<any>().mockRejectedValue(new Error("DB connection failed")),
        };

        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const cache = new ShardCache();
        await cache.hydrate(mockAdapter, "user");

        // Should mark as hydrated to prevent blocking
        expect(cache.isReady()).toBe(true);
        expect(cache.size()).toBe(0);

        consoleSpy.mockRestore();
        warnSpy.mockRestore();
    });
});

// ---------------------------------------------------------------------------
// Integration: Universal ID routing across shards
// ---------------------------------------------------------------------------
describe("Integration: Universal ID routing across shards", () => {
    test("should generate IDs that route back to correct shard database", async () => {
        // Create 5 tenant database entries in the cache
        const tenantDbs = Array.from({ length: 5 }, () => {
            const dbUuid = faker.string.uuid();
            return {
                uuid: dbUuid,
                shardHash: generateShardHashFromDatabaseId(dbUuid),
                tenantId: faker.string.uuid(),
            };
        });

        // Populate shard cache
        const cache = new ShardCache();
        for (const db of tenantDbs) {
            cache.set({
                shardHash: db.shardHash,
                databaseId: db.uuid,
                tenantId: db.tenantId,
                databaseName: `DB_${db.shardHash}`,
            });
        }

        // Generate records for each tenant with different record types
        const recordTypes = ["document", "invoice", "message"];
        for (const db of tenantDbs) {
            for (const rt of recordTypes) {
                const id = defaultIdGenerator.generate({
                    shardHash: db.shardHash,
                    recordType: rt,
                });

                // Extract shard hash from the generated ID
                const extractedHash = defaultIdGenerator.extractShardHash(id);
                expect(extractedHash).toBe(db.shardHash);

                // Look up the database in cache
                const cached = await cache.get(extractedHash!);
                expect(cached).not.toBeNull();
                expect(cached!.databaseId).toBe(db.uuid);
                expect(cached!.tenantId).toBe(db.tenantId);
            }
        }
    });

    test("should not route non-Universal IDs through shard cache", async () => {
        const cache = new ShardCache();
        cache.set({
            shardHash: "abc12345",
            databaseId: "db-1",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        // Regular IDs (not Universal IDs) should not match
        const regularIds = [
            faker.string.uuid(),
            "simple-id-123",
            "usr_" + faker.string.alphanumeric(8),
        ];

        for (const id of regularIds) {
            const hash = defaultIdGenerator.extractShardHash(id);
            // Even if extraction succeeds, lookup should not match our cached entry
            // (unless the hash happens to match, which is extremely unlikely)
            if (hash && hash !== "abc12345") {
                const entry = await cache.get(hash);
                expect(entry).toBeNull();
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Integration: KV-backed shard cache with tenant creation
// ---------------------------------------------------------------------------
describe("Integration: KV-backed shard cache with tenant creation", () => {
    test("should write-through to KV when creating new tenant databases", async () => {
        const mockKv = {
            put: vi.fn<any>().mockResolvedValue(undefined),
            get: vi.fn<any>().mockResolvedValue(null),
            delete: vi.fn<any>().mockResolvedValue(undefined),
        };

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            kv: mockKv as any,
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        // Wait for fire-and-forget KV write
        await new Promise(resolve => setTimeout(resolve, 50));

        // KV should have received the shard cache entry
        expect(mockKv.put).toHaveBeenCalled();
        const [kvKey, kvValue] = mockKv.put.mock.calls[0];
        expect(kvKey).toMatch(/^shard:/);
        const parsed = JSON.parse(kvValue);
        // Extract the actual dbUuid from adapter.update to verify KV entry
        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        expect(parsed.databaseId).toBe(dbUuid);
    });
});

// ---------------------------------------------------------------------------
// Integration: Concurrent tenant creation
// ---------------------------------------------------------------------------
describe("Integration: Concurrent tenant creation", () => {
    test("should handle multiple concurrent tenant creations", async () => {
        const tenantCount = 5;
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        // Create all tenants concurrently using the default fetch interceptor
        const promises = Array.from({ length: tenantCount }, () =>
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        );

        await Promise.all(promises);

        // All 5 tenants should have been created
        expect(adapter.create).toHaveBeenCalledTimes(tenantCount);

        // Shard cache should have 5 entries
        const cache = getShardCache();
        expect(cache.size()).toBe(tenantCount);
    });
});

// ---------------------------------------------------------------------------
// Integration: Migration initialization with filesystem verification
// ---------------------------------------------------------------------------
describe("Integration: Migration initialization with filesystem verification", () => {
    test("should execute schema SQL on newly created tenant database", async () => {
        const schemaSQL = `CREATE TABLE documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            tenantId TEXT NOT NULL,
            createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        );
        --> statement-breakpoint
        CREATE TABLE attachments (
            id TEXT PRIMARY KEY,
            documentId TEXT NOT NULL,
            filename TEXT NOT NULL,
            tenantId TEXT NOT NULL
        );`;

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: schemaSQL,
                currentVersion: "v1.0.0",
            },
        }) as any;

        const userId = faker.string.uuid();
        await plugin.databaseHooks.user.create.after(
            { id: userId, email: faker.internet.email() },
            { context: { adapter } }
        );

        // Extract the database UUID from adapter.update
        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        expect(dbUuid).toBeTruthy();

        // Verify the tables were actually created in the real D1 database
        const pool = getD1Pool();
        const binding = pool.get(dbUuid);
        expect(binding).toBeDefined();
        expect(await tableExists(binding, "documents")).toBe(true);
        expect(await tableExists(binding, "attachments")).toBe(true);

        // Verify data can be inserted and read back
        const docId = faker.string.uuid();
        await queryD1(
            binding,
            "INSERT INTO documents (id, title, tenantId) VALUES (?, ?, ?)",
            docId,
            "Test Document",
            userId
        );
        const rows = await queryD1<{ id: string; title: string }>(
            binding,
            "SELECT id, title FROM documents WHERE id = ?",
            docId
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe("Test Document");

        // Verify SQLite files exist on disk
        const sqliteDir = getD1SqliteDir(pool.persistDir);
        expect(fs.existsSync(sqliteDir)).toBe(true);
        const files = listD1SqliteFiles(pool.persistDir);
        expect(files.length).toBeGreaterThan(0);
    });

    test("should support async schema resolution", async () => {
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: async () => "CREATE TABLE async_table (id TEXT PRIMARY KEY);",
                currentVersion: async () => "v2.0.0",
            },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        // Extract the database UUID from adapter.update
        const updateCall = adapter.update.mock.calls[0][0];
        const dbUuid = updateCall.update.databaseId;
        expect(dbUuid).toBeTruthy();

        // Verify the table was actually created in the real D1 database
        const pool = getD1Pool();
        const binding = pool.get(dbUuid);
        expect(binding).toBeDefined();
        expect(await tableExists(binding, "async_table")).toBe(true);
    });
});
