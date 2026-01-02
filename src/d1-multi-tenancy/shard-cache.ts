/**
 * Shard Cache System for D1 Multi-Tenancy
 * 
 * Caches the mapping between shard hashes and database IDs to eliminate
 * the need for tenant table lookups on every read operation.
 * 
 * The cache is hydrated once at startup (or lazily) and updated when
 * new tenant databases are created or deleted.
 */

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
}

/**
 * Shard Cache class for managing shard hash to database ID mappings
 */
export class ShardCache {
    private cache: Map<string, ShardCacheEntry> = new Map();
    private config: Required<ShardCacheConfig>;
    private isHydrated: boolean = false;
    private hydrationPromise: Promise<void> | null = null;
    
    constructor(config?: ShardCacheConfig) {
        this.config = {
            ttl: config?.ttl ?? 3600000, // 1 hour default
            maxEntries: config?.maxEntries ?? 10000,
            debugLogs: config?.debugLogs ?? false,
        };
    }
    
    /**
     * Adds or updates an entry in the cache
     * 
     * Note: When maxEntries is reached, this uses FIFO eviction (oldest inserted entry),
     * not LRU (least recently used). For most use cases this is sufficient since tenant
     * databases are relatively stable and not frequently added/removed.
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
        
        this.cache.set(entry.shardHash, {
            ...entry,
            cachedAt: Date.now(),
        });
        
        if (this.config.debugLogs) {
            console.log(`[ShardCache] Cached shard ${entry.shardHash} -> ${entry.databaseId}`);
        }
    }
    
    /**
     * Gets a database ID from the cache by shard hash
     * 
     * @param shardHash - Shard hash to lookup
     * @returns Cache entry or null if not found or expired
     */
    get(shardHash: string): ShardCacheEntry | null {
        const entry = this.cache.get(shardHash);
        
        if (!entry) {
            return null;
        }
        
        // Check if entry has expired
        if (this.config.ttl > 0 && Date.now() - entry.cachedAt > this.config.ttl) {
            this.cache.delete(shardHash);
            if (this.config.debugLogs) {
                console.log(`[ShardCache] Expired shard ${shardHash}`);
            }
            return null;
        }
        
        return entry;
    }
    
    /**
     * Removes an entry from the cache
     */
    delete(shardHash: string): boolean {
        const deleted = this.cache.delete(shardHash);
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
