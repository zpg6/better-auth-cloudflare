import type { AuthContext, BetterAuthPlugin, User } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { mergeSchema } from "better-auth/db";
import Cloudflare from "cloudflare";
import { tenantDatabaseSchema, TenantDatabaseStatus, type TenantDatabase } from "./schema";
import type { CloudflareD1MultiTenancyOptions } from "./types";

// Export all types and schema
export * from "./schema";
export * from "./types";

/**
 * Error codes for the Cloudflare D1 multi-tenancy plugin
 */
export const CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES = {
    DATABASE_ALREADY_EXISTS: "Tenant database already exists",
    DATABASE_NOT_FOUND: "Tenant database not found",
    DATABASE_CREATION_FAILED: "Failed to create tenant database",
    DATABASE_DELETION_FAILED: "Failed to delete tenant database",
    CLOUDFLARE_D1_API_ERROR: "Cloudflare D1 API error",
} as const;

/**
 * Cloudflare D1 Multi-tenancy plugin for Better Auth
 *
 * Provides automatic tenant database creation and deletion for user or organization-level multi-tenancy.
 * Only one mode can be active at a time.
 */
export const cloudflareD1MultiTenancy = (options: CloudflareD1MultiTenancyOptions) => {
    const {
        cloudflareD1Api,
        mode,
        databasePrefix = "tenant_",
        hooks,
        schema: schemaOptions,
        additionalFields = {},
    } = options;

    // Initialize Cloudflare client
    const cf = new Cloudflare({
        apiToken: cloudflareD1Api.apiToken,
    });

    // Merge schema with additional fields
    const baseSchema = { ...tenantDatabaseSchema };
    if (Object.keys(additionalFields).length > 0) {
        baseSchema.tenantDatabase = {
            ...baseSchema.tenantDatabase,
            fields: {
                ...baseSchema.tenantDatabase.fields,
                ...additionalFields,
            },
        };
    }
    const mergedSchema = mergeSchema(baseSchema, schemaOptions);

    /**
     * Creates a tenant database for the given tenant ID
     */
    const createTenantDatabase = async (tenantId: string, adapter: any, user?: User): Promise<void> => {
        try {
            const databaseName = getCloudflareD1TenantDatabaseName(tenantId, databasePrefix);

            // Check if database already exists
            const existing = (await adapter.findOne({
                model: "tenantDatabase",
                where: [
                    { field: "tenantId", value: tenantId },
                    { field: "tenantType", value: mode },
                ],
            })) as TenantDatabase | null;

            if (existing && existing.status !== TenantDatabaseStatus.DELETED) {
                console.log(
                    `${CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.DATABASE_ALREADY_EXISTS} for tenant ${tenantId}`
                );
                return;
            }

            await hooks?.beforeCreate?.({ tenantId, mode, user });

            // Record database as creating
            const dbRecord = (await adapter.create({
                model: "tenantDatabase",
                data: {
                    tenantId,
                    tenantType: mode,
                    databaseName,
                    databaseId: "",
                    status: TenantDatabaseStatus.CREATING,
                    createdAt: new Date(),
                },
            })) as TenantDatabase;

            // Create database via Cloudflare API
            const response = await cf.d1.database.create({
                account_id: cloudflareD1Api.accountId,
                name: databaseName,
            });

            const databaseId = response.uuid;
            if (!databaseId) {
                throw new Error(
                    `${CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.CLOUDFLARE_D1_API_ERROR}: Failed to get database ID from response`
                );
            }

            // Update record with actual database ID
            await adapter.update({
                model: "tenantDatabase",
                where: [{ field: "id", value: dbRecord.id }],
                update: {
                    databaseId,
                    status: TenantDatabaseStatus.ACTIVE,
                },
            });

            await hooks?.afterCreate?.({
                tenantId,
                databaseName,
                databaseId,
                mode,
                user,
            });

            console.log(
                `Successfully created Cloudflare D1 tenant database ${databaseName} (${databaseId}) for tenant ${tenantId}`
            );
        } catch (error) {
            console.error(
                `${CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.DATABASE_CREATION_FAILED} for tenant ${tenantId}:`,
                error
            );
            // Note: We don't throw here to avoid breaking the parent operation
        }
    };

    /**
     * Deletes a tenant database for the given tenant ID
     */
    const deleteTenantDatabase = async (tenantId: string, adapter: any, user?: User): Promise<void> => {
        try {
            // Find existing database
            const existing = (await adapter.findOne({
                model: "tenantDatabase",
                where: [
                    { field: "tenantId", value: tenantId },
                    { field: "tenantType", value: mode },
                    { field: "status", value: TenantDatabaseStatus.ACTIVE },
                ],
            })) as TenantDatabase | null;

            if (!existing) {
                console.log(`${CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.DATABASE_NOT_FOUND} for tenant ${tenantId}`);
                return;
            }

            await hooks?.beforeDelete?.({
                tenantId,
                databaseName: existing.databaseName,
                databaseId: existing.databaseId,
                mode,
                user,
            });

            // Mark as deleting
            await adapter.update({
                model: "tenantDatabase",
                where: [{ field: "id", value: existing.id }],
                update: { status: TenantDatabaseStatus.DELETING },
            });

            // Delete via Cloudflare API
            await cf.d1.database.delete(existing.databaseId, {
                account_id: cloudflareD1Api.accountId,
            });

            // Mark as deleted
            await adapter.update({
                model: "tenantDatabase",
                where: [{ field: "id", value: existing.id }],
                update: {
                    status: TenantDatabaseStatus.DELETED,
                    deletedAt: new Date(),
                },
            });

            await hooks?.afterDelete?.({ tenantId, mode, user });

            console.log(`Successfully deleted Cloudflare D1 tenant database for tenant ${tenantId}`);
        } catch (error) {
            console.error(
                `${CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES.DATABASE_DELETION_FAILED} for tenant ${tenantId}:`,
                error
            );
            // Note: We don't throw here to avoid breaking the parent operation
        }
    };

    return {
        id: "cloudflare-d1-multi-tenancy",

        schema: mergedSchema,

        // User-based multi-tenancy
        ...(mode === "user" && {
            // After user creation, create a tenant database for the user
            databaseHooks: {
                user: {
                    create: {
                        after: async (user: User, ctx: { context: AuthContext }) => {
                            await createTenantDatabase(user.id, ctx.context.adapter, user);
                        },
                    },
                },
            },
            // After user deletion, delete the tenant database for the user
            hooks: {
                after: [
                    {
                        matcher: context => context.path === "/delete-user",
                        handler: createAuthMiddleware(async ctx => {
                            const returned = ctx.context.returned as any;
                            const deletedUser = returned?.user;
                            if (deletedUser?.id) {
                                await deleteTenantDatabase(deletedUser.id, ctx.context.adapter, deletedUser);
                            }
                        }),
                    },
                ],
            },
        }),

        // Organization-based multi-tenancy
        ...(mode === "organization" && {
            hooks: {
                after: [
                    // After organization creation, create a tenant database for the organization
                    {
                        matcher: context => context.path === "/organization/create",
                        handler: createAuthMiddleware(async ctx => {
                            const returned = ctx.context.returned as any;
                            const organization = returned?.data;
                            if (organization?.id) {
                                await createTenantDatabase(
                                    organization.id,
                                    ctx.context.adapter,
                                    ctx.context.session?.user
                                );
                            }
                        }),
                    },
                    // After organization deletion, delete the tenant database for the organization
                    {
                        matcher: context => context.path === "/organization/delete",
                        handler: createAuthMiddleware(async ctx => {
                            const organizationId = ctx.body?.organizationId;
                            if (organizationId) {
                                await deleteTenantDatabase(
                                    organizationId,
                                    ctx.context.adapter,
                                    ctx.context.session?.user
                                );
                            }
                        }),
                    },
                ],
            },
        }),
    } satisfies BetterAuthPlugin;
};

/**
 * Helper function to get the Cloudflare D1 tenant database name for a given tenant ID
 * Useful for connecting to the correct tenant database in your application
 */
export const getCloudflareD1TenantDatabaseName = (tenantId: string, prefix = "tenant_"): string => {
    return `${prefix}${tenantId}`;
};

/**
 * Type helper for inferring the Cloudflare D1 multi-tenancy plugin configuration
 */
export type CloudflareD1MultiTenancyPlugin = ReturnType<typeof cloudflareD1MultiTenancy>;
