import type { AuthPluginSchema } from "better-auth/db";
import type { FieldAttribute } from "better-auth/db";
import type { CloudflarePluginOptions } from "./types";

/**
 * Database fields for Cloudflare geolocation
 */
const geolocationFields = {
    timezone: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    city: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    country: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    region: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    regionCode: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    colo: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    latitude: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
    longitude: {
        type: "string",
        required: false,
        input: false,
    } as FieldAttribute,
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
    } as FieldAttribute,
    filename: {
        type: "string",
        required: true,
        input: false,
    } as FieldAttribute,
    originalName: {
        type: "string",
        required: true,
        input: false,
    } as FieldAttribute,
    contentType: {
        type: "string",
        required: true,
        input: false,
    } as FieldAttribute,
    size: {
        type: "number",
        required: true,
        input: false,
    } as FieldAttribute,
    r2Key: {
        type: "string",
        required: true,
        input: false,
    } as FieldAttribute,
    uploadedAt: {
        type: "date",
        required: true,
        input: false,
    } as FieldAttribute,
};

/**
 * Generates file tracking fields including custom fields
 */
function generateFileFields(additionalFields?: Record<string, FieldAttribute>) {
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

    const authSchema: AuthPluginSchema = {
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
