import type { CloudflareD1ApiConfig, CloudflareD1CreateResponse, CloudflareD1DeleteResponse } from "./types.js";

/**
 * Error codes for the Cloudflare D1 multi-tenancy plugin
 */
export const CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES = {
    DATABASE_ALREADY_EXISTS: "Tenant database already exists",
    DATABASE_NOT_FOUND: "Tenant database not found",
    DATABASE_CREATION_FAILED: "Failed to create tenant database",
    DATABASE_DELETION_FAILED: "Failed to delete tenant database",
    CLOUDFLARE_D1_API_ERROR: "Cloudflare D1 API error",
    MISSING_API_TOKEN: "Cloudflare API token is required for D1 multi-tenancy",
    MISSING_ACCOUNT_ID: "Cloudflare account ID is required for D1 multi-tenancy",
    INVALID_CREDENTIALS: "Invalid Cloudflare API credentials provided",
} as const;

/**
 * Custom error class for Cloudflare D1 multi-tenancy plugin
 */
export class CloudflareD1MultiTenancyError extends Error {
    constructor(
        public code: keyof typeof CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES,
        message?: string
    ) {
        super(message || CLOUDFLARE_D1_MULTI_TENANCY_ERROR_CODES[code]);
        this.name = "CloudflareD1MultiTenancyError";
    }
}

/**
 * Validates Cloudflare API credentials
 */
export const validateCloudflareCredentials = (config: CloudflareD1ApiConfig): void => {
    if (!config.apiToken || config.apiToken.trim() === "") {
        throw new CloudflareD1MultiTenancyError(
            "MISSING_API_TOKEN",
            "Cloudflare API token is required for D1 multi-tenancy. Please set CLOUDFLARE_D1_API_TOKEN environment variable or provide it in the cloudflareD1Api.apiToken option."
        );
    }

    if (!config.accountId || config.accountId.trim() === "") {
        throw new CloudflareD1MultiTenancyError(
            "MISSING_ACCOUNT_ID",
            "Cloudflare account ID is required for D1 multi-tenancy. Please set CLOUDFLARE_ACCT_ID environment variable or provide it in the cloudflareD1Api.accountId option."
        );
    }
};

/**
 * Creates a D1 database via Cloudflare API
 */
export const createD1Database = async (config: CloudflareD1ApiConfig, databaseName: string): Promise<string> => {
    try {
        const apiResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.apiToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: databaseName,
                }),
            }
        );

        if (!apiResponse.ok) {
            throw new Error(`Cloudflare API error: ${apiResponse.status} ${apiResponse.statusText}`);
        }

        const apiData: CloudflareD1CreateResponse = await apiResponse.json();

        if (!apiData.success && apiData.errors?.length) {
            throw new Error(`Cloudflare D1 API error: ${apiData.errors.map(e => e.message).join(", ")}`);
        }

        const databaseId = apiData.result?.uuid;
        if (!databaseId) {
            throw new CloudflareD1MultiTenancyError(
                "DATABASE_CREATION_FAILED",
                "Failed to get database ID from Cloudflare API response"
            );
        }

        return databaseId;
    } catch (apiError: any) {
        if (apiError.message?.includes("authentication") || apiError.message?.includes("unauthorized")) {
            throw new CloudflareD1MultiTenancyError(
                "INVALID_CREDENTIALS",
                "Failed to authenticate with Cloudflare API. Please verify your API token has D1:edit permissions and your account ID is correct."
            );
        }
        throw new CloudflareD1MultiTenancyError(
            "CLOUDFLARE_D1_API_ERROR",
            `Cloudflare D1 API error: ${apiError.message || "Unknown error"}`
        );
    }
};

/**
 * Deletes a D1 database via Cloudflare API
 */
export const deleteD1Database = async (config: CloudflareD1ApiConfig, databaseId: string): Promise<void> => {
    try {
        const apiResponse = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${databaseId}`,
            {
                method: "DELETE",
                headers: {
                    Authorization: `Bearer ${config.apiToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!apiResponse.ok) {
            throw new Error(`Cloudflare API error: ${apiResponse.status} ${apiResponse.statusText}`);
        }

        const apiData: CloudflareD1DeleteResponse = await apiResponse.json();

        if (!apiData.success && apiData.errors?.length) {
            throw new Error(`Cloudflare D1 API error: ${apiData.errors.map(e => e.message).join(", ")}`);
        }
    } catch (apiError: any) {
        if (apiError.message?.includes("authentication") || apiError.message?.includes("unauthorized")) {
            throw new CloudflareD1MultiTenancyError(
                "INVALID_CREDENTIALS",
                "Failed to authenticate with Cloudflare API. Please verify your API token has D1:edit permissions and your account ID is correct."
            );
        }
        throw new CloudflareD1MultiTenancyError(
            "CLOUDFLARE_D1_API_ERROR",
            `Cloudflare D1 API error during deletion: ${apiError.message || "Unknown error"}`
        );
    }
};

/**
 * Helper function to get the Cloudflare D1 tenant database name for a given tenant ID
 */
export const getCloudflareD1TenantDatabaseName = (tenantId: string, prefix = "tenant_"): string => {
    return `${prefix}${tenantId}`;
};
