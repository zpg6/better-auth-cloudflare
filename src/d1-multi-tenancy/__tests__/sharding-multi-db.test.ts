/**
 * Tests for sharding functionality across multiple databases.
 *
 * Covers:
 * - Routing queries to the correct tenant database via Universal IDs
 * - Shard cache interactions across many tenants
 * - Database full scenario: simulating capacity limits and creating new DBs
 * - Data written to the correct shard database
 * - FIFO eviction when cache is full
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { faker } from "@faker-js/faker";

// ---------------------------------------------------------------------------
// Mock Drizzle
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
import { ShardCache, resetShardCache } from "../shard-cache";
import { CloudflareD1MultiTenancyError } from "../utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cloudflareD1Api = { apiToken: "test-token", accountId: "test-account" };

function makeAdapter(overrides: Record<string, any> = {}) {
    return {
        findOne: vi.fn<any>().mockResolvedValue(null),
        create: vi.fn<any>().mockResolvedValue({ id: faker.string.uuid() }),
        update: vi.fn<any>().mockResolvedValue({}),
        findMany: vi.fn<any>().mockResolvedValue([]),
        ...overrides,
    };
}

function mockFetchCreate(uuid: string) {
    return vi.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        json: async () => ({
            success: true,
            result: { uuid, name: `DB_20240101_${uuid.slice(0, 8)}` },
            errors: [],
        }),
    } as any);
}

// ---------------------------------------------------------------------------
// Multi-DB sharding – routing via Universal IDs
// ---------------------------------------------------------------------------
describe("Sharding across multiple databases", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
        mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should route records to different databases via shard hash", async () => {
        const dbUuid1 = faker.string.uuid();
        const dbUuid2 = faker.string.uuid();

        const hash1 = generateShardHashFromDatabaseId(dbUuid1);
        const hash2 = generateShardHashFromDatabaseId(dbUuid2);

        // Hashes for different UUIDs should be distinct
        expect(hash1).not.toBe(hash2);

        // Generate IDs embedding each shard hash
        const id1 = defaultIdGenerator.generate({ shardHash: hash1, recordType: "document" });
        const id2 = defaultIdGenerator.generate({ shardHash: hash2, recordType: "document" });

        // Extract and verify routing
        const extracted1 = defaultIdGenerator.extractShardHash(id1);
        const extracted2 = defaultIdGenerator.extractShardHash(id2);

        expect(extracted1).toBe(hash1);
        expect(extracted2).toBe(hash2);
        expect(extracted1).not.toBe(extracted2);
    });

    test("should create separate tenant databases for multiple users", async () => {
        const users = Array.from({ length: 5 }, () => ({
            id: faker.string.uuid(),
            email: faker.internet.email(),
        }));

        let callIndex = 0;
        const createdDbs: string[] = [];

        // Each user creation triggers a separate fetch for a new DB
        globalThis.fetch = vi.fn<typeof fetch>().mockImplementation(async () => {
            const uuid = faker.string.uuid();
            createdDbs.push(uuid);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    result: { uuid, name: `DB_${uuid.slice(0, 8)}` },
                    errors: [],
                }),
            } as any;
        });

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        for (const user of users) {
            adapter.findOne.mockResolvedValueOnce(null);
            adapter.create.mockResolvedValueOnce({ id: faker.string.uuid() });

            await plugin.databaseHooks.user.create.after(user, {
                context: { adapter },
            });
        }

        // Each user should get a unique database
        expect(createdDbs).toHaveLength(5);
        expect(new Set(createdDbs).size).toBe(5);

        // fetch should have been called once per user for DB creation
        expect(globalThis.fetch).toHaveBeenCalledTimes(5);
    });

    test("should populate shard cache with entries for each created database", async () => {
        const cache = new ShardCache({ debugLogs: false });

        const tenantCount = 10;
        for (let i = 0; i < tenantCount; i++) {
            const dbUuid = faker.string.uuid();
            const shardHash = generateShardHashFromDatabaseId(dbUuid);
            const tenantId = faker.string.uuid();

            cache.set({
                shardHash,
                databaseId: dbUuid,
                tenantId,
                databaseName: `DB_20240101_${shardHash}`,
            });
        }

        expect(cache.size()).toBe(tenantCount);

        // All entries should be retrievable
        const allEntries = cache.getAll();
        expect(allEntries).toHaveLength(tenantCount);
        for (const entry of allEntries) {
            const got = await cache.get(entry.shardHash);
            expect(got).not.toBeNull();
            expect(got!.databaseId).toBe(entry.databaseId);
        }
    });

    test("should handle shard hash collisions gracefully by overwriting", async () => {
        const cache = new ShardCache();

        // Force same shard hash for two different tenants (simulates collision)
        const shardHash = "collide1";
        cache.set({
            shardHash,
            databaseId: "db-1",
            tenantId: "tenant-old",
            databaseName: "DB_old",
        });

        cache.set({
            shardHash,
            databaseId: "db-2",
            tenantId: "tenant-new",
            databaseName: "DB_new",
        });

        // Latest entry wins
        const entry = await cache.get(shardHash);
        expect(entry!.databaseId).toBe("db-2");
        expect(entry!.tenantId).toBe("tenant-new");
        expect(cache.size()).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Database full scenario – simulating capacity and new DB creation
// ---------------------------------------------------------------------------
describe("Database full scenario", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        originalFetch = globalThis.fetch;
        resetShardCache();
        mockDrizzleRun.mockClear().mockResolvedValue(undefined);
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("should handle Cloudflare API error indicating database limit reached", async () => {
        // Simulate Cloudflare returning an error when DB limit is reached
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: false,
                errors: [
                    { code: 7502, message: "You have exceeded the maximum number of D1 databases for this account" },
                ],
            }),
        } as any);

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should handle fetch returning non-ok status (e.g. 429 rate limit)", async () => {
        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
        } as any);

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });

    test("should create a new database when previous tenant was deleted", async () => {
        // Simulate: first tenant was deleted, a new one should be created
        const freshUuid = faker.string.uuid();
        globalThis.fetch = mockFetchCreate(freshUuid);

        const adapter = makeAdapter({
            findOne: vi.fn<any>().mockResolvedValue({
                id: "old-rec",
                tenantId: "user-recycle",
                status: TenantDatabaseStatus.DELETED,
            }),
            create: vi.fn<any>().mockResolvedValue({ id: "new-rec" }),
        });

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-recycle", email: faker.internet.email() },
            { context: { adapter } }
        );

        // A new record should have been created
        expect(adapter.create).toHaveBeenCalled();
        // It should be updated to ACTIVE with the new DB UUID
        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    databaseId: freshUuid,
                    status: TenantDatabaseStatus.ACTIVE,
                }),
            })
        );
    });

    test("should handle migration failure during new DB initialization", async () => {
        const uuid = faker.string.uuid();
        globalThis.fetch = mockFetchCreate(uuid);

        // Drizzle run fails (simulates schema execution error on new DB)
        mockDrizzleRun.mockRejectedValueOnce(new Error("SQLITE_FULL: database or disk is full"));

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: "CREATE TABLE t (id TEXT);",
                currentVersion: "v1",
            },
        }) as any;

        await expect(
            plugin.databaseHooks.user.create.after(
                { id: faker.string.uuid(), email: faker.internet.email() },
                { context: { adapter } }
            )
        ).rejects.toThrow(CloudflareD1MultiTenancyError);
    });
});

// ---------------------------------------------------------------------------
// Data validation – ensuring data is written to the correct shard
// ---------------------------------------------------------------------------
describe("Data validation across shards", () => {
    test("should generate deterministic shard hashes for given database UUIDs", () => {
        const uuids = Array.from({ length: 20 }, () => faker.string.uuid());
        const hashMap = new Map<string, string>();

        for (const uuid of uuids) {
            const hash = generateShardHashFromDatabaseId(uuid);
            expect(hash).toHaveLength(8);

            // Same UUID always produces same hash
            expect(generateShardHashFromDatabaseId(uuid)).toBe(hash);

            hashMap.set(uuid, hash);
        }

        // Most hashes should be unique (very unlikely to collide with 20 samples)
        const uniqueHashes = new Set(hashMap.values());
        expect(uniqueHashes.size).toBeGreaterThan(15);
    });

    test("should embed correct shard hash in generated Universal IDs", () => {
        const dbUuid = faker.string.uuid();
        const shardHash = generateShardHashFromDatabaseId(dbUuid);

        const recordTypes = ["document", "invoice", "message", "attachment"];
        const ids = recordTypes.map(rt =>
            defaultIdGenerator.generate({ shardHash, recordType: rt })
        );

        // All IDs should contain the same shard hash
        for (const id of ids) {
            expect(defaultIdGenerator.extractShardHash(id)).toBe(shardHash);
        }

        // But all IDs should be unique
        expect(new Set(ids).size).toBe(ids.length);
    });

    test("should correctly decode all components of a Universal ID", () => {
        const shardHash = "abcd1234";
        const recordType = "birthday";

        const id = defaultIdGenerator.generate({ shardHash, recordType });
        const decoded = defaultIdGenerator.decode(id);

        expect(decoded).not.toBeNull();
        expect(decoded!.shardHash).toBe(shardHash);
        expect(decoded!.timestamp).toBeGreaterThan(0);
        expect(decoded!.timestamp).toBeLessThanOrEqual(Date.now());
        expect(decoded!.typeHash).toHaveLength(4);
        expect(decoded!.random).toHaveLength(10);
        expect(decoded!.id).toBe(id);
    });

    test("should track tenant status transitions correctly", async () => {
        const statusTransitions: string[] = [];

        const adapter = {
            findOne: vi.fn<any>().mockResolvedValue(null),
            create: vi.fn<any>().mockImplementation(async ({ data }: any) => {
                statusTransitions.push(data.status);
                return { id: "rec-1" };
            }),
            update: vi.fn<any>().mockImplementation(async ({ update }: any) => {
                if (update.status) statusTransitions.push(update.status);
                return {};
            }),
        };

        const uuid = faker.string.uuid();
        globalThis.fetch = mockFetchCreate(uuid);

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        // Status should transition: creating -> active
        expect(statusTransitions).toEqual([
            TenantDatabaseStatus.CREATING,
            TenantDatabaseStatus.ACTIVE,
        ]);

        globalThis.fetch = vi.fn<typeof fetch>().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, result: null, errors: [] }),
        } as any);
    });

    test("should store shard hash derived from database UUID in tenant record", async () => {
        const dbUuid = "aabbccdd-1122-3344-5566-778899001122";
        const expectedShardHash = generateShardHashFromDatabaseId(dbUuid);

        globalThis.fetch = mockFetchCreate(dbUuid);

        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-hash-check", email: "h@b.com" },
            { context: { adapter } }
        );

        // The update call should include the computed shard hash
        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    shardHash: expectedShardHash,
                    databaseId: dbUuid,
                }),
            })
        );
    });
});

// ---------------------------------------------------------------------------
// Cache eviction under load
// ---------------------------------------------------------------------------
describe("Shard cache FIFO eviction under load", () => {
    test("should evict oldest entries when cache reaches max capacity", async () => {
        const maxEntries = 5;
        const cache = new ShardCache({ maxEntries });

        // Fill cache to capacity
        const entries = Array.from({ length: maxEntries }, (_, i) => ({
            shardHash: `shard_${i}`,
            databaseId: faker.string.uuid(),
            tenantId: faker.string.uuid(),
            databaseName: `DB_${i}`,
        }));

        for (const entry of entries) {
            cache.set(entry);
        }
        expect(cache.size()).toBe(maxEntries);

        // Add one more – should evict shard_0 (oldest)
        cache.set({
            shardHash: "shard_new",
            databaseId: faker.string.uuid(),
            tenantId: faker.string.uuid(),
            databaseName: "DB_new",
        });

        expect(cache.size()).toBe(maxEntries);
        expect(await cache.get("shard_0")).toBeNull();
        expect(await cache.get("shard_new")).not.toBeNull();

        // shard_1 through shard_4 should still exist
        for (let i = 1; i < maxEntries; i++) {
            expect(await cache.get(`shard_${i}`)).not.toBeNull();
        }
    });

    test("should handle rapid set/get cycles under high tenant counts", async () => {
        const cache = new ShardCache({ maxEntries: 100, ttl: 0 });

        // Simulate 200 tenants being created
        const shardHashes: string[] = [];
        for (let i = 0; i < 200; i++) {
            const uuid = faker.string.uuid();
            const hash = generateShardHashFromDatabaseId(uuid);
            shardHashes.push(hash);

            cache.set({
                shardHash: hash,
                databaseId: uuid,
                tenantId: `tenant-${i}`,
                databaseName: `DB_${i}`,
            });
        }

        // Only 100 should remain (maxEntries)
        expect(cache.size()).toBe(100);

        // Last 100 should be accessible
        for (let i = 100; i < 200; i++) {
            const entry = await cache.get(shardHashes[i]);
            expect(entry).not.toBeNull();
            expect(entry!.tenantId).toBe(`tenant-${i}`);
        }
    });
});
