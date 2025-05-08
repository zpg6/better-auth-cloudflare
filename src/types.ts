import type { KVNamespace } from "@cloudflare/workers-types";

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
     * KV namespace for secondary storage
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
