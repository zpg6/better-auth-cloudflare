import type { KVNamespace } from "@cloudflare/workers-types";
import type { DrizzleAdapterConfig } from "better-auth/adapters/drizzle";

/**
 * Storage location for user geolocation data
 */
export type UserGeolocationMode = "user_table" | "session_table" | "geolocation_table" | "kv";

export interface CloudflarePluginOptions {
    /**
     * Auto-detect IP address
     * @default true
     */
    autoDetectIpAddress?: boolean;

    /**
     * How to track geolocation data
     * @default "user_table"
     */
    enableUserGeolocationTracking?: UserGeolocationMode;
}

export interface WithCloudflareOptions extends CloudflarePluginOptions {
    /**
     * D1 database for primary storage, if that's what you're using.
     */
    d1?: {
        /**
         * D1 database for primary storage, if that's what you're using.
         */
        db: D1Database;
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
    ipAddress: string;
    timezone: string;
    city: string;
    country: string;
    region: string;
    regionCode: string;
    colo: string;
    latitude?: string;
    longitude?: string;
}
