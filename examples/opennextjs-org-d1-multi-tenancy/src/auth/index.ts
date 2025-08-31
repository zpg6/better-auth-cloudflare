import { KVNamespace } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { withCloudflare, type TenantRoutingCallback } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, openAPI, organization } from "better-auth/plugins";
import { getDb, schema } from "../db";
import { raw } from "../db/tenant.raw";
import { birthdayPlugin } from "./plugins/birthday";

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb();
    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: getCloudflareContext().cf,
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true, // Optional: Use plural table names (e.g., "users" instead of "user")
                        debugLogs: true, // Optional
                        schema, // Include the full schema for tenant table filtering
                    },
                    multiTenancy: {
                        cloudflareD1Api: {
                            apiToken: process.env.CLOUDFLARE_D1_API_TOKEN!,
                            accountId: process.env.CLOUDFLARE_ACCT_ID!,
                        },
                        mode: "organization", // Create a separate database for each organization
                        databasePrefix: "org_tenant_", // Customize database naming
                        // Automatic schema initialization for new tenant databases
                        migrations: {
                            currentSchema: raw, // Current schema with all tables as they exist now
                            currentVersion: "v1.0.0", // Version identifier for tracking
                        },
                        // Custom tenant routing logic - takes priority over default tenantId field lookup
                        tenantRouting: ({ modelName, operation, data }) => {
                            // Example: For apiKey model, extract tenant ID from the first half of the API key
                            if (modelName === "apiKey" && operation === "findOne" && Array.isArray(data)) {
                                const apiKeyWhere = data.find((w: any) => w.field === "key");
                                if (apiKeyWhere?.value && typeof apiKeyWhere.value === "string") {
                                    const parts = apiKeyWhere.value.split("_");
                                    if (parts.length >= 2 && parts[0]) {
                                        return parts[0]; // Return first part as tenant ID
                                    }
                                }
                            }
                            // Return undefined to fall back to default tenantId field lookup
                            return undefined;
                        },
                        // Extend the tenant database creation and deletion with your own logic
                        hooks: {
                            beforeCreate: async ({ tenantId, mode, user }) => {
                                console.log(`🚀 Creating tenant database for ${mode} ${tenantId}`);
                            },
                            afterCreate: async ({ tenantId, databaseName, databaseId, user }) => {
                                console.log(`✅ Created tenant database ${databaseName} for organization ${tenantId}`);
                                console.log(`🔄 Migrations automatically applied during database creation`);
                            },
                            beforeDelete: async ({ tenantId, databaseName, user }) => {
                                console.log(
                                    `🗑️ About to delete tenant database ${databaseName} for organization ${tenantId}`
                                );
                                // Backup organization data before deletion if needed
                                // await backupOrganizationData(tenantId, databaseName);
                            },
                            afterDelete: async ({ tenantId, user }) => {
                                console.log(`🧹 Cleaned up tenant database for organization ${tenantId}`);
                            },
                        },
                    },
                },
                // Make sure "KV" is the binding in your wrangler.toml
                kv: process.env.KV as KVNamespace<string>,
                // R2 configuration for file storage (R2_BUCKET binding from wrangler.toml)
                r2: {
                    bucket: getCloudflareContext().env.R2_BUCKET,
                    maxFileSize: 2 * 1024 * 1024, // 2MB
                    allowedTypes: [".jpg", ".jpeg", ".png", ".gif"],
                    additionalFields: {
                        category: { type: "string", required: false },
                        isPublic: { type: "boolean", required: false },
                        description: { type: "string", required: false },
                    },
                    hooks: {
                        upload: {
                            before: async (file, ctx) => {
                                // Only allow authenticated users to upload files
                                if (ctx.session === null) {
                                    return null; // Blocks upload
                                }

                                // Only allow paid users to upload files (for example)
                                const isPaidUser = (userId: string) => true; // example
                                if (isPaidUser(ctx.session.user.id) === false) {
                                    return null; // Blocks upload
                                }

                                // Allow upload
                            },
                            after: async (file, ctx) => {
                                // Track your analytics (for example)
                                // File uploaded successfully
                            },
                        },
                        download: {
                            before: async (file, ctx) => {
                                // Only allow user to access their own files (by default all files are public)
                                if (file.isPublic === false && file.userId !== ctx.session?.user.id) {
                                    return null; // Blocks download
                                }
                                // Allow download
                            },
                        },
                    },
                },
            },
            // Your core Better Auth configuration (see Better Auth docs for all options)
            {
                rateLimit: {
                    enabled: true,
                    // ... other rate limiting options
                },
                plugins: [
                    openAPI(),
                    anonymous(),
                    organization(),
                    birthdayPlugin({
                        enableReminders: true,
                        reminderDaysBefore: 7,
                    }),
                ],
                // ... other Better Auth options
            }
        )
    );
}

// Singleton pattern to ensure a single auth instance
let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null;

// Asynchronously initializes and retrieves the shared auth instance
export async function initAuth() {
    if (!authInstance) {
        authInstance = await authBuilder();
    }
    return authInstance;
}

/* ======================================================================= */
/* Configuration for Schema Generation                                     */
/* ======================================================================= */

// This simplified configuration is used by the Better Auth CLI for schema generation.
// It includes only the options that affect the database schema.
// It's necessary because the main `authBuilder` performs operations (like `getDb()`)
// which use `getCloudflareContext` (not available in a CLI context only on Cloudflare).
// For more details, see: https://www.answeroverflow.com/m/1362463260636479488
export const auth = betterAuth({
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: {},
            d1: {
                db: {} as any, // Mock database for schema generation
                options: {
                    usePlural: true,
                    debugLogs: true,
                    schema, // Include the full schema for tenant table filtering
                },
                multiTenancy: {
                    cloudflareD1Api: {
                        apiToken: "mock-token", // Mock for schema generation
                        accountId: "mock-account", // Mock for schema generation
                    },
                    mode: "organization",
                    databasePrefix: "org_tenant_",
                },
            },
            // R2 configuration for schema generation
            r2: {
                bucket: {} as any, // Mock bucket for schema generation
                additionalFields: {
                    category: { type: "string", required: false },
                    isPublic: { type: "boolean", required: false },
                    description: { type: "string", required: false },
                },
            },
            // No actual database or KV instance is needed here, only schema-affecting options
        },
        {
            // Include only configurations that influence the Drizzle schema,
            // e.g., if certain features add tables or columns.
            // socialProviders: { /* ... */ } // If they add specific tables/columns
            plugins: [
                openAPI(),
                anonymous(),
                organization(),
                birthdayPlugin({
                    enableReminders: true,
                    reminderDaysBefore: 7,
                }),
            ],
        }
    ),

    // Used by the Better Auth CLI for schema generation.
    database: drizzleAdapter(process.env.DATABASE as any, {
        // Added 'as any' to handle potential undefined process.env.DATABASE
        provider: "sqlite",
        usePlural: true,
        debugLogs: true,
    }),
});
