/**
 * Shard Cache System for D1 Multi-Tenancy
 * 
 * Caches the mapping between shard hashes and database IDs to eliminate
 * the need for tenant table lookups on every read operation.
 * 
 * The cache is hydrated once at startup (or lazily) and updated when
 * new tenant databases are created or deleted.
 * 
 * When a KV namespace is provided, the cache operates as a two-level store:
 *   L1 – in-memory Map (fast, per-Worker-instance)
 *   L2 – Cloudflare KV (persistent, shared across Worker instances)
 * This eliminates repeated tenant-table hydrations on cold Worker starts.
 */

import type { KVNamespace } from "@cloudflare/workers-types";
import type { CloudflareD1ApiConfig } from "./types.js";

/**
 * Cache entry for shard to database mapping
 */
export interface ShardCacheEntry {
    /**
     * Shard hash (derived from database UUID)
     */
    shardHash: string;
    
    /**
     * Cloudflare D1 database UUID
     */
    databaseId: string;
    
    /**
     * Tenant ID (for debugging/logging)
     */
    tenantId: string;
    
    /**
     * Database name
     */
    databaseName: string;
    
    /**
     * Timestamp when entry was cached
     */
    cachedAt: number;
}

/**
 * Shard cache configuration
 */
export interface ShardCacheConfig {
    /**
     * Time-to-live for cache entries in milliseconds
     * Default: 3600000 (1 hour)
     * Set to 0 to disable expiration
     */
    ttl?: number;
    
    /**
     * Maximum number of entries to cache
     * Default: 10000
     */
    maxEntries?: number;
    
    /**
     * Enable debug logging
     */
    debugLogs?: boolean;

    /**
     * Cloudflare KV namespace for persistent shard cache storage.
     * When provided the cache operates as a two-level store:
     *   L1 – in-memory Map (fast, per-Worker-instance)
     *   L2 – KV (persistent, shared across Worker instances)
     * This prevents repeated tenant-table hydrations on every cold Worker start.
     */
    kv?: KVNamespace<string>;

    /**
     * Key prefix used when storing entries in KV.
     * @default "shard:"
     */
    kvPrefix?: string;
}

/**
 * Shard Cache class for managing shard hash to database ID mappings
 */
export class ShardCache {
    private cache: Map<string, ShardCacheEntry> = new Map();
    private config: Required<Omit<ShardCacheConfig, 'kv'>> & Pick<ShardCacheConfig, 'kv'>;
    private isHydrated: boolean = false;
    private hydrationPromise: Promise<void> | null = null;
    
    constructor(config?: ShardCacheConfig) {
        this.config = {
            ttl: config?.ttl ?? 3600000, // 1 hour default
            maxEntries: config?.maxEntries ?? 10000,
            debugLogs: config?.debugLogs ?? false,
            kv: config?.kv,
            kvPrefix: config?.kvPrefix ?? "shard:",
        };
    }
    
    /**
     * Adds or updates an entry in the cache
     * 
     * Note: When maxEntries is reached, this uses FIFO eviction (oldest inserted entry),
     * not LRU (least recently used). For most use cases this is sufficient since tenant
     * databases are relatively stable and not frequently added/removed.
     * 
     * When a KV namespace is configured the entry is also written to KV so it
     * persists across Worker instances (fire-and-forget – does not block the caller).
     */
    set(entry: Omit<ShardCacheEntry, 'cachedAt'>): void {
        // If cache is at max capacity, remove oldest entry (FIFO)
        if (this.cache.size >= this.config.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) {
                this.cache.delete(oldestKey);
                if (this.config.debugLogs) {
                    console.log(`[ShardCache] Evicted oldest entry: ${oldestKey}`);
                }
            }
        }
        
        const fullEntry: ShardCacheEntry = {
            ...entry,
            cachedAt: Date.now(),
        };

        this.cache.set(entry.shardHash, fullEntry);

        // Write through to KV (fire-and-forget)
        if (this.config.kv) {
            const kvKey = this.config.kvPrefix + entry.shardHash;
            const kvOpts = this.config.ttl > 0
                ? { expirationTtl: Math.ceil(this.config.ttl / 1000) }
                : undefined;
            this.config.kv.put(kvKey, JSON.stringify(fullEntry), kvOpts).catch(err => {
                console.error(`[ShardCache] Failed to write shard ${entry.shardHash} to KV:`, err);
            });
        }
        
