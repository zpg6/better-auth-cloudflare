import type { D1Database, DurableObjectNamespace } from "@cloudflare/workers-types";

export interface CloudflareBindings {
    DATABASE: D1Database;
    BETTER_AUTH_STORAGE: DurableObjectNamespace;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
}
