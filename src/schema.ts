import type { BetterAuthPluginDBSchema, DBFieldAttribute } from "better-auth/db";
import type { CloudflarePluginOptions } from "./types";

/**
 * Database fields for Cloudflare geolocation
 */
const geolocationFields = {
    timezone: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    city: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    country: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    region: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    regionCode: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    colo: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    latitude: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
    longitude: {
        type: "string",
        required: false,
        input: false,
    } as DBFieldAttribute,
};

/**
 * Core database fields for file tracking
 */
const coreFileFields = {
    userId: {
        type: "string",
        required: true,
        input: false,
        references: {
            model: "user",
            field: "id",
        },
    } as DBFieldAttribute,
    filename: {
        type: "string",
        required: true,
        input: false,
    } as DBFieldAttribute,
    originalName: {
        type: "string",
        required: true,
        input: false,
    } as DBFieldAttribute,
    contentType: {
        type: "string",
        required: true,
        input: false,
    } as DBFieldAttribute,
    size: {
        type: "number",
        required: true,
        input: false,
    } as DBFieldAttribute,
    r2Key: {
        type: "string",
        required: true,
        input: false,
    } as DBFieldAttribute,
    uploadedAt: {
        type: "date",
        required: true,
        input: false,
    } as DBFieldAttribute,
};

/**
 * Generates file tracking fields including custom fields
 */
function generateFileFields(additionalFields?: Record<string, DBFieldAttribute>) {
    const fields = { ...coreFileFields };

    if (additionalFields) {
        for (const [fieldName, fieldConfig] of Object.entries(additionalFields)) {
            // Use FieldAttribute directly - no conversion needed!
            fields[fieldName as keyof typeof fields] = fieldConfig;
        }
    }

    return fields;
}

/**
 * Generates database schema for Cloudflare plugin
 *
 * @param options - Plugin configuration
 * @returns Schema with geolocation fields and file tracking
 */
export const schema = (options: CloudflarePluginOptions) => {
    const sessionFields =
        options.geolocationTracking === undefined || options.geolocationTracking === true ? geolocationFields : {};

    const authSchema: BetterAuthPluginDBSchema = {
        session: {
            fields: sessionFields,
        },
    };

    // Add file tracking table if R2 is configured
    if (options.r2) {
        const fileFields = generateFileFields(options.r2.additionalFields);

        // Use the base model name that Better Auth will pluralize
        // When usePlural is true, "userFile" becomes "userFiles"
        authSchema.userFile = {
            fields: fileFields,
        };
    }

    return authSchema;
};
