import type { AuthPluginSchema } from "better-auth";
import type { FieldAttribute, FieldType } from "better-auth/db";
import type { CloudflarePluginOptions } from "./types";

/**
 * Type for geolocation database fields
 */
type GeolocationFields = {
    [x: string]: FieldAttribute<FieldType>;
};

/**
 * Database fields for Cloudflare geolocation
 */
const geolocationFields: GeolocationFields = {
    ipAddress: {
        type: "string",
        required: true,
        input: false,
    },
    timezone: {
        type: "string",
        required: true,
        input: false,
    },
    city: {
        type: "string",
        required: true,
        input: false,
    },
    country: {
        type: "string",
        required: true,
        input: false,
    },
    region: {
        type: "string",
        required: true,
        input: false,
    },
    regionCode: {
        type: "string",
        required: true,
        input: false,
    },
    colo: {
        type: "string",
        required: true,
        input: false,
    },
    latitude: {
        type: "string",
        required: false,
        input: false,
    },
    longitude: {
        type: "string",
        required: false,
        input: false,
    },
};

/**
 * Generates database schema for Cloudflare plugin
 *
 * @param options - Plugin configuration
 * @returns Schema with geolocation fields
 */
export const schema = (options: CloudflarePluginOptions) => {
    return {
        session: {
            fields: options.enableUserGeolocationTracking === "session_table" ? geolocationFields : {},
        },
        user: {
            fields: options.enableUserGeolocationTracking === "user_table" ? geolocationFields : {},
        },
        ...(options.enableUserGeolocationTracking === "geolocation_table" && {
            geolocation: {
                fields: {
                    userId: {
                        type: "string",
                        required: true,
                        input: false,
                    },
                    ...geolocationFields,
                },
            },
        }),
    } satisfies AuthPluginSchema;
};
