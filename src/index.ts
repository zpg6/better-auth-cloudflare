import type { KVNamespace } from "@cloudflare/workers-types";
import {
    type AdapterInstance,
    type BetterAuthOptions,
    type BetterAuthPlugin,
    type SecondaryStorage,
    type Session,
} from "better-auth";
import { adapterRouter, type AdapterRouterParams } from "better-auth/adapters/adapter-router";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { cloudflareD1MultiTenancy, createTenantDatabaseClient } from "./d1-multi-tenancy/index.js";
import { createR2Endpoints, createR2Storage } from "./r2.js";
import { schema } from "./schema.js";
import type { CloudflareGeolocation, CloudflarePluginOptions, WithCloudflareOptions } from "./types.js";
export * from "./client.js";
export * from "./d1-multi-tenancy/index.js";
export type { TenantRoutingCallback } from "./d1-multi-tenancy/types.js";
export * from "./r2.js";
export * from "./schema.js";
export * from "./types.js";

/**
 * Cloudflare integration for Better Auth
 *
 * @param options - Plugin configuration options
 * @returns Better Auth plugin for Cloudflare
 */
export const cloudflare = (options?: CloudflarePluginOptions) => {
    const opts = options ?? {};

    // Default geolocationTracking to true if not specified
    const geolocationTrackingEnabled = opts.geolocationTracking === undefined || opts.geolocationTracking;

    let r2Storage: ReturnType<typeof createR2Storage> | null = null;

    return {
        id: "cloudflare",
        schema: schema(opts),
        endpoints: {
            getGeolocation: createAuthEndpoint(
                "/cloudflare/geolocation",
                {
                    method: "GET",
                },
                async ctx => {
                    const session = await getSessionFromCtx(ctx);
                    if (!session) {
                        return ctx.json({ error: "Unauthorized" }, { status: 401 });
                    }

                    const cf = await Promise.resolve(opts.cf);
                    if (!cf) {
                        return ctx.json({ error: "Cloudflare context is not available" }, { status: 404 });
                    }

                    // Extract and validate Cloudflare geolocation data
                    const context = extractGeolocationData(cf);

                    return ctx.json(context);
                }
            ),
            ...(opts.r2 ? createR2Endpoints(() => r2Storage, opts.r2) : {}),
        },

        init(init_ctx) {
            if (opts.r2) {
                r2Storage = createR2Storage(opts.r2, init_ctx.generateId);
            }
            return {
                options: {
                    databaseHooks: {
                        session: {
                            create: {
                                before: async (s: any) => {
                                    if (!geolocationTrackingEnabled) {
                                        return s;
                                    }
                                    const cf = await Promise.resolve(opts.cf);
                                    if (!cf) {
                                        return s;
                                    }
                                    const geoData = extractGeolocationData(cf);
                                    s.timezone = geoData.timezone;
                                    s.city = geoData.city;
                                    s.country = geoData.country;
                                    s.region = geoData.region;
                                    s.regionCode = geoData.regionCode;
                                    s.colo = geoData.colo;
                                    s.latitude = geoData.latitude;
                                    s.longitude = geoData.longitude;
                                    return s;
                                },
                            },
                        },
                    },
                },
            };
        },
    } satisfies BetterAuthPlugin;
};

/**
 * Safely extracts CloudflareGeolocation data, ignoring undefined values or other fields
 */
function extractGeolocationData(input: CloudflareGeolocation): CloudflareGeolocation {
    if (!input || typeof input !== "object") {
        return {};
    }

    return {
        timezone: input.timezone || undefined,
        city: input.city || undefined,
        country: input.country || undefined,
        region: input.region || undefined,
        regionCode: input.regionCode || undefined,
        colo: input.colo || undefined,
        latitude: input.latitude || undefined,
        longitude: input.longitude || undefined,
    };
}

/**
 * Creates secondary storage using Cloudflare KV
 *
 * @param kv - Cloudflare KV namespace
 * @returns SecondaryStorage implementation
 */
export const createKVStorage = (kv: KVNamespace<string>): SecondaryStorage => {
    return {
        get: async (key: string) => {
            return kv.get(key);
        },
        set: async (key: string, value: string, ttl?: number) => {
            return kv.put(key, value, ttl ? { expirationTtl: ttl } : undefined);
        },
        delete: async (key: string) => {
            return kv.delete(key);
        },
    };
};

/**
 * Type helper to infer the enhanced auth type with Cloudflare plugin
 */
type WithCloudflareAuth<T extends BetterAuthOptions> = T & {
    plugins: [ReturnType<typeof cloudflare>, ...(T["plugins"] extends readonly any[] ? T["plugins"] : [])];
};

/**
 * Enhances BetterAuthOptions with Cloudflare-specific configurations.
 *
 * This function integrates Cloudflare services like D1 for database and KV for secondary storage,
 * and sets up IP address detection and geolocation tracking based on the provided Cloudflare options.
 *
 * @param cloudFlareOptions - Options for configuring Cloudflare integration.
 * @param options - The base BetterAuthOptions to be enhanced.
 * @returns BetterAuthOptions configured for use with Cloudflare.
 */
