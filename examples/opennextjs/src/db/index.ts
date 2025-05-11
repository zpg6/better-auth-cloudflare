import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./schema";

export async function getDb() {
    // Retrieves Cloudflare-specific context, including environment variables and bindings
    const { env } = await getCloudflareContext({ async: true });

    // Initialize Drizzle with your D1 binding (e.g., "DB" or "DATABASE" from wrangler.toml)
    return drizzle(env.DATABASE, {
        // Ensure "DATABASE" matches your D1 binding name in wrangler.toml
        schema,
        logger: true, // Optional
    });
}

// Re-export the drizzle-orm types and utilities from here for convenience
export * from "drizzle-orm";

// Re-export the feature schemas for use in other files
export * from "@/db/auth.schema";
export * from "./schema";
