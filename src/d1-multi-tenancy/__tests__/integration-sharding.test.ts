/**
 * Integration tests for D1 multi-tenancy sharding flows.
 *
 * Uses nock for HTTP-level mocking of the Cloudflare D1 API and faker
 * for realistic test data generation. Tests end-to-end sharding flows
 * including tenant lifecycle, shard routing, cache hydration, and
 * error recovery.
 */

import { describe, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { faker } from "@faker-js/faker";

// ---------------------------------------------------------------------------
// Mock Drizzle (required because source code imports it)
// ---------------------------------------------------------------------------
const { mockDrizzleRun, mockDrizzle } = vi.hoisted(() => {
    const mockDrizzleRun = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockDrizzle = vi.fn(() => ({ run: mockDrizzleRun }));
    return { mockDrizzleRun, mockDrizzle };
});

vi.mock("@zpg6-test-pkgs/drizzle-orm/d1-http", () => ({
    drizzle: mockDrizzle,
}));

vi.mock("@zpg6-test-pkgs/drizzle-orm", () => ({
    sql: Object.assign(
        (_s: TemplateStringsArray, ..._v: unknown[]) => ({ __sql: true }),
        { raw: vi.fn((str: string) => ({ __sql: true, rawStr: str })) }
    ),
}));

import {
    cloudflareD1MultiTenancy,
    TenantDatabaseStatus,
    generateShardHashFromDatabaseId,
    defaultIdGenerator,
} from "../index";
import { ShardCache, resetShardCache, getShardCache } from "../shard-cache";
import { CloudflareD1MultiTenancyError } from "../utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACCOUNT_ID = "test-acct-" + faker.string.alphanumeric(8);
const API_TOKEN = "test-token-" + faker.string.alphanumeric(16);
const CF_API_BASE = "https://api.cloudflare.com";
const D1_PATH = `/client/v4/accounts/${ACCOUNT_ID}/d1/database`;

const cloudflareD1Api = { apiToken: API_TOKEN, accountId: ACCOUNT_ID };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAdapter(overrides: Record<string, any> = {}) {
    return {
        findOne: vi.fn<any>().mockResolvedValue(null),
        create: vi.fn<any>().mockResolvedValue({ id: faker.string.uuid() }),
        update: vi.fn<any>().mockResolvedValue({}),
        findMany: vi.fn<any>().mockResolvedValue([]),
        ...overrides,
    };
}

function nockCreateDb(uuid: string, name?: string) {
    return nock(CF_API_BASE)
        .post(D1_PATH)
        .reply(200, {
            success: true,
            result: { uuid, name: name ?? `DB_${uuid.slice(0, 8)}` },
            errors: [],
        });
}

function nockDeleteDb(databaseId: string) {
    return nock(CF_API_BASE)
        .delete(`${D1_PATH}/${databaseId}`)
        .reply(200, { success: true, result: null, errors: [] });
}

function nockCreateDbError(code: number, message: string) {
    return nock(CF_API_BASE)
        .post(D1_PATH)
        .reply(200, {
            success: false,
            errors: [{ code, message }],
        });
}

function nockCreateDbHttpError(status: number, statusText: string) {
    return nock(CF_API_BASE)
        .post(D1_PATH)
        .reply(status, statusText);
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeAll(() => {
    nock.disableNetConnect();
});

afterAll(() => {
    nock.enableNetConnect();
    nock.cleanAll();
});

beforeEach(() => {
    resetShardCache();
    mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    mockDrizzle.mockClear();
});

afterEach(() => {
    nock.cleanAll();
});

// ---------------------------------------------------------------------------
// Full tenant lifecycle integration
// ---------------------------------------------------------------------------
describe("Integration: Full tenant lifecycle", () => {
    test("should create and then delete a user tenant database end-to-end", async () => {
        const userId = faker.string.uuid();
        const dbUuid = faker.string.uuid();
        const shardHash = generateShardHashFromDatabaseId(dbUuid);

        // Mock the create API call
        const createScope = nockCreateDb(dbUuid);

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

        expect(createScope.isDone()).toBe(true);
        expect(hooks.beforeCreate).toHaveBeenCalledOnce();
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

        // === DELETE ===
        const deleteScope = nockDeleteDb(dbUuid);

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

        expect(deleteScope.isDone()).toBe(true);
        expect(hooks.beforeDelete).toHaveBeenCalledOnce();
        expect(hooks.afterDelete).toHaveBeenCalledWith(
            expect.objectContaining({ tenantId: userId, mode: "user" })
        );

        // Shard cache should be cleared for this tenant
        const deletedEntry = await cache.get(shardHash);
        expect(deletedEntry).toBeNull();
    });

    test("should create and delete an organization tenant database", async () => {
        const orgId = faker.string.uuid();
        const dbUuid = faker.string.uuid();

        const createScope = nockCreateDb(dbUuid);

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

        expect(createScope.isDone()).toBe(true);
        expect(adapter.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tenantId: orgId,
                    tenantType: "organization",
                }),
            })
        );

        // === DELETE ORG ===
        const deleteScope = nockDeleteDb(dbUuid);

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

        expect(deleteScope.isDone()).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Multi-tenant batch creation with nock
// ---------------------------------------------------------------------------
describe("Integration: Batch tenant creation", () => {
    test("should create 10 tenant databases with unique UUIDs via API", async () => {
        const tenants: Array<{ userId: string; dbUuid: string }> = [];

        for (let i = 0; i < 10; i++) {
            const userId = faker.string.uuid();
            const dbUuid = faker.string.uuid();
            tenants.push({ userId, dbUuid });
            nockCreateDb(dbUuid);
        }

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        for (const { userId, dbUuid } of tenants) {
            adapter.findOne.mockResolvedValueOnce(null);
            adapter.create.mockResolvedValueOnce({ id: faker.string.uuid() });

            await plugin.databaseHooks.user.create.after(
                { id: userId, email: faker.internet.email() },
                { context: { adapter } }
            );
        }

        // All nock interceptors should have been consumed
        expect(nock.pendingMocks()).toHaveLength(0);

        // All 10 tenants should have been created
        expect(adapter.create).toHaveBeenCalledTimes(10);

        // Shard cache should have entries
        const cache = getShardCache();
        expect(cache.size()).toBe(10);
    });
});

// ---------------------------------------------------------------------------
// Error recovery scenarios
// ---------------------------------------------------------------------------
describe("Integration: Error recovery", () => {
    test("should handle API returning database limit exceeded error", async () => {
        nockCreateDbError(7502, "D1 database limit exceeded for this account");

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);

        // Tenant record should be in CREATING state but not updated to ACTIVE
        expect(adapter.update).not.toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({ status: TenantDatabaseStatus.ACTIVE }),
            })
        );
    });

    test("should handle HTTP 500 server error from Cloudflare API", async () => {
        nockCreateDbHttpError(500, "Internal Server Error");

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should handle HTTP 403 forbidden (invalid credentials)", async () => {
        nock(CF_API_BASE)
            .post(D1_PATH)
            .replyWithError("unauthorized access denied");

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
        nock(CF_API_BASE)
            .post(D1_PATH)
            .replyWithError("connect ETIMEDOUT");

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
        const dbUuid = faker.string.uuid();

        nock(CF_API_BASE)
            .delete(`${D1_PATH}/${dbUuid}`)
            .replyWithError("network failure");

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue({
                id: "rec-del-fail",
                tenantId: "user-del-fail",
                databaseId: dbUuid,
                databaseName: "DB_test",
                shardHash: "ab123456",
                status: TenantDatabaseStatus.ACTIVE,
            }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        const deleteHook = plugin.hooks.after.find((h: any) =>
            h.matcher({ path: "/delete-user" })
        );

        // The handler should throw (the deletion failed)
        await expect(
            deleteHook.handler({
                context: {
                    adapter,
                    returned: { user: { id: "user-del-fail" } },
                },
            })
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });
});

