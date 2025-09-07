import type { User } from "better-auth";
import type { FieldAttribute } from "better-auth/db";
import type { AdapterRouterParams } from "better-auth/adapters/adapter-router";
import type { TenantMigrationConfig } from "./d1-utils.js";

/**
 * Cloudflare D1 API configuration for database management
 */
export interface CloudflareD1ApiConfig {
    /**
     * Cloudflare API token with D1:edit permissions
     */
    apiToken: string;
    /**
     * Cloudflare account ID
     */
    accountId: string;

    /**
     * Enable extended console logs
     */
    debugLogs?: boolean;
}

/**
 * Cloudflare D1 multi-tenancy mode configuration
 */
export type CloudflareD1MultiTenancyMode = "user" | "organization";

/**
 * Hook functions for custom logic during Cloudflare D1 database operations
 */
export interface CloudflareD1MultiTenancyHooks {
    /**
     * Called before creating a tenant database
     */
    beforeCreate?: (params: {
        tenantId: string;
        mode: CloudflareD1MultiTenancyMode;
        user?: User;
    }) => Promise<void> | void;

    /**
     * Called after successfully creating a tenant database
     */
    afterCreate?: (params: {
        tenantId: string;
        databaseName: string;
        databaseId: string;
        mode: CloudflareD1MultiTenancyMode;
        user?: User;
    }) => Promise<void> | void;

    /**
     * Called before deleting a tenant database
     */
    beforeDelete?: (params: {
        tenantId: string;
        databaseName: string;
        databaseId: string;
        mode: CloudflareD1MultiTenancyMode;
        user?: User;
    }) => Promise<void> | void;

    /**
     * Called after successfully deleting a tenant database
     */
    afterDelete?: (params: {
        tenantId: string;
        mode: CloudflareD1MultiTenancyMode;
        user?: User;
    }) => Promise<void> | void;
}

/**
 * Cloudflare D1 multi-tenancy schema customization options
 */
export interface CloudflareD1MultiTenancySchema {
    tenantDatabases?: {
        modelName?: string;
        fields?: Record<string, FieldAttribute>;
    };
}

/**
 * Custom tenant routing callback function
 *
 * @param params - The full adapter router parameters from better-auth
 * @returns The tenant ID to route to, or an object with tenantId and modified data, or undefined/null to fall back to default logic
 */
export type TenantRoutingCallback = (
    params: AdapterRouterParams
) => string | { tenantId: string; data?: any } | undefined | null | Promise<string | { tenantId: string; data?: any } | undefined | null>;

/**
 * Configuration options for the Cloudflare D1 multi-tenancy plugin
 */
export interface CloudflareD1MultiTenancyOptions {
    /**
     * Cloudflare D1 API configuration for database management
     */
    cloudflareD1Api: CloudflareD1ApiConfig;

    /**
     * Multi-tenancy mode - only one can be enabled at a time
     */
    mode: CloudflareD1MultiTenancyMode;

    /**
     * Optional prefix for tenant database names
     * @default "tenant_"
     */
    databasePrefix?: string;

    /**
     * Optional hooks for custom logic during database operations
     */
    hooks?: CloudflareD1MultiTenancyHooks;

    /**
     * Schema customization options
     */
    schema?: CloudflareD1MultiTenancySchema;

    /**
     * Additional fields for the tenant database table
     */
    additionalFields?: Record<string, FieldAttribute>;

    /**
     * Migration configuration for tenant databases
     */
    migrations?: TenantMigrationConfig;

    /**
     * Core models that should remain in the main database instead of tenant databases.
     * These models will not be routed to tenant-specific databases.
     *
     * Can be either:
     * - An array of model names
     * - A callback function that receives the default core models and returns a modified array (either adding or removing models as you wish)
     *
     * @default ["user", "users", "account", "accounts", "session", "sessions", "organization", "organizations", "member", "members", "invitation", "invitations", "verification", "verifications", "tenant", "tenants"]
     */
    coreModels?: string[] | ((defaultCoreModels: string[]) => string[]);

    /**
     * Custom tenant routing callback
     *
     * This callback allows you to define custom logic for extracting tenant IDs from operations.
     * It takes priority over the default tenant ID extraction logic and receives the full
     * AdapterRouterParams from better-auth for maximum flexibility.
     *
     * @example
     * ```typescript
     * tenantRouting: ({ modelName, operation, data, fallbackAdapter }) => {
     *   // For apiKey model, extract tenant ID from the first half of the API key
     *   if (modelName === 'apiKey' && operation === 'findOne' && Array.isArray(data)) {
     *     const apiKeyWhere = data.find(w => w.field === 'key');
     *     if (apiKeyWhere?.value && typeof apiKeyWhere.value === 'string') {
     *       return apiKeyWhere.value.split('_')[0];
     *     }
     *   }
     *   
     *   // For create operations, modify data and return tenant ID
     *   if (modelName === 'apikey' && operation === 'create' && data && 'prefix' in data) {
     *     const prefix = data.prefix.split('__')[0];
     *     return {
     *       tenantId: prefix,
     *       data: { ...data, userId: prefix } // Modify the data
     *     };
     *   }
     *   
     *   return undefined; // Fall back to default logic
     * }
     * ```
     */
    tenantRouting?: TenantRoutingCallback;

    /**
     * Enable extended console logs
     */
    debugLogs?: boolean;
}

/**
 * Type definition for Cloudflare D1 API response using fetch
 */
export interface CloudflareD1CreateResponse {
    result?: {
        uuid?: string;
        name?: string;
    };
    success?: boolean;
    errors?: Array<{ code: number; message: string }>;
}

/**
 * Type definition for Cloudflare D1 API response using fetch
 */
export interface CloudflareD1DeleteResponse {
    result?: null;
    success?: boolean;
    errors?: Array<{ code: number; message: string }>;
}
