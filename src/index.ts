import type { KVNamespace } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type BetterAuthOptions, type BetterAuthPlugin, type SecondaryStorage, type Session } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint } from "better-auth/api";
import { schema } from "./schema";
import type { CloudflareGeolocation, CloudflarePluginOptions, WithCloudflareOptions } from "./types";
export * from "./client";
export * from "./schema";
export * from "./types";

/**
 * Cloudflare integration for Better Auth
 *
 * @param options - Plugin configuration options
 * @returns Better Auth plugin for Cloudflare
 */
export const cloudflare = (options?: CloudflarePluginOptions) => {
    const opts = options ?? {};

    // Default geolocationTracking to true if not specified
    const geolocationTrackingEnabled = opts.geolocationTracking === undefined || opts.geolocationTracking === true;

    return {
        id: "cloudflare",
        schema: schema(opts), // schema function will also default geolocationTracking to true
        endpoints: {
            getGeolocation: createAuthEndpoint(
                "/cloudflare/geolocation",
                {
                    method: "GET",
                },
                async ctx => {
                    const session = ctx.context?.session;
                    if (!session) {
                        return ctx.json({ error: "Unauthorized" }, { status: 401 });
                    }

                    // Original code threw an error if ctx.request was not available.
                    // Retaining similar logic but returning a 500 status code.
                    if (!ctx.request) {
                        return ctx.json({ error: "Request is not available" }, { status: 500 });
                    }

                    const cf = getCloudflareContext().cf;
                    if (!cf) {
                        return ctx.json({ error: "Cloudflare context is not available" }, { status: 404 });
                    }

                    // Extract and validate Cloudflare geolocation data
                    const context: CloudflareGeolocation = {
                        timezone: cf.timezone as string,
                        city: cf.city as string,
                        country: cf.country as string,
                        region: cf.region as string,
                        regionCode: cf.regionCode as string,
                        colo: cf.colo,
                        latitude: cf.latitude,
                        longitude: cf.longitude,
                    };

                    return ctx.json(context);
                }
            ),
        },

        init(init_ctx) {
            return {
                options: {
                    databaseHooks: {
                        session: {
                            create: {
                                before: async (s: any) => {
                                    if (!geolocationTrackingEnabled) {
                                        return s;
                                    }
                                    const cf = (await getCloudflareContext({ async: true })).cf;
                                    s.timezone = cf?.timezone;
                                    s.city = cf?.city;
                                    s.country = cf?.country;
                                    s.region = cf?.region;
                                    s.regionCode = cf?.regionCode;
                                    s.colo = cf?.colo;
                                    s.latitude = cf?.latitude;
                                    s.longitude = cf?.longitude;

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
 * Get geolocation data from Cloudflare context
 *
 * Includes: ipAddress, timezone, city, country, region, regionCode, colo,
 * latitude, longitude
 *
 * @returns Cloudflare geolocation data
 * @throws Error if Cloudflare context is not available
 */
export const getGeolocation = (): CloudflareGeolocation | undefined => {
    const cf = getCloudflareContext().cf;
    if (!cf) {
        throw new Error("Cloudflare context is not available");
    }
    return {
        timezone: cf.timezone || "Unknown",
        city: cf.city || "Unknown",
        country: cf.country || "Unknown",
        region: cf.region || "Unknown",
        regionCode: cf.regionCode || "Unknown",
        colo: cf.colo || "Unknown",
        latitude: cf.latitude || "Unknown",
        longitude: cf.longitude || "Unknown",
    };
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
export const withCloudflare = (
    cloudFlareOptions: WithCloudflareOptions,
    options: BetterAuthOptions
): BetterAuthOptions => {
    const autoDetectIpEnabled =
        cloudFlareOptions.autoDetectIpAddress === undefined || cloudFlareOptions.autoDetectIpAddress === true;
    const geolocationTrackingForSession =
        cloudFlareOptions.geolocationTracking === undefined || cloudFlareOptions.geolocationTracking === true;

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
    };
};

export type SessionWithGeolocation = Session & CloudflareGeolocation;
