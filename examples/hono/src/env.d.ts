import type { D1Database, KVNamespace } from "@cloudflare/workers-types";

export interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace<string>;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
}
