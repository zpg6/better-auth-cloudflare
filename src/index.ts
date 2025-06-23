import type { KVNamespace } from "@cloudflare/workers-types";
import { type BetterAuthOptions, type BetterAuthPlugin, type SecondaryStorage, type Session } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { schema } from "./schema.js";
import { createR2Storage, createR2Endpoints } from "./r2.js";
import type { CloudflareGeolocation, CloudflarePluginOptions, WithCloudflareOptions } from "./types.js";
export * from "./client.js";
export * from "./schema.js";
export * from "./types.js";
export * from "./r2.js";

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

    return {
        ...options,
        database: cloudFlareOptions.d1
            ? drizzleAdapter(cloudFlareOptions.d1.db, {
                  provider: "sqlite",
                  ...cloudFlareOptions.d1.options,
              })
            : undefined,
        secondaryStorage: cloudFlareOptions.kv ? createKVStorage(cloudFlareOptions.kv) : undefined,
        plugins: [cloudflare(cloudFlareOptions), ...(options.plugins ?? [])],
        advanced: updatedAdvanced,
        session: updatedSession,
    } as WithCloudflareAuth<T>;
};

export type SessionWithGeolocation = Session & CloudflareGeolocation;
