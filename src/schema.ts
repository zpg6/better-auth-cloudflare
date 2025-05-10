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
    timezone: {
        type: "string",
        required: false,
        input: false,
    },
    city: {
        type: "string",
        required: false,
        input: false,
    },
    country: {
        type: "string",
        required: false,
        input: false,
    },
    region: {
        type: "string",
        required: false,
        input: false,
    },
    regionCode: {
        type: "string",
        required: false,
        input: false,
    },
    colo: {
        type: "string",
        required: false,
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
            fields:
                options.geolocationTracking === undefined || options.geolocationTracking === true
                    ? geolocationFields
                    : {},
        },
    } satisfies AuthPluginSchema;
};
