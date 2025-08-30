import { drizzle } from "@zpg6-test-pkgs/drizzle-orm/d1-http";
import { type AuthContext, type BetterAuthPlugin, type User } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { initializeTenantDatabase } from "./d1-utils.js";
import { tenantDatabaseSchema, TenantDatabaseStatus, type Tenant } from "./schema.js";
import type { CloudflareD1MultiTenancyOptions } from "./types.js";
import {
    CloudflareD1MultiTenancyError,
    createD1Database,
    deleteD1Database,
    getCloudflareD1TenantDatabaseName,
    validateCloudflareCredentials,
} from "./utils.js";

// Export all types and schema
export * from "./d1-utils.js";
export * from "./schema.js";
export * from "./types.js";

/**
 * Cloudflare D1 Multi-tenancy plugin for Better Auth
 *
 * Provides automatic tenant database creation and deletion for user or organization-level multi-tenancy.
 * Only one mode can be active at a time.
 */
export const cloudflareD1MultiTenancy = (options: CloudflareD1MultiTenancyOptions) => {
    const { cloudflareD1Api, mode, databasePrefix = "tenant_", hooks, migrations } = options;

    // Always use the singular schema key - Better Auth handles pluralization
    const model = Object.keys(tenantDatabaseSchema)[0]; // "tenant" -> table becomes "tenants" with usePlural: true

    /**
     * Creates a tenant database for the given tenant ID
     */
    const createTenantDatabase = async (tenantId: string, adapter: any, user?: User): Promise<void> => {
        try {
            validateCloudflareCredentials(cloudflareD1Api);
            const databaseName = getCloudflareD1TenantDatabaseName(tenantId, databasePrefix);

            const existing = await adapter.findOne({
                model,
                where: [
                    { field: "tenantId", value: tenantId, operator: "eq" },
                    { field: "tenantType", value: mode, operator: "eq" },
                ],
            });

            if (existing && existing.status !== TenantDatabaseStatus.DELETED) {
                return;
            }

            await hooks?.beforeCreate?.({ tenantId, mode, user });

            const dbRecord = await adapter.create({
                model,
                data: {
                    tenantId: tenantId,
                    tenantType: mode,
                    databaseName: databaseName,
                    databaseId: "",
                    status: TenantDatabaseStatus.CREATING,
                    createdAt: new Date(),
                },
            });

            const databaseId = await createD1Database(cloudflareD1Api, databaseName);

            // Initialize the tenant database with current schema if provided
            let resolvedVersion = "unknown";

            if (migrations) {
                const { version } = await initializeTenantDatabase(cloudflareD1Api, databaseId, migrations);
                resolvedVersion = version;
                // Note: New databases get the current schema, so no need to apply migrations
                // Migrations are only for bringing existing databases up to the current level
            } else {
                console.log(`⚠️ No migrations config found - tenant database will be empty`);
            }

            // Update the tenant record with the database ID and migration info
            const updateData: any = {
                databaseId: databaseId,
                status: TenantDatabaseStatus.ACTIVE,
            };

            if (migrations) {
                // New databases start with the resolved current version
                updateData.lastMigrationVersion = resolvedVersion;
                updateData.migrationHistory = JSON.stringify([
                    {
                        version: resolvedVersion,
                        name: `Current Schema (${resolvedVersion})`,
                        appliedAt: new Date().toISOString(),
                    },
                ]);
            }

            await adapter.update({
                model,
                where: [{ field: "id", value: dbRecord.id, operator: "eq" }],
                update: updateData,
            });

            await hooks?.afterCreate?.({
                tenantId,
                databaseName,
                databaseId,
                mode,
                user,
            });
        } catch (error) {
            if (error instanceof CloudflareD1MultiTenancyError) {
                throw error;
            }
            throw new CloudflareD1MultiTenancyError(
                "DATABASE_CREATION_FAILED",
                `Unexpected error creating tenant database: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    };

    /**
     * Deletes a tenant database for the given tenant ID
     */
    const deleteTenantDatabase = async (tenantId: string, adapter: any, user?: User): Promise<void> => {
        try {
            validateCloudflareCredentials(cloudflareD1Api);

            const existing: Tenant | null = await adapter.findOne({
                model,
                where: [
                    { field: "tenantId", value: tenantId, operator: "eq" },
                    { field: "tenantType", value: mode, operator: "eq" },
                    { field: "status", value: TenantDatabaseStatus.ACTIVE, operator: "eq" },
                ],
            });

            if (!existing) {
                return;
            }

            await hooks?.beforeDelete?.({
                tenantId,
                databaseName: existing.databaseName,
                databaseId: existing.databaseId,
                mode,
                user,
            });

            await adapter.update({
                model,
                where: [{ field: "id", value: existing.id }],
                update: { status: TenantDatabaseStatus.DELETING },
            });

            await deleteD1Database(cloudflareD1Api, existing.databaseId);

            await adapter.update({
                model,
                where: [{ field: "id", value: existing.id, operator: "eq" }],
                update: {
                    status: TenantDatabaseStatus.DELETED,
                    deletedAt: new Date(),
                },
            });

            await hooks?.afterDelete?.({ tenantId, mode, user });
        } catch (error) {
            if (error instanceof CloudflareD1MultiTenancyError) {
                throw error;
            }
            throw new CloudflareD1MultiTenancyError(
                "DATABASE_DELETION_FAILED",
                `Unexpected error deleting tenant database: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        }
    };

    return {
        id: "cloudflare-d1-multi-tenancy",
        schema: tenantDatabaseSchema,

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
                            const returned: any = ctx.context.returned;
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
                            const returned: any = ctx.context.returned;
                            const organization = returned?.data || returned?.organization || returned;

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
 * Type helper for inferring the Cloudflare D1 multi-tenancy plugin configuration
 */
export type CloudflareD1MultiTenancyPlugin = ReturnType<typeof cloudflareD1MultiTenancy>;

export const createTenantDatabaseClient = (accountId: string, databaseId: string, token: string, debugLogs?: boolean) => {
    return drizzle(
        {
            accountId,
            databaseId,
            token,
        },
        {
            logger: debugLogs,
        }
    );
};