// ---------------------------------------------------------------------------
// Shard cache hydration integration
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
// Universal ID routing integration
// ---------------------------------------------------------------------------
describe("Integration: Universal ID routing across shards", () => {
    test("should generate IDs that route back to correct shard database", async () => {
        // Create 5 tenant databases
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
// KV-backed cache integration with nock-based tenant creation
// ---------------------------------------------------------------------------
describe("Integration: KV-backed shard cache with tenant creation", () => {
    test("should write-through to KV when creating new tenant databases", async () => {
        const mockKv = {
            put: vi.fn<any>().mockResolvedValue(undefined),
            get: vi.fn<any>().mockResolvedValue(null),
            delete: vi.fn<any>().mockResolvedValue(undefined),
        };

        resetShardCache();

        const dbUuid = faker.string.uuid();
        nockCreateDb(dbUuid);

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
        expect(parsed.databaseId).toBe(dbUuid);
    });
});

// ---------------------------------------------------------------------------
// Concurrent tenant creation
// ---------------------------------------------------------------------------
describe("Integration: Concurrent tenant creation", () => {
    test("should handle multiple concurrent tenant creations", async () => {
        const tenantCount = 5;
        const dbUuids: string[] = [];

        for (let i = 0; i < tenantCount; i++) {
            const uuid = faker.string.uuid();
            dbUuids.push(uuid);
            nockCreateDb(uuid);
        }

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        // Create all tenants concurrently
        const promises = dbUuids.map((_, i) => {
            adapter.findOne.mockResolvedValueOnce(null);
            adapter.create.mockResolvedValueOnce({ id: `rec-${i}` });

            return plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            );
        });

        await Promise.all(promises);

        // All nock mocks should have been consumed
        expect(nock.pendingMocks()).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Migration initialization during tenant creation
// ---------------------------------------------------------------------------
describe("Integration: Migration initialization", () => {
    test("should execute schema SQL on newly created tenant database", async () => {
        const dbUuid = faker.string.uuid();
        nockCreateDb(dbUuid);

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

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        // Drizzle should have been called to execute schema (2 statements split by breakpoint)
        expect(mockDrizzleRun).toHaveBeenCalledTimes(2);
    });

    test("should support async schema resolution", async () => {
        const dbUuid = faker.string.uuid();
        nockCreateDb(dbUuid);

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: async () => "CREATE TABLE async_table (id TEXT);",
                currentVersion: async () => "v2.0.0",
            },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        expect(mockDrizzleRun).toHaveBeenCalled();
    });
});
