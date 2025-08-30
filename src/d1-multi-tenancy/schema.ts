import type { AuthPluginSchema } from "better-auth";
import type { FieldAttribute } from "better-auth/db";

/**
 * Schema definition for the D1 multi-tenancy plugin
 *
 * IMPORTANT: Always use singular schema keys when usePlural: true is configured.
 * Better Auth will automatically pluralize the table name (tenant -> tenants)
 * while keeping the schema key singular for proper resolution.
 */
export const tenantDatabaseSchema = {
    tenant: {
        fields: {
            tenantId: {
                type: "string", // Organization ID or User ID depending on mode
                required: true,
                input: false,
            } satisfies FieldAttribute,
            tenantType: {
                type: "string", // "user" or "organization"
                required: true,
                input: false,
            } satisfies FieldAttribute,
            databaseName: {
                type: "string",
                required: true,
                input: false,
            } satisfies FieldAttribute,
            databaseId: {
                type: "string", // Cloudflare D1 database UUID
                required: true,
                input: false,
            } satisfies FieldAttribute,
            status: {
                type: "string", // "creating", "active", "deleting", "deleted"
                required: true,
                input: false,
                defaultValue: "creating",
            } satisfies FieldAttribute,
            createdAt: {
                type: "date",
                required: true,
                input: false,
                defaultValue: () => new Date(),
            } satisfies FieldAttribute,
            deletedAt: {
                type: "date",
                required: false,
                input: false,
            } satisfies FieldAttribute,
            lastMigrationVersion: {
                type: "string",
                required: false,
                input: false,
                defaultValue: "0000",
            } satisfies FieldAttribute,
            migrationHistory: {
                type: "string", // JSON array of applied migrations
                required: false,
                input: false,
                defaultValue: "[]",
            } satisfies FieldAttribute,
        },
    },
} as AuthPluginSchema;

/**
 * Type definition for tenant database records
 * Note: Better Auth adapter returns camelCase field names in parsed results
 */
export type Tenant = {
    id: string; // Auto-generated primary key by Better Auth
    tenantId: string; // Organization ID or User ID depending on mode
    tenantType: "user" | "organization";
    databaseName: string;
    databaseId: string;
    status: "creating" | "active" | "deleting" | "deleted";
    createdAt: Date;
    deletedAt?: Date;
    lastMigrationVersion?: string;
    migrationHistory?: string; // JSON array of applied migrations
};

/**
 * Status enum for tenant databases
 */
export const TenantDatabaseStatus = {
    CREATING: "creating",
    ACTIVE: "active",
    DELETING: "deleting",
    DELETED: "deleted",
} as const;

export type TenantDatabaseStatusType = (typeof TenantDatabaseStatus)[keyof typeof TenantDatabaseStatus];
