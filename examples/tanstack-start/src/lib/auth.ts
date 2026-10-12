import { betterAuth } from "better-auth/minimal";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as  schema from "#/db/schema.ts";
import { getRequest } from "@tanstack/react-start/server";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "cloudflare:workers";

interface ENVToUse {
  db: D1Database,
  kv?: KVNamespace<string>,
  BETTER_AUTH_SECRET?: string,
  BETTER_AUTH_URL?: string;
}


export const auth = betterAuth({
    //...your config
    plugins: [tanstackStartCookies()] // make sure this is the last plugin in the array
})

export function createAuth(env?: ENVToUse , cf?: IncomingRequestCfPropertiesGeographicInformation, baseUrl?: string) {
    // Use actual DB for runtime, empty object for CLI
    const db = env ? drizzle(env.db, { schema: schema, logger: true }) : ({} as any);

    return betterAuth({
        baseURL: baseUrl,
        secret: env?.BETTER_AUTH_SECRET,
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: cf || {},
                d1: env
                    ? {
                          db,
                          options: {
                              usePlural: true,
                              debugLogs: true,
                          },
                      }
                    : undefined,
                // @ts-expect-error we know ts
                kv: env?.kv,
                // Optional: Enable R2 file storage
                // r2: {
                //     bucket: env.R2_BUCKET,
                //     maxFileSize: 10 * 1024 * 1024, // 10MB
                //     allowedTypes: [".jpg", ".jpeg", ".png", ".gif", ".pdf", ".doc", ".docx"],
                //     additionalFields: {
                //         category: { type: "string", required: false },
                //         isPublic: { type: "boolean", required: false },
                //         description: { type: "string", required: false },
                //     },
                // },
            },
            {
                emailAndPassword: {
                    enabled: true,
                },
                rateLimit: {
                    enabled: true,
                    window: 60, // Minimum KV TTL is 60s
                    max: 100, // reqs/window
                    customRules: {
                        // https://github.com/better-auth/better-auth/issues/5452
                        "/sign-in/email": {
                            window: 60,
                            max: 100,
                        },
                        "/sign-in/social": {
                            window: 60,
                            max: 100,
                        },
                    },
                },
            }
        ),
        // Only add database adapter for CLI schema generation
        ...(env
            ? {}
            : {
                  database: drizzleAdapter({} as D1Database, {
                      provider: "sqlite",
                      usePlural: true,
                      debugLogs: true,
                  }),
              }),
        plugins: [tanstackStartCookies()]
    });
}

// Export for CLI schema generation
export default createAuth();

export const getAuthServer = () => {
    const request = getRequest();
     const cf = request.cf as IncomingRequestCfPropertiesGeographicInformation | undefined
    // const origin = new URL(request.url).origin;

    return createAuth(env, cf, env.BETTER_AUTH_URL)
}

