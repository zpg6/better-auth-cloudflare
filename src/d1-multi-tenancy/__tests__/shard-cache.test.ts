/**
 * Tests for Shard Cache
 */

import { describe, test, expect, beforeEach, jest } from "@jest/globals";
import { ShardCache, getShardCache, resetShardCache } from "../shard-cache";

describe("ShardCache", () => {
    let cache: ShardCache;

    beforeEach(() => {
        cache = new ShardCache({ debugLogs: false });
    });

    describe("set and get", () => {
        test("should store and retrieve cache entry", async () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            const entry = await cache.get("abc12345");
            expect(entry).not.toBeNull();
            expect(entry!.shardHash).toBe("abc12345");
            expect(entry!.databaseId).toBe("db-uuid-123");
            expect(entry!.tenantId).toBe("tenant-1");
            expect(entry!.databaseName).toBe("DB_20240101_abc12345");
        });

        test("should return null for non-existent entry", async () => {
            const entry = await cache.get("nonexistent");
            expect(entry).toBeNull();
        });

        test("should update existing entry", async () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-456",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            const entry = await cache.get("abc12345");
            expect(entry!.databaseId).toBe("db-uuid-456");
        });
    });

    describe("TTL (Time-To-Live)", () => {
        test("should expire entries after TTL", async () => {
            const shortTtlCache = new ShardCache({ ttl: 100 }); // 100ms TTL

            shortTtlCache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            // Should exist immediately
            expect(await shortTtlCache.get("abc12345")).not.toBeNull();

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 150));

            // Should be expired
            expect(await shortTtlCache.get("abc12345")).toBeNull();
        });

        test("should not expire when TTL is 0", async () => {
            const noTtlCache = new ShardCache({ ttl: 0 });

            noTtlCache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            await new Promise(resolve => setTimeout(resolve, 100));

            // Should still exist
            expect(await noTtlCache.get("abc12345")).not.toBeNull();
        });
    });

    describe("delete", () => {
        test("should delete entry from cache", async () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            expect(await cache.get("abc12345")).not.toBeNull();

            const deleted = cache.delete("abc12345");
            expect(deleted).toBe(true);
            expect(await cache.get("abc12345")).toBeNull();
        });

        test("should return false when deleting non-existent entry", () => {
            const deleted = cache.delete("nonexistent");
            expect(deleted).toBe(false);
        });
    });

    describe("clear", () => {
        test("should clear all entries", async () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            cache.set({
                shardHash: "xyz78901",
                databaseId: "db-uuid-456",
                tenantId: "tenant-2",
                databaseName: "DB_20240101_xyz78901",
            });

            expect(cache.size()).toBe(2);

            cache.clear();

            expect(cache.size()).toBe(0);
            expect(await cache.get("abc12345")).toBeNull();
            expect(await cache.get("xyz78901")).toBeNull();
        });
    });

    describe("size", () => {
        test("should return correct cache size", () => {
            expect(cache.size()).toBe(0);

            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            expect(cache.size()).toBe(1);

            cache.set({
                shardHash: "xyz78901",
                databaseId: "db-uuid-456",
                tenantId: "tenant-2",
                databaseName: "DB_20240101_xyz78901",
            });

            expect(cache.size()).toBe(2);

            cache.delete("abc12345");
            expect(cache.size()).toBe(1);
        });
    });

    describe("maxEntries", () => {
        test("should enforce max entries limit", async () => {
            const limitedCache = new ShardCache({ maxEntries: 2 });

            limitedCache.set({
                shardHash: "shard1",
                databaseId: "db-1",
                tenantId: "tenant-1",
                databaseName: "DB_1",
            });

            limitedCache.set({
                shardHash: "shard2",
                databaseId: "db-2",
                tenantId: "tenant-2",
                databaseName: "DB_2",
            });

            expect(limitedCache.size()).toBe(2);

            // Adding third entry should evict oldest
            limitedCache.set({
                shardHash: "shard3",
                databaseId: "db-3",
                tenantId: "tenant-3",
                databaseName: "DB_3",
            });

            expect(limitedCache.size()).toBe(2);
            expect(await limitedCache.get("shard1")).toBeNull(); // Oldest should be evicted
            expect(await limitedCache.get("shard2")).not.toBeNull();
            expect(await limitedCache.get("shard3")).not.toBeNull();
        });
    });

    describe("hydrate", () => {
        test("should hydrate cache from adapter", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([
                    {
                        tenantId: "tenant-1",
                        databaseId: "db-uuid-123",
                        databaseName: "DB_20240101_abc12345",
                        shardHash: "abc12345",
                    },
                    {
                        tenantId: "tenant-2",
                        databaseId: "db-uuid-456",
                        databaseName: "DB_20240101_xyz78901",
                        shardHash: "xyz78901",
                    },
                ]),
            };

            await cache.hydrate(mockAdapter, "user");

            expect(cache.size()).toBe(2);
            expect(await cache.get("abc12345")).not.toBeNull();
            expect(await cache.get("xyz78901")).not.toBeNull();
            expect(cache.isReady()).toBe(true);
        });

        test("should handle empty tenant list", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([]),
            };

            await cache.hydrate(mockAdapter, "user");

            expect(cache.size()).toBe(0);
            expect(cache.isReady()).toBe(true);
        });

        test("should skip tenants without shard hash", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([
                    {
                        tenantId: "tenant-1",
                        databaseId: "db-uuid-123",
                        databaseName: "DB_20240101_abc12345",
                        shardHash: "abc12345",
                    },
                    {
                        tenantId: "tenant-2",
                        databaseId: "db-uuid-456",
                        databaseName: "old_database",
                        shardHash: null, // Old record without shard hash
                    },
                ]),
            };

            await cache.hydrate(mockAdapter, "user");

            expect(cache.size()).toBe(1);
            expect(await cache.get("abc12345")).not.toBeNull();
        });

        test("should only hydrate once", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([
                    {
                        tenantId: "tenant-1",
                        databaseId: "db-uuid-123",
                        databaseName: "DB_20240101_abc12345",
                        shardHash: "abc12345",
                    },
                ]),
            };

            await cache.hydrate(mockAdapter, "user");
            await cache.hydrate(mockAdapter, "user"); // Second call should be no-op

            // Should only call adapter once
            expect(mockAdapter.findMany).toHaveBeenCalledTimes(1);
        });

        test("should wait for in-progress hydration", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockImplementation(() => 
                    new Promise(resolve => 
                        setTimeout(() => resolve([
                            {
                                tenantId: "tenant-1",
                                databaseId: "db-uuid-123",
                                databaseName: "DB_20240101_abc12345",
                                shardHash: "abc12345",
                            },
                        ]), 100)
                    )
                ),
            };

            // Start two hydrations simultaneously
            const promise1 = cache.hydrate(mockAdapter, "user");
            const promise2 = cache.hydrate(mockAdapter, "user");

            await Promise.all([promise1, promise2]);

            // Should only call adapter once
            expect(mockAdapter.findMany).toHaveBeenCalledTimes(1);
            expect(cache.size()).toBe(1);
        });
    });

    describe("ensureHydrated", () => {
        test("should hydrate if not ready", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([
                    {
                        tenantId: "tenant-1",
                        databaseId: "db-uuid-123",
                        databaseName: "DB_20240101_abc12345",
                        shardHash: "abc12345",
                    },
                ]),
            };

            expect(cache.isReady()).toBe(false);

            await cache.ensureHydrated(mockAdapter, "user");

            expect(cache.isReady()).toBe(true);
            expect(cache.size()).toBe(1);
        });

        test("should skip if already hydrated", async () => {
            const mockAdapter = {
                findMany: jest.fn<any>().mockResolvedValue([]),
            };

            await cache.hydrate(mockAdapter, "user");
            await cache.ensureHydrated(mockAdapter, "user");

            // Should only call once
            expect(mockAdapter.findMany).toHaveBeenCalledTimes(1);
        });
    });

    describe("getAll", () => {
        test("should return all cache entries", () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            cache.set({
                shardHash: "xyz78901",
                databaseId: "db-uuid-456",
                tenantId: "tenant-2",
                databaseName: "DB_20240101_xyz78901",
            });

            const all = cache.getAll();
            expect(all).toHaveLength(2);
            expect(all.some(e => e.shardHash === "abc12345")).toBe(true);
            expect(all.some(e => e.shardHash === "xyz78901")).toBe(true);
        });
    });
});

