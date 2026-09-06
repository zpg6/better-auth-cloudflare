import type { D1Database } from "@cloudflare/workers-types";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { withCloudflare } from "better-auth-cloudflare";

const db = drizzle({} as D1Database);

export const auth = betterAuth({
    baseURL: "http://localhost",
    secret: "schema-generation-only-secret-32-characters",
    ...withCloudflare(
        { autoDetectIpAddress: true, geolocationTracking: true, cf: {} },
        {
            emailAndPassword: { enabled: true },
            plugins: [anonymous()],
        }
    ),
    database: drizzleAdapter(db, {
        provider: "sqlite",
        usePlural: true,
        debugLogs: true,
    }),
    advanced: { database: { validateSchema: false } },
});
