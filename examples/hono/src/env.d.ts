import type { D1Database, KVNamespace, SendEmail } from "@cloudflare/workers-types";

export interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace<string>;
    EMAIL: SendEmail;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
    BETTER_AUTH_EMAIL_FROM: string;
}