describe("KV-backed ShardCache", () => {
    /**
     * Minimal mock of Cloudflare KVNamespace for testing
     */
    function createMockKV() {
        const store = new Map<string, string>();
        return {
            store,
            put: jest.fn<any>().mockImplementation(async (key: string, value: string) => {
                store.set(key, value);
            }),
            get: jest.fn<any>().mockImplementation(async (key: string) => {
                return store.get(key) ?? null;
            }),
            delete: jest.fn<any>().mockImplementation(async (key: string) => {
                store.delete(key);
            }),
        };
    }

    test("set writes entry to KV", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any });

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_20240101_abc12345",
        });

        // KV write is fire-and-forget – wait a tick for the promise to settle
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockKv.put).toHaveBeenCalledTimes(1);
        const [kvKey, kvValue] = mockKv.put.mock.calls[0] as [string, string, any];
        expect(kvKey).toBe("shard:abc12345");
        const parsed = JSON.parse(kvValue);
        expect(parsed.databaseId).toBe("db-uuid-123");
        expect(parsed.shardHash).toBe("abc12345");
    });

    test("get returns in-memory entry without hitting KV", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any });

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_20240101_abc12345",
        });

        const entry = await cache.get("abc12345");
        expect(entry).not.toBeNull();
        expect(entry!.databaseId).toBe("db-uuid-123");
        // KV.get should NOT be called because in-memory hit
        expect(mockKv.get).not.toHaveBeenCalled();
    });

    test("get falls back to KV on in-memory miss", async () => {
        const mockKv = createMockKV();
        // Pre-populate KV with a serialised entry
        const kvEntry = {
            shardHash: "abc12345",
            databaseId: "db-uuid-from-kv",
            tenantId: "tenant-1",
            databaseName: "DB_test",
            cachedAt: Date.now(),
        };
        mockKv.store.set("shard:abc12345", JSON.stringify(kvEntry));

        const cache = new ShardCache({ kv: mockKv as any });

        // In-memory is empty – should fall back to KV
        const entry = await cache.get("abc12345");
        expect(entry).not.toBeNull();
        expect(entry!.databaseId).toBe("db-uuid-from-kv");
        expect(mockKv.get).toHaveBeenCalledWith("shard:abc12345");
    });

    test("KV hit populates in-memory cache for subsequent lookups", async () => {
        const mockKv = createMockKV();
        const kvEntry = {
            shardHash: "abc12345",
            databaseId: "db-uuid-from-kv",
            tenantId: "tenant-1",
            databaseName: "DB_test",
            cachedAt: Date.now(),
        };
        mockKv.store.set("shard:abc12345", JSON.stringify(kvEntry));

        const cache = new ShardCache({ kv: mockKv as any });

        // First call – KV miss in memory, KV hit
        await cache.get("abc12345");
        expect(mockKv.get).toHaveBeenCalledTimes(1);

        // Second call – in-memory hit, KV not called again
        await cache.get("abc12345");
        expect(mockKv.get).toHaveBeenCalledTimes(1);
    });

    test("delete removes entry from KV", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any });

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        cache.delete("abc12345");

        await new Promise(resolve => setTimeout(resolve, 10));

        expect(mockKv.delete).toHaveBeenCalledWith("shard:abc12345");
        // Should be gone from in-memory too
        expect(await cache.get("abc12345")).toBeNull();
    });

    test("respects custom kvPrefix", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any, kvPrefix: "mytenant:" });

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        const [kvKey] = mockKv.put.mock.calls[0] as [string, string];
        expect(kvKey).toBe("mytenant:abc12345");
    });

    test("set passes expirationTtl to KV when TTL is configured", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any, ttl: 7200000 }); // 2 hours

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        const [, , kvOpts] = mockKv.put.mock.calls[0] as [string, string, { expirationTtl: number }];
        expect(kvOpts?.expirationTtl).toBe(7200); // TTL in seconds
    });

    test("set omits expirationTtl when TTL is 0", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any, ttl: 0 });

        cache.set({
            shardHash: "abc12345",
            databaseId: "db-uuid-123",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        await new Promise(resolve => setTimeout(resolve, 10));

        const [, , kvOpts] = mockKv.put.mock.calls[0] as [string, string, any];
        expect(kvOpts).toBeUndefined();
    });

    test("get returns null for missing KV entry", async () => {
        const mockKv = createMockKV();
        const cache = new ShardCache({ kv: mockKv as any });

        const entry = await cache.get("nonexistent");
        expect(entry).toBeNull();
        expect(mockKv.get).toHaveBeenCalledWith("shard:nonexistent");
    });

    test("KV errors are handled gracefully on get", async () => {
        const mockKv = createMockKV();
        mockKv.get = jest.fn<any>().mockRejectedValue(new Error("KV unavailable"));
        const cache = new ShardCache({ kv: mockKv as any });

        // Should not throw; returns null gracefully
        const entry = await cache.get("abc12345");
        expect(entry).toBeNull();
    });

    test("KV errors are handled gracefully on set", async () => {
        const mockKv = createMockKV();
        mockKv.put = jest.fn<any>().mockRejectedValue(new Error("KV unavailable"));
        const cache = new ShardCache({ kv: mockKv as any });

        // set should not throw even when KV write fails
        expect(() =>
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_test",
            })
        ).not.toThrow();

        // In-memory entry should still be available
        expect(await cache.get("abc12345")).not.toBeNull();
    });
});

describe("Global cache functions", () => {
    beforeEach(() => {
        resetShardCache();
    });

    test("getShardCache should return singleton", () => {
        const cache1 = getShardCache();
        const cache2 = getShardCache();

        expect(cache1).toBe(cache2);
    });

    test("getShardCache should create cache with config", async () => {
        const cache = getShardCache({ debugLogs: true });

        // Add entry and verify it works
        cache.set({
            shardHash: "test1234",
            databaseId: "db-uuid",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        expect(await cache.get("test1234")).not.toBeNull();
    });

    test("resetShardCache should clear singleton", async () => {
        const cache1 = getShardCache();
        cache1.set({
            shardHash: "test1234",
            databaseId: "db-uuid",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        resetShardCache();

        const cache2 = getShardCache();
        expect(cache2).not.toBe(cache1);
        expect(await cache2.get("test1234")).toBeNull();
    });
});
