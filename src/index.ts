import type { KVNamespace } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type BetterAuthOptions, type BetterAuthPlugin, type SecondaryStorage } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
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
                    if (!ctx.request) {
                        throw new Error("Request is not available");
                    }

                    const cf = getCloudflareContext().cf;
                    if (!cf) {
                        throw new Error("Cloudflare context is not available");
                    }

                    // Extract and validate Cloudflare geolocation data
                    const context: CloudflareGeolocation = {
                        ipAddress: (cf.ipAddress as string) || "",
                        timezone: (cf.timezone as string) || "",
                        city: (cf.city as string) || "",
                        country: (cf.country as string) || "",
                        region: (cf.region as string) || "",
                        regionCode: (cf.regionCode as string) || "",
                        colo: (cf.colo as string) || "",
                        latitude: cf.latitude,
                        longitude: cf.longitude,
                    };

                    return ctx.json(context);
                }
            ),
        },

        ...(opts.enableUserGeolocationTracking === "kv" && {
            hooks: {
                after: [
                    {
                        matcher: context => {
                            // On completion of the OAuth flow, the session is updated
                            return context.path.startsWith("callback/");
                        },
                        handler: createAuthMiddleware(async ctx => {
                            if (!ctx.context.session) {
                                return;
                            }
                            const cf = getCloudflareContext().cf;
                            if (!cf) {
                                throw new Error("Cloudflare context is not available");
                            }
                            await ctx.context.secondaryStorage?.set(
                                `ip-address:${ctx.context.session.user.id}`,
                                cf.ipAddress as string
                            );
                        }),
                    },
                ],
            },
        }),

        ...(opts.enableUserGeolocationTracking === "user_table" && {
            hooks: {
                after: [
                    {
                        matcher: context => {
                            // On completion of the OAuth flow, the session is updated
                            return context.path.startsWith("callback/");
                        },
                        handler: createAuthMiddleware(async ctx => {
                            if (!ctx.context.session) {
                                return;
                            }
                            const cf = getCloudflareContext().cf;
                            if (!cf) {
                                throw new Error("Cloudflare context is not available");
                            }
                            await ctx.context.adapter.update({
                                model: "user",
                                where: [
                                    {
                                        field: "id",
                                        value: ctx.context.session.user.id,
                                    },
                                ],
                                update: {
                                    ipAddress: (cf.ipAddress as string) || "",
                                    timezone: (cf.timezone as string) || "",
                                    city: (cf.city as string) || "",
                                    country: (cf.country as string) || "",
                                    region: (cf.region as string) || "",
                                    regionCode: (cf.regionCode as string) || "",
                                    colo: (cf.colo as string) || "",
                                    latitude: cf.latitude,
                                    longitude: cf.longitude,
                                },
                            });
                        }),
                    },
                ],
            },
        }),

        ...(opts.enableUserGeolocationTracking === "session_table" && {
            hooks: {
                after: [
                    {
                        matcher: context => {
                            // On completion of the OAuth flow, the session is updated
                            return context.path.startsWith("callback/");
                        },
                        handler: createAuthMiddleware(async ctx => {
                            if (!ctx.context.session) {
                                return;
                            }
                            const cf = getCloudflareContext().cf;
                            if (!cf) {
                                throw new Error("Cloudflare context is not available");
                            }
                            await ctx.context.adapter.update({
                                model: "session",
                                where: [
                                    {
                                        field: "id",
                                        value: ctx.context.session.session.id,
                                    },
                                ],
                                update: {
                                    ipAddress: (cf.ipAddress as string) || "",
                                    timezone: (cf.timezone as string) || "",
                                    city: (cf.city as string) || "",
                                    country: (cf.country as string) || "",
                                    region: (cf.region as string) || "",
                                    regionCode: (cf.regionCode as string) || "",
                                    colo: (cf.colo as string) || "",
                                    latitude: cf.latitude,
                                    longitude: cf.longitude,
                                },
                            });
                        }),
                    },
                ],
            },
        }),
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
export const getGeolocation = (): CloudflareGeolocation => {
    const cf = getCloudflareContext().cf;
    if (!cf) {
        throw new Error("Cloudflare context is not available");
    }
    return {
        ipAddress: (cf.ipAddress as string) || "",
        timezone: (cf.timezone as string) || "",
        city: (cf.city as string) || "",
        country: (cf.country as string) || "",
        region: (cf.region as string) || "",
        regionCode: (cf.regionCode as string) || "",
        colo: (cf.colo as string) || "",
        latitude: cf.latitude,
        longitude: cf.longitude,
    };
};

export const withCloudflare = (
    cloudFlareOptions: WithCloudflareOptions,
    options: BetterAuthOptions
): BetterAuthOptions => {
    return {
        ...options,
        ...{
            database: cloudFlareOptions.d1
                ? drizzleAdapter(cloudFlareOptions.d1, {
                      ...{
                          provider: "sqlite",
                      },
                      ...cloudFlareOptions.d1Options,
                  })
                : undefined,
            plugins: [cloudflare(cloudFlareOptions), ...(options.plugins ?? [])],
            advanced: {
                ipAddress: {
                    ipAddressHeaders: [
                        "cf-connecting-ip",
                        "x-real-ip",
                        ...(options.advanced?.ipAddress?.ipAddressHeaders ?? []),
                    ],
                },
            },
            secondaryStorage: cloudFlareOptions.kv ? createKVStorage(cloudFlareOptions.kv) : undefined,
            session: {
                preserveSessionInDatabase:
                    cloudFlareOptions.enableUserGeolocationTracking === "session_table" ? true : undefined,
            },
        },
    };
};
