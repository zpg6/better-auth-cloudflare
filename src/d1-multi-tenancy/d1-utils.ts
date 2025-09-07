import { drizzle } from "@zpg6-test-pkgs/drizzle-orm/d1-http";
import { sql } from "@zpg6-test-pkgs/drizzle-orm";
import type { CloudflareD1ApiConfig } from "./types.js";
import { CloudflareD1MultiTenancyError } from "./utils.js";

/**
 * Type for values that can be resolved synchronously or asynchronously
 */
type ResolvableValue = string | (() => string) | (() => Promise<string>);

/**
 * Configuration for tenant database initialization
 */
export interface TenantMigrationConfig {
    /**
     * Raw SQL string containing the complete current schema for new tenant databases
     * This should be the latest schema with all tables as they exist now
     * Can be a string, function returning string, or async function returning string
     */
    currentSchema: ResolvableValue;
    /**
     * Current version identifier (e.g., "v1.2.0", "20240826", etc.)
     * This helps track what version of the schema new databases are initialized with
     * Can be a string, function returning string, or async function returning string
     */
    currentVersion: ResolvableValue;
    /**
     * Function to generate migration checksums for validation
     */
    generateChecksum?: (sql: string) => string;
}

/**
 * Resolves a value that can be a string, function, or async function
 */
async function resolveValue(value: ResolvableValue): Promise<string> {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "function") {
        const result = value();
        return typeof result === "string" ? result : await result;
    }
    throw new Error("Invalid value type");
}

/**
 * Creates a D1-HTTP database connection
 */
function createD1HttpConnection(config: CloudflareD1ApiConfig, databaseId: string) {
    return drizzle(
        {
            accountId: config.accountId,
            databaseId: databaseId,
            token: config.apiToken,
        },
        {
            logger: config.debugLogs,
        }
    );
}

/**
 * Executes raw SQL on a Cloudflare D1 database using D1-HTTP driver
 */
export const executeD1SQL = async (
    config: CloudflareD1ApiConfig,
    databaseId: string,
    sqlString: string
): Promise<void> => {
    try {
        const db = createD1HttpConnection(config, databaseId);

        // Split SQL by statement breakpoints and execute each statement
        const statements = sqlString
            .split("--> statement-breakpoint")
            .map(s => s.trim())
            .filter(s => s.length > 0);
        if (config.debugLogs) {
            console.log(`📋 Executing ${statements.length} SQL statement(s) on tenant database`);
            for (const statement of statements) {
                console.log(`  > ${statement}`);
            }
        }

        for (const statement of statements) {
            await db.run(sql.raw(statement));
        }
    } catch (apiError: any) {
        console.error(`❌ SQL execution failed on database ${databaseId}:`, apiError);

        if (apiError.message?.includes("authentication") || apiError.message?.includes("unauthorized")) {
            throw new CloudflareD1MultiTenancyError(
                "INVALID_CREDENTIALS",
                "Failed to authenticate with Cloudflare API. Please verify your API token has D1:edit permissions and your account ID is correct."
            );
        }
        throw new CloudflareD1MultiTenancyError(
            "CLOUDFLARE_D1_API_ERROR",
            `Cloudflare D1 API error during SQL execution: ${apiError.message || "Unknown error"}`
        );
    }
};

/**
 * Initializes a new tenant database with the current schema
 * Only executes the raw SQL schema - migration tracking is handled in the main database
 */
export const initializeTenantDatabase = async (
    config: CloudflareD1ApiConfig,
    databaseId: string,
    migrationConfig: TenantMigrationConfig
): Promise<{ schema: string; version: string }> => {
    try {
        // Resolve the current schema and version
        const schema = await resolveValue(migrationConfig.currentSchema);
        const version = await resolveValue(migrationConfig.currentVersion);

        if (!schema || schema.trim().length === 0) {
            throw new Error("Schema is empty or undefined");
        }

        // Execute the current schema (contains all tables as they exist now)
        await executeD1SQL(config, databaseId, schema);

        return { schema, version };
    } catch (error) {
        console.error(`❌ Failed to initialize tenant database:`, error);

        throw new CloudflareD1MultiTenancyError(
            "DATABASE_CREATION_FAILED",
            `Failed to initialize tenant database: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
};

/**
 * Applies migrations to a tenant database
 * Note: This function is for future use when migrating existing tenant databases
 * Migration tracking is handled in the main database, not in tenant databases
 */
export const applyTenantMigrations = async (
    config: CloudflareD1ApiConfig,
    databaseId: string,
    migrations: string[]
): Promise<void> => {
    if (!migrations || migrations.length === 0) {
        return;
    }

    try {
        // Apply each migration to the tenant database
        for (const migration of migrations) {
            await executeD1SQL(config, databaseId, migration);
        }
    } catch (error) {
        throw new CloudflareD1MultiTenancyError(
            "DATABASE_CREATION_FAILED",
            `Failed to apply tenant migrations: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
};

/**
 * Gets the current migration status for a tenant database from the main database
 * Note: Migration tracking is stored in the main database, not in tenant databases
 */
export const getTenantMigrationStatus = async (
    adapter: any,
    tenantId: string,
    mode: string
): Promise<{ currentVersion: string; migrationHistory: any[] }> => {
    try {
        const tenant = await adapter.findOne({
            model: "tenant",
            where: [
                { field: "tenantId", value: tenantId, operator: "eq" },
                { field: "tenantType", value: mode, operator: "eq" },
            ],
        });

        if (!tenant) {
            throw new Error(`Tenant ${tenantId} not found`);
        }

        return {
            currentVersion: tenant.lastMigrationVersion || "unknown",
            migrationHistory: tenant.migrationHistory ? JSON.parse(tenant.migrationHistory) : [],
        };
    } catch (error) {
        throw new CloudflareD1MultiTenancyError(
            "DATABASE_CREATION_FAILED",
            `Failed to get migration status: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
};

/**
 * Default checksum generator using simple hash
 */
export const defaultChecksumGenerator = (sql: string): string => {
    let hash = 0;
    for (let i = 0; i < sql.length; i++) {
        const char = sql.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
};
