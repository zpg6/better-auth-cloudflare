import type { AuthPluginSchema } from "better-auth";
import type { FieldAttribute, FieldType } from "better-auth/db";
import type { CloudflarePluginOptions } from "./types.js";

/**
 * Type for geolocation database fields
 */
type GeolocationFields = {
    [x: string]: FieldAttribute<FieldType>;
};

/**
 * Type for file tracking database fields
 */
type FileFields = {
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
 * Core database fields for file tracking
 */
const coreFileFields: FileFields = {
    userId: {
        type: "string",
        required: true,
        input: false,
        references: {
            model: "user",
            field: "id",
        },
    },
    filename: {
        type: "string",
        required: true,
        input: false,
    },
    originalName: {
        type: "string",
        required: true,
        input: false,
    },
    contentType: {
        type: "string",
        required: true,
        input: false,
    },
    size: {
        type: "number",
        required: true,
        input: false,
    },
    r2Key: {
        type: "string",
        required: true,
        input: false,
    },
    uploadedAt: {
        type: "date",
        required: true,
        input: false,
    },
};

/**
 * Generates file tracking fields including custom fields
 */
function generateFileFields(additionalFields?: Record<string, FieldAttribute>): FileFields {
    const fields = { ...coreFileFields };

    if (additionalFields) {
        for (const [fieldName, fieldConfig] of Object.entries(additionalFields)) {
            // Use FieldAttribute directly - no conversion needed!
            fields[fieldName] = fieldConfig;
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