        if (this.config.debugLogs) {
            console.log(`[ShardCache] Cached shard ${entry.shardHash} -> ${entry.databaseId}`);
        }
    }
    
    /**
     * Gets a database ID from the cache by shard hash
     * 
     * Lookup order:
     * 1. In-memory Map (fastest)
     * 2. KV namespace (persistent, only when configured)
     * 
     * A KV hit is written back into the in-memory Map so subsequent calls
     * within the same Worker instance avoid the KV round-trip.
     * 
     * @param shardHash - Shard hash to lookup
     * @returns Cache entry or null if not found or expired
     */
    async get(shardHash: string): Promise<ShardCacheEntry | null> {
        const entry = this.cache.get(shardHash);
        
        if (entry) {
            // Check if entry has expired
            if (this.config.ttl > 0 && Date.now() - entry.cachedAt > this.config.ttl) {
                this.cache.delete(shardHash);
                if (this.config.debugLogs) {
                    console.log(`[ShardCache] Expired shard ${shardHash} (in-memory)`);
                }
                // Don't return – fall through to KV lookup below
            } else {
                return entry;
            }
        }

        // L2: try KV
        if (this.config.kv) {
            try {
                const kvKey = this.config.kvPrefix + shardHash;
                const raw = await this.config.kv.get(kvKey);
                if (raw) {
                    const kvEntry: ShardCacheEntry = JSON.parse(raw);
                    // Validate TTL again (KV TTL should handle this, but double-check)
                    if (this.config.ttl > 0 && Date.now() - kvEntry.cachedAt > this.config.ttl) {
                        if (this.config.debugLogs) {
                            console.log(`[ShardCache] Expired shard ${shardHash} (KV)`);
                        }
                        return null;
                    }
                    // Populate in-memory cache from KV hit
                    this.cache.set(shardHash, kvEntry);
                    if (this.config.debugLogs) {
                        console.log(`[ShardCache] KV hit for shard ${shardHash} -> ${kvEntry.databaseId}`);
                    }
                    return kvEntry;
                }
            } catch (err) {
                console.error(`[ShardCache] Failed to read shard ${shardHash} from KV:`, err);
            }
        }
        
        return null;
    }
    
    /**
     * Removes an entry from the cache (in-memory and KV)
     */
    delete(shardHash: string): boolean {
        const deleted = this.cache.delete(shardHash);

        // Remove from KV (fire-and-forget)
        if (this.config.kv) {
            const kvKey = this.config.kvPrefix + shardHash;
            this.config.kv.delete(kvKey).catch(err => {
                console.error(`[ShardCache] Failed to delete shard ${shardHash} from KV:`, err);
            });
        }

        if (deleted && this.config.debugLogs) {
            console.log(`[ShardCache] Deleted shard ${shardHash}`);
        }
        return deleted;
    }
    
    /**
     * Clears all entries from the cache
     */
    clear(): void {
        this.cache.clear();
        this.isHydrated = false;
        if (this.config.debugLogs) {
            console.log(`[ShardCache] Cache cleared`);
        }
    }
    
    /**
     * Gets the number of entries in the cache
     */
    size(): number {
        return this.cache.size;
    }
    
    /**
     * Hydrates the cache from the database
     * This should be called once at startup or lazily on first access
     * 
     * @param adapter - Better Auth adapter instance for querying tenant table
     * @param mode - Multi-tenancy mode ("user" or "organization")
     */
    async hydrate(adapter: any, mode: string): Promise<void> {
        // If already hydrating, wait for that to complete
        if (this.hydrationPromise) {
            return this.hydrationPromise;
        }
        
        // If already hydrated, skip
        if (this.isHydrated) {
            return;
        }
        
        this.hydrationPromise = this._doHydrate(adapter, mode);
        await this.hydrationPromise;
        this.hydrationPromise = null;
    }
    
    private async _doHydrate(adapter: any, mode: string): Promise<void> {
        try {
            if (this.config.debugLogs) {
                console.log(`[ShardCache] Starting cache hydration for mode: ${mode}`);
            }
            
            // Query all active tenant databases
            const tenants = await adapter.findMany({
                model: "tenant",
                where: [
                    { field: "tenantType", value: mode, operator: "eq" },
                    { field: "status", value: "active", operator: "eq" },
                ],
                select: ["tenantId", "databaseId", "databaseName", "shardHash"],
            });
            
            if (!tenants || tenants.length === 0) {
                if (this.config.debugLogs) {
                    console.log(`[ShardCache] No active tenants found for mode: ${mode}`);
                }
                this.isHydrated = true;
                return;
            }
            
            // Cache each tenant's shard mapping
            let cachedCount = 0;
            for (const tenant of tenants) {
                if (tenant.shardHash && tenant.databaseId) {
                    // Use databaseName from record, or derive from shard hash if missing
                    const databaseName = tenant.databaseName || `DB_${tenant.shardHash}`;
                    
                    this.set({
                        shardHash: tenant.shardHash,
                        databaseId: tenant.databaseId,
                        tenantId: tenant.tenantId,
                        databaseName: databaseName,
                    });
                    cachedCount++;
                }
            }
            
            this.isHydrated = true;
            
            if (this.config.debugLogs) {
                console.log(`[ShardCache] Cache hydrated with ${cachedCount} entries`);
            }
        } catch (error) {
            console.error(`[ShardCache] Failed to hydrate cache:`, error);
            // Mark as hydrated anyway to prevent blocking application startup
            // The cache will lazily populate as queries are made
            this.isHydrated = true;
            console.warn(
                `[ShardCache] Cache hydration failed but continuing. ` +
                `Queries will fall back to tenant table lookups.`
            );
        }
    }
    
    /**
     * Lazy hydration: hydrates the cache if not already done
     * Returns immediately if already hydrated or in progress
     */
    async ensureHydrated(adapter: any, mode: string): Promise<void> {
        if (!this.isHydrated) {
            await this.hydrate(adapter, mode);
        }
    }
    
    /**
     * Checks if the cache has been hydrated
     */
    isReady(): boolean {
        return this.isHydrated;
    }
    
    /**
     * Gets all cache entries (for debugging/inspection)
     */
    getAll(): ShardCacheEntry[] {
        return Array.from(this.cache.values());
    }
}

/**
 * Global shard cache instance
 * This is a singleton to ensure consistent cache across the application
 */
let globalShardCache: ShardCache | null = null;

/**
 * Gets or creates the global shard cache instance
 */
export function getShardCache(config?: ShardCacheConfig): ShardCache {
    if (!globalShardCache) {
        globalShardCache = new ShardCache(config);
    }
    return globalShardCache;
}

/**
 * Resets the global shard cache (useful for testing)
 */
export function resetShardCache(): void {
    globalShardCache = null;
}