export const withCloudflare = <T extends BetterAuthOptions>(
    cloudFlareOptions: WithCloudflareOptions,
    options: T
): WithCloudflareAuth<T> => {
    const autoDetectIpEnabled =
        cloudFlareOptions.autoDetectIpAddress === undefined || cloudFlareOptions.autoDetectIpAddress === true;
    const geolocationTrackingForSession =
        cloudFlareOptions.geolocationTracking === undefined || cloudFlareOptions.geolocationTracking === true;

    if (autoDetectIpEnabled || geolocationTrackingForSession) {
        if (!cloudFlareOptions.cf) {
            throw new Error(
                "Cloudflare context is required for geolocation or IP detection features. Be sure to pass the `cf` option to the withCloudflare function."
            );
        }
    }

    let updatedAdvanced = { ...options.advanced };
    if (autoDetectIpEnabled) {
        updatedAdvanced.ipAddress = {
            ...(updatedAdvanced.ipAddress ?? {}),
            ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", ...(updatedAdvanced.ipAddress?.ipAddressHeaders ?? [])],
        };
    } else if (updatedAdvanced.ipAddress?.ipAddressHeaders) {
        // If autoDetectIp is disabled, ensure our headers are not in the list if they were added by default elsewhere
        // This part is tricky as we don't know if they were from the user or our default.
        // A safer approach might be to just rely on the user to not list them if they disable this flag.
        // For now, let's assume if autoDetectIpEnabled is false, the user manages headers explicitly.
    }

    let updatedSession = { ...options.session };
    if (geolocationTrackingForSession) {
        updatedSession.storeSessionInDatabase = true;
    } else if (options.session?.storeSessionInDatabase === undefined) {
        // If geolocationTracking is false, and the user hasn't set a preference for storeSessionInDatabase,
        // it will remain undefined (i.e., Better Auth core default behavior).
        // If user explicitly set it to true/false, that will be respected.
    }

    // Assert that only one database configuration is provided
    const dbConfigs = [cloudFlareOptions.postgres, cloudFlareOptions.mysql, cloudFlareOptions.d1].filter(Boolean);
    if (dbConfigs.length > 1) {
        throw new Error(
            "Only one database configuration can be provided. Please provide only one of postgres, mysql, or d1."
        );
    }

    // Determine which database configuration to use
    let database: AdapterInstance | null = null;
    if (cloudFlareOptions.postgres) {
        database = drizzleAdapter(cloudFlareOptions.postgres.db, {
            provider: "pg",
            ...cloudFlareOptions.postgres.options,
        });
    } else if (cloudFlareOptions.mysql) {
        database = drizzleAdapter(cloudFlareOptions.mysql.db, {
            provider: "mysql",
            ...cloudFlareOptions.mysql.options,
        });
    } else if (cloudFlareOptions.d1) {
        database = drizzleAdapter(cloudFlareOptions.d1.db, {
            provider: "sqlite",
            ...cloudFlareOptions.d1.options,
        });
    }

    // Collect plugins to include
    const plugins: BetterAuthPlugin[] = [cloudflare(cloudFlareOptions)];

    // Add D1 multi-tenancy plugin if configured
    if (cloudFlareOptions.d1 && cloudFlareOptions.d1.multiTenancy) {
        // If organization mode is enabled, ensure the organization plugin is present
        if (cloudFlareOptions.d1.multiTenancy.mode === "organization") {
            const hasOrganizationPlugin = options.plugins?.some(plugin => plugin.id === "organization");

            if (!hasOrganizationPlugin) {
                throw new Error(
                    "Organization mode for D1 multi-tenancy requires the 'organization' plugin to be enabled. " +
                        "Please add the organization plugin to your Better Auth configuration: " +
                        "import { organization } from 'better-auth/plugins' and include it in your plugins array."
                );
            }
        }

        // If D1 multi-tenancy is enabled, assert we have the main D1 configuration
        if (!cloudFlareOptions.d1.db) {
            throw new Error("D1 multi-tenancy requires the main D1 configuration to be provided.");
        }

        // Note: tenantSchema is optional with table-based routing
        // The adapter will automatically filter the unified schema for tenant tables

        const d1Config = cloudFlareOptions.d1;
        const multiTenancyConfig = d1Config.multiTenancy!;

        // Define which tables belong in the main database vs tenant databases
        const defaultCoreModels = [
            "user",
            "users",
            "account",
            "accounts",
            "session",
            "sessions",
            "organization",
            "organizations",
            "member",
            "members",
            "invitation",
            "invitations",
            "verification",
            "verifications",
            "tenant",
            "tenants",
        ];

        // Handle both array and callback configurations for core models
        const coreModels: string[] =
            typeof multiTenancyConfig.coreModels === "function"
                ? multiTenancyConfig.coreModels(defaultCoreModels)
                : (multiTenancyConfig.coreModels ?? defaultCoreModels);

        const CORE_AUTH_TABLES = new Set(coreModels);

        database = adapterRouter({
            fallbackAdapter: drizzleAdapter(d1Config.db, {
                provider: "sqlite",
                ...d1Config.options,
            }),
            routes: [
                async ({ modelName, operation, data, fallbackAdapter }) => {
                    try {
                        // Extract tenantId from data - first try custom callback, then fall back to default logic
                        let tenantId: string | undefined;

                        // Try custom tenant routing callback first
                        if (multiTenancyConfig.tenantRouting) {
                            try {
                                const customTenantId = await multiTenancyConfig.tenantRouting({
                                    modelName,
                                    operation,
                                    data,
                                    fallbackAdapter,
                                } as AdapterRouterParams);
                                if (customTenantId) {
                                    tenantId = customTenantId;
                                }
                            } catch (error) {
                                console.error(
                                    `[AdapterRouter] Error in custom tenant routing for ${modelName}:`,
                                    error
                                );
                                // Continue to fallback logic
                            }
                        }

                        // Fall back to default tenant ID extraction if custom callback didn't return a value
                        if (!tenantId) {
                            if (operation === "create" && data && typeof data === "object" && !Array.isArray(data)) {
                                // For create operations, data is the object with the fields
                                if ("tenantId" in data && data.tenantId) {
                                    tenantId = data.tenantId as string;
                                } else if (
                                    "data" in data &&
                                    data.data &&
                                    "tenantId" in data.data &&
                                    data.data.tenantId
                                ) {
                                    tenantId = data.data.tenantId as string;
                                }
                            } else if (data && Array.isArray(data)) {
                                // For findOne/findMany operations, data is directly the where array
                                const tenantIdWhere = data.find(
                                    (w: any) => w.field === "tenantId" || w.field === "tenant_id"
                                );
                                if (tenantIdWhere?.value) {
                                    tenantId = tenantIdWhere.value as string;
                                }
                            } else if (data && "where" in data && data.where) {
                                // For other operations, data might have a where property
                                const tenantIdWhere = data.where.find(
                                    (w: any) => w.field === "tenantId" || w.field === "tenant_id"
                                );
                                if (tenantIdWhere?.value) {
                                    tenantId = tenantIdWhere.value as string;
                                }
                            }
                        }

                        // Route to tenant database if:
                        // 1. There's a tenantId in the operation
                        // 2. The table is NOT a core auth table
                        if (tenantId && !CORE_AUTH_TABLES.has(modelName)) {
                            // Look up the actual database ID from the tenant record
                            const tenantRecord: { databaseId: string } | null = await fallbackAdapter.findOne({
                                model: "tenant",
                                where: [
                                    { field: "tenantId", value: tenantId, operator: "eq" },
                                    { field: "tenantType", value: multiTenancyConfig.mode, operator: "eq" },
                                    { field: "status", value: "active", operator: "eq" },
                                ],
                                select: ["databaseId", "tenantId", "status"],
                            });

                            if (!tenantRecord?.databaseId) {
                                return null;
                            }

                            const tenantDb = createTenantDatabaseClient(
                                multiTenancyConfig.cloudflareD1Api.accountId,
                                tenantRecord.databaseId,
                                multiTenancyConfig.cloudflareD1Api.apiToken,
                                multiTenancyConfig.cloudflareD1Api.debugLogs
                            );

                            // Get tenant-specific Drizzle schema (exclude core auth tables)
                            const tenantDrizzleSchema = Object.fromEntries(
                                Object.entries(d1Config.options?.schema || {}).filter(
                                    ([tableName]) => !CORE_AUTH_TABLES.has(tableName)
                                )
                            );

                            return drizzleAdapter(tenantDb, {
                                provider: "sqlite",
                                schema: tenantDrizzleSchema,
                                usePlural: true,
                                debugLogs: true,
                            });
                        }

                        // All core auth tables and operations without tenantId go to main database
                        return null;
                    } catch (error) {
                        console.error(`[AdapterRouter] Error in route for ${modelName}:`, error);
                        return null;
                    }
                },
            ],
            debugLogs: true,
        });

        plugins.push(cloudflareD1MultiTenancy(cloudFlareOptions.d1.multiTenancy));
    }
    if (!database) {
        console.warn("⚠️ No database configuration provided. Please provide one of postgres, mysql, or d1.");
    }

    // Add user-provided plugins
    plugins.push(...(options.plugins ?? []));

    return {
        ...options,
        database,
        secondaryStorage: cloudFlareOptions.kv ? createKVStorage(cloudFlareOptions.kv) : undefined,
        plugins,
        advanced: updatedAdvanced,
        session: updatedSession,
    } as WithCloudflareAuth<T>;
};

export type SessionWithGeolocation = Session & CloudflareGeolocation;
