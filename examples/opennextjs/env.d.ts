// Based on Wrangler output (`wrangler types --env-interface CloudflareEnv env.d.ts`)
// Uses module imports so that KVNamespace / D1Database resolve to the same
// declaration path the better-auth-cloudflare plugin expects.

import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

declare global {
    interface CloudflareEnv {
        DATABASE: D1Database;
        KV: KVNamespace<string>;
        R2_BUCKET: R2Bucket;
        BETTER_AUTH_SECRET: string;
        BETTER_AUTH_URL: string;
        BETTER_AUTH_TRUSTED_ORIGINS: string;
    }
}

export {};
