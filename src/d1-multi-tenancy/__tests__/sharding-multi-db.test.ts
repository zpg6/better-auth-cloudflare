/**
 * Tests for sharding functionality across multiple databases.
 *
 * Uses real D1 via wrangler local persistence for SQL execution.
 * Covers:
 * - Routing queries to the correct tenant database via Universal IDs
 * - Shard cache interactions across many tenants
 * - Database full scenario: simulating capacity limits and creating new DBs
 * - Data written to the correct shard database
 * - FIFO eviction when cache is full
 */

import { describe, test, expect, vi } from "vitest";
import { faker } from "@faker-js/faker";
import {
    getD1Pool,
    makeAdapter,
    tableExists,
    queryD1,
    assertD1FilesExist,
    createErrorD1Fetch,
} from "./helpers";

// ---------------------------------------------------------------------------
// Mock d1-http → real d1 binding driver
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
import { ShardCache } from "../shard-cache";
import { CloudflareD1MultiTenancyError } from "../utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const cloudflareD1Api = { apiToken: "test-token", accountId: "test-account" };

// ---------------------------------------------------------------------------
// Multi-DB sharding – routing via Universal IDs
// ---------------------------------------------------------------------------
describe("Sharding across multiple databases", () => {
    test("should route records to different databases via shard hash", async () => {
        const dbUuid1 = faker.string.uuid();
        const dbUuid2 = faker.string.uuid();

        const hash1 = generateShardHashFromDatabaseId(dbUuid1);
        const hash2 = generateShardHashFromDatabaseId(dbUuid2);

        expect(hash1).not.toBe(hash2);

        const id1 = defaultIdGenerator.generate({ shardHash: hash1, recordType: "document" });
        const id2 = defaultIdGenerator.generate({ shardHash: hash2, recordType: "document" });

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

        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        for (const user of users) {
            adapter.findOne.mockResolvedValueOnce(null);
            adapter.create.mockResolvedValueOnce({ id: faker.string.uuid() });

            await plugin.databaseHooks.user.create.after(user, {
                context: { adapter },
            });
        }

        // The default interceptor in setup.ts handles fetch; verify via adapter calls and pool state
        expect(adapter.create).toHaveBeenCalledTimes(5);
        expect(getD1Pool().allocationCount()).toBe(5);
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

        const entry = await cache.get(shardHash);
        expect(entry!.databaseId).toBe("db-2");
        expect(entry!.tenantId).toBe("tenant-new");
        expect(cache.size()).toBe(1);
    });

    test("should write data to correct tenant D1 database via migrations", async () => {
        const adapter = makeAdapter({
            create: vi.fn<any>().mockResolvedValue({ id: "rec-verify" }),
        });

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: "CREATE TABLE shard_docs (id TEXT PRIMARY KEY, content TEXT);",
                currentVersion: "v1.0.0",
            },
        }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        // Retrieve the databaseId that was assigned during DB creation
        const updateCall = adapter.update.mock.calls[0]?.[0];
        expect(updateCall).toBeDefined();
        const databaseId: string = updateCall.update.databaseId;
        expect(databaseId).toBeDefined();

        // Verify the table was created in the real D1 database
        const pool = getD1Pool();
        const binding = pool.get(databaseId);
        expect(binding).toBeDefined();
        expect(await tableExists(binding, "shard_docs")).toBe(true);

        // Write and read data to verify the binding is real
        await binding.exec("INSERT INTO shard_docs (id, content) VALUES ('doc1', 'shard test');");
        const rows = await queryD1(binding, "SELECT * FROM shard_docs WHERE id = ?", "doc1");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ id: "doc1", content: "shard test" });
    });

    test("should persist SQLite files on disk", async () => {
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        assertD1FilesExist(getD1Pool().persistDir);
    });
});

// ---------------------------------------------------------------------------
// Database full scenario – simulating capacity and new DB creation
// ---------------------------------------------------------------------------
describe("Database full scenario", () => {
    test("should handle Cloudflare API error indicating database limit reached", async () => {
        globalThis.fetch = createErrorD1Fetch({
            createError: {
                code: 7502,
                message: "You have exceeded the maximum number of D1 databases for this account",
            },
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

    test("should handle fetch returning non-ok status (e.g. 429 rate limit)", async () => {
        globalThis.fetch = createErrorD1Fetch({
            httpError: { status: 429, statusText: "Too Many Requests" },
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

    test("should create a new database when previous tenant was deleted", async () => {
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

        expect(adapter.create).toHaveBeenCalled();
        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    databaseId: expect.any(String),
                    status: TenantDatabaseStatus.ACTIVE,
                }),
            })
        );
    });

    test("should handle migration failure during new DB initialization", async () => {
        const adapter = makeAdapter();

        const plugin = cloudflareD1MultiTenancy({
            cloudflareD1Api,
            mode: "user",
            migrations: {
                currentSchema: "THIS IS NOT VALID SQL;",
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

            expect(generateShardHashFromDatabaseId(uuid)).toBe(hash);

            hashMap.set(uuid, hash);
        }

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

        for (const id of ids) {
            expect(defaultIdGenerator.extractShardHash(id)).toBe(shardHash);
        }

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

        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: faker.string.uuid(), email: faker.internet.email() },
            { context: { adapter } }
        );

        expect(statusTransitions).toEqual([
            TenantDatabaseStatus.CREATING,
            TenantDatabaseStatus.ACTIVE,
        ]);
    });

    test("should store shard hash derived from database UUID in tenant record", async () => {
        const adapter = makeAdapter();
        const plugin = cloudflareD1MultiTenancy({ cloudflareD1Api, mode: "user" }) as any;

        await plugin.databaseHooks.user.create.after(
            { id: "user-hash-check", email: "h@b.com" },
            { context: { adapter } }
        );

        // Retrieve the databaseId assigned by the interceptor (a real UUID from crypto.randomUUID())
        const updateCall = adapter.update.mock.calls[0]?.[0];
        expect(updateCall).toBeDefined();
        const databaseId: string = updateCall.update.databaseId;
        expect(databaseId).toBeDefined();

        const expectedShardHash = generateShardHashFromDatabaseId(databaseId);

        expect(adapter.update).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    shardHash: expectedShardHash,
                    databaseId,
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

        cache.set({
            shardHash: "shard_new",
            databaseId: faker.string.uuid(),
            tenantId: faker.string.uuid(),
            databaseName: "DB_new",
        });

        expect(cache.size()).toBe(maxEntries);
        expect(await cache.get("shard_0")).toBeNull();
        expect(await cache.get("shard_new")).not.toBeNull();

        for (let i = 1; i < maxEntries; i++) {
            expect(await cache.get(`shard_${i}`)).not.toBeNull();
        }
    });

    test("should handle rapid set/get cycles under high tenant counts", async () => {
        const cache = new ShardCache({ maxEntries: 100, ttl: 0 });

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

        expect(cache.size()).toBe(100);

        for (let i = 100; i < 200; i++) {
            const entry = await cache.get(shardHashes[i]);
            expect(entry).not.toBeNull();
            expect(entry!.tenantId).toBe(`tenant-${i}`);
        }
    });
});
