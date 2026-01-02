/**
 * Universal ID Generator for D1 Multi-Tenancy
 * 
 * Generates self-describing IDs with embedded shard/routing metadata:
 * Format: <timestamp><shardHash><typeHash><random>
 * 
 * This eliminates the need for central tenant mapping table lookups on every read operation.
 * The IDs contain all necessary information to route queries to the correct database.
 */

/**
 * Configuration for ID generation
 */
export interface UniversalIdConfig {
    /**
     * Length of timestamp component in characters (default: 13)
     * Timestamp is base36 encoded milliseconds since epoch
     */
    timestampLength?: number;
    
    /**
     * Length of shard hash component in characters (default: 8)
     */
    shardHashLength?: number;
    
    /**
     * Length of type hash component in characters (default: 4)
     */
    typeHashLength?: number;
    
    /**
     * Length of random component in characters (default: 8)
     */
    randomLength?: number;
}

/**
 * Decoded Universal ID structure
 */
export interface DecodedUniversalId {
    /**
     * Original full ID
     */
    id: string;
    
    /**
     * Timestamp when ID was generated (milliseconds since epoch)
     */
    timestamp: number;
    
    /**
     * Shard hash for routing to correct database
     */
    shardHash: string;
    
    /**
     * Type hash identifying the record type
     */
    typeHash: string;
    
    /**
     * Random component for uniqueness
     */
    random: string;
}

const DEFAULT_CONFIG: Required<UniversalIdConfig> = {
    timestampLength: 11, // Base36 encoded timestamp fits in 11 chars for ~100 years
    shardHashLength: 8,
    typeHashLength: 4,
    randomLength: 10,
};

/**
 * Generates a short hash from a string using djb2 algorithm
 * 
 * @param input - String to hash
 * @param length - Desired length of output hash
 * @returns Base36 encoded hash string
 */
function generateShortHash(input: string, length: number): string {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) + hash) + input.charCodeAt(i); // hash * 33 + char
    }
    
    // Convert to positive number and encode as base36
    const hashStr = Math.abs(hash).toString(36);
    
    // Pad or truncate to desired length
    if (hashStr.length >= length) {
        return hashStr.substring(0, length);
    }
    return hashStr.padStart(length, '0');
}

/**
 * Generates a random alphanumeric string
 * 
 * @param length - Length of random string
 * @returns Random base36 string
 */
function generateRandom(length: number): string {
    let result = '';
    const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    
    for (let i = 0; i < length; i++) {
        // Use crypto.getRandomValues if available, otherwise Math.random
        const randomValue = typeof crypto !== 'undefined' && crypto.getRandomValues
            ? crypto.getRandomValues(new Uint32Array(1))[0] / (0xffffffff + 1)
            : Math.random();
        
        result += chars.charAt(Math.floor(randomValue * chars.length));
    }
    
    return result;
}

/**
 * Universal ID Generator class
 */
export class UniversalIdGenerator {
    private config: Required<UniversalIdConfig>;
    
    constructor(config?: UniversalIdConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    
    /**
     * Generates a Universal ID with embedded shard metadata
     * 
     * @param options - ID generation options
     * @returns Universal ID string
     */
    generate(options: {
        /**
         * Shard hash for routing (e.g., derived from database UUID)
         */
        shardHash: string;
        
        /**
         * Record type identifier (e.g., "birthday", "document")
         */
        recordType: string;
    }): string {
        const timestamp = Date.now();
        const timestampStr = timestamp.toString(36).padStart(this.config.timestampLength, '0');
        
        // Normalize and truncate shard hash to configured length
        const shardHashStr = options.shardHash.toLowerCase().substring(0, this.config.shardHashLength);
        
        // Generate type hash from record type
        const typeHashStr = generateShortHash(options.recordType, this.config.typeHashLength);
        
        // Generate random component
        const randomStr = generateRandom(this.config.randomLength);
        
        return `${timestampStr}${shardHashStr}${typeHashStr}${randomStr}`;
    }
    
    /**
     * Decodes a Universal ID into its components
     * 
     * @param id - Universal ID to decode
     * @returns Decoded ID components or null if invalid
     */
    decode(id: string): DecodedUniversalId | null {
        try {
            // Validate minimum length
            const minLength = this.config.timestampLength + 
                            this.config.shardHashLength + 
                            this.config.typeHashLength + 
                            this.config.randomLength;
            
            if (!id || id.length < minLength) {
                return null;
            }
            
            let offset = 0;
            
            // Extract timestamp
            const timestampStr = id.substring(offset, offset + this.config.timestampLength);
            offset += this.config.timestampLength;
            const timestamp = parseInt(timestampStr, 36);
            
            if (isNaN(timestamp)) {
                return null;
            }
            
            // Extract shard hash
            const shardHash = id.substring(offset, offset + this.config.shardHashLength);
            offset += this.config.shardHashLength;
            
            // Extract type hash
            const typeHash = id.substring(offset, offset + this.config.typeHashLength);
            offset += this.config.typeHashLength;
            
            // Extract random component
            const random = id.substring(offset, offset + this.config.randomLength);
            
            return {
                id,
                timestamp,
                shardHash,
                typeHash,
                random,
            };
        } catch (error) {
            return null;
        }
    }
    
    /**
     * Checks if an ID is a valid Universal ID format
     * 
     * @param id - ID to validate
     * @returns True if valid Universal ID format
     */
    isUniversalId(id: string): boolean {
        return this.decode(id) !== null;
    }
    
    /**
     * Extracts just the shard hash from a Universal ID (fast path)
     * 
     * @param id - Universal ID
     * @returns Shard hash or null if invalid
     */
    extractShardHash(id: string): string | null {
        try {
            const minLength = this.config.timestampLength + this.config.shardHashLength;
            if (!id || id.length < minLength) {
                return null;
            }
            
            const offset = this.config.timestampLength;
            return id.substring(offset, offset + this.config.shardHashLength);
        } catch (error) {
            return null;
        }
    }
}

/**
 * Default Universal ID generator instance
 */
export const defaultIdGenerator = new UniversalIdGenerator();

/**
 * Generates a shard hash from a database UUID
 * This creates a consistent hash that can be embedded in record IDs
 * 
 * @param databaseId - Cloudflare D1 database UUID
 * @returns Shard hash string
 */
export function generateShardHashFromDatabaseId(databaseId: string): string {
    // Remove any dashes from UUID and take first 8 characters of lowercase
    const normalized = databaseId.replace(/-/g, '').toLowerCase();
    return normalized.substring(0, 8);
}

/**
 * Generates a structured database name with date and tenant hash
 * Format: DB_{date}_{tenantHash}
 * 
 * @param tenantId - Tenant identifier
 * @param prefix - Optional prefix (default: "DB")
 * @returns Database name
 */
export function generateStructuredDatabaseName(tenantId: string, prefix: string = "DB"): string {
    const date = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
    const tenantHash = generateShortHash(tenantId, 8);
    return `${prefix}_${date}_${tenantHash}`;
}
