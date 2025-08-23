import type { FieldAttribute } from "better-auth/db";

/**
 * Core database fields for tracking tenant databases
 */
export const tenantDatabaseFields = {
    tenantId: {
        type: "string",
        required: true,
        input: false,
        fieldName: "tenant_id",
    },
    tenantType: {
        type: "string", // "user" or "organization"
        required: true,
        input: false,
        fieldName: "tenant_type",
    },
    databaseName: {
        type: "string",
        required: true,
        input: false,
        fieldName: "database_name",
    },
    databaseId: {
        type: "string", // Cloudflare D1 database UUID
        required: true,
        input: false,
        fieldName: "database_id",
    },
    status: {
        type: "string", // "creating", "active", "deleting", "deleted"
        required: true,
        input: false,
        defaultValue: "creating",
    },
    createdAt: {
        type: "date",
        required: true,
        input: false,
        defaultValue: () => new Date(),
        fieldName: "created_at",
    },
    deletedAt: {
        type: "date",
        required: false,
        input: false,
        fieldName: "deleted_at",
    },
} as const satisfies Record<string, FieldAttribute>;

/**
 * Schema definition for the D1 multi-tenancy plugin
 */
export const tenantDatabaseSchema = {
    tenantDatabase: {
        fields: tenantDatabaseFields,
        modelName: "tenant_database",
    },
} as const;

/**
 * Type definition for tenant database records
 */
export type TenantDatabase = {
    id: string;
    tenantId: string;
    tenantType: "user" | "organization";
    databaseName: string;
    databaseId: string;
    status: "creating" | "active" | "deleting" | "deleted";
    createdAt: Date;
    deletedAt?: Date;
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
