import type { User } from "better-auth";
import type { FieldAttribute } from "better-auth/db";

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
    tenantDatabase?: {
        modelName?: string;
        fields?: Record<string, string>;
    };
}

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
}
