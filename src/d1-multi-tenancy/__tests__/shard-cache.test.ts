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
        test("should store and retrieve cache entry", () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            const entry = cache.get("abc12345");
            expect(entry).not.toBeNull();
            expect(entry!.shardHash).toBe("abc12345");
            expect(entry!.databaseId).toBe("db-uuid-123");
            expect(entry!.tenantId).toBe("tenant-1");
            expect(entry!.databaseName).toBe("DB_20240101_abc12345");
        });

        test("should return null for non-existent entry", () => {
            const entry = cache.get("nonexistent");
            expect(entry).toBeNull();
        });

        test("should update existing entry", () => {
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

            const entry = cache.get("abc12345");
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
            expect(shortTtlCache.get("abc12345")).not.toBeNull();

            // Wait for expiration
            await new Promise(resolve => setTimeout(resolve, 150));

            // Should be expired
            expect(shortTtlCache.get("abc12345")).toBeNull();
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
            expect(noTtlCache.get("abc12345")).not.toBeNull();
        });
    });

    describe("delete", () => {
        test("should delete entry from cache", () => {
            cache.set({
                shardHash: "abc12345",
                databaseId: "db-uuid-123",
                tenantId: "tenant-1",
                databaseName: "DB_20240101_abc12345",
            });

            expect(cache.get("abc12345")).not.toBeNull();

            const deleted = cache.delete("abc12345");
            expect(deleted).toBe(true);
            expect(cache.get("abc12345")).toBeNull();
        });

        test("should return false when deleting non-existent entry", () => {
            const deleted = cache.delete("nonexistent");
            expect(deleted).toBe(false);
        });
    });

    describe("clear", () => {
        test("should clear all entries", () => {
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
            expect(cache.get("abc12345")).toBeNull();
            expect(cache.get("xyz78901")).toBeNull();
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
        test("should enforce max entries limit", () => {
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
            expect(limitedCache.get("shard1")).toBeNull(); // Oldest should be evicted
            expect(limitedCache.get("shard2")).not.toBeNull();
            expect(limitedCache.get("shard3")).not.toBeNull();
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
            expect(cache.get("abc12345")).not.toBeNull();
            expect(cache.get("xyz78901")).not.toBeNull();
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
            expect(cache.get("abc12345")).not.toBeNull();
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

describe("Global cache functions", () => {
    beforeEach(() => {
        resetShardCache();
    });

    test("getShardCache should return singleton", () => {
        const cache1 = getShardCache();
        const cache2 = getShardCache();

        expect(cache1).toBe(cache2);
    });

    test("getShardCache should create cache with config", () => {
        const cache = getShardCache({ debugLogs: true });

        // Add entry and verify it works
        cache.set({
            shardHash: "test1234",
            databaseId: "db-uuid",
            tenantId: "tenant-1",
            databaseName: "DB_test",
        });

        expect(cache.get("test1234")).not.toBeNull();
    });

    test("resetShardCache should clear singleton", () => {
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
        expect(cache2.get("test1234")).toBeNull();
    });
});
