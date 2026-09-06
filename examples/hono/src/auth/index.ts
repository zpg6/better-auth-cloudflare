import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";
import { betterAuth } from "better-auth";
import { createDurableObjectStorage, withCloudflare } from "better-auth-cloudflare";
import { anonymous } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "../db";
import type { CloudflareBindings } from "../env";

export function createAuth(env: CloudflareBindings, cf?: IncomingRequestCfProperties, baseURL?: string) {
    const db = drizzle(env.DATABASE, { schema, logger: true });
    const secondaryStorage = createDurableObjectStorage(env.BETTER_AUTH_STORAGE);

    return betterAuth({
        baseURL,
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: cf || {},
                d1: {
                    db,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },
            },
            {
                secondaryStorage,
                emailAndPassword: {
                    enabled: true,
                },
                plugins: [anonymous()],
                verification: {
                    storeInDatabase: false,
                },
                rateLimit: {
                    enabled: true,
                    storage: "secondary-storage",
                },
            }
        ),
    });
}
