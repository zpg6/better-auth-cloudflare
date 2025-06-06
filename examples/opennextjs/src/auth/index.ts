import { KVNamespace } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db";
import { getCloudflareContext } from "@opennextjs/cloudflare";

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
                    db: dbInstance as any, // to-do: fix this type mismatch
                    options: {
                        usePlural: true, // Optional: Use plural table names (e.g., "users" instead of "user")
                        debugLogs: true, // Optional
                    },
                },
                // Make sure "KV" is the binding in your wrangler.toml
                kv: process.env.KV as KVNamespace<string>,
            },
            // Your core Better Auth configuration (see Better Auth docs for all options)
            {
                emailAndPassword: {
                    enabled: true,
                },
                socialProviders: {
                    // github: { // Example: GitHub social login
                    //     clientId: process.env.GITHUB_CLIENT_ID!,
                    //     clientSecret: process.env.GITHUB_CLIENT_SECRET!,
                    // },
                    // Add other social providers as needed
                },
                rateLimit: {
                    enabled: true,
                    // ... other rate limiting options
                },
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
            // No actual database or KV instance is needed here, only schema-affecting options
        },
        {
            // Include only configurations that influence the Drizzle schema,
            // e.g., if certain features add tables or columns.
            // socialProviders: { /* ... */ } // If they add specific tables/columns
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
