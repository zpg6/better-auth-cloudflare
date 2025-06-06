import type { KVNamespace } from "@cloudflare/workers-types";
import type { DrizzleAdapterConfig } from "better-auth/adapters/drizzle";
import type { drizzle } from "drizzle-orm/d1";

export interface CloudflarePluginOptions {
    /**
     * Auto-detect IP address
     * @default true
     */
    autoDetectIpAddress?: boolean;

    /**
     * Track geolocation data in the session table
     * @default true
     */
    geolocationTracking?: boolean;

    /**
     * Cloudflare geolocation context
     */
    cf?: CloudflareGeolocation | Promise<CloudflareGeolocation | null> | null;
}

export interface WithCloudflareOptions extends CloudflarePluginOptions {
    /**
     * D1 database for primary storage, if that's what you're using.
     */
    d1?: {
        /**
         * D1 database for primary storage, if that's what you're using.
         */
        db: ReturnType<typeof drizzle>;
        /**
         * Drizzle adapter options for primary storage, if you're using D1.
         */
        options?: Omit<DrizzleAdapterConfig, "provider">;
    };

    /**
     * KV namespace for secondary storage, if you want to use that.
     */
    kv?: KVNamespace<string>;
}

/**
 * Cloudflare geolocation data
 */
export interface CloudflareGeolocation {
    timezone?: string | null;
    city?: string | null;
    country?: string | null;
    region?: string | null;
    regionCode?: string | null;
    colo?: string | null;
    latitude?: string | null;
    longitude?: string | null;
}
