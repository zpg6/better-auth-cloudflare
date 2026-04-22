import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
    // Initialize Drizzle with your D1 binding (e.g., "DB" or "DATABASE" from wrangler.toml)
    return drizzle(env.db, {
        // Ensure "DATABASE" matches your D1 binding name in wrangler.toml
        schema,
        logger: true, // Optional
    });
}