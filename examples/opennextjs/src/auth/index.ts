import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { createDurableObjectRateLimitStorage, withCloudflare } from "better-auth-cloudflare";
import { anonymous, openAPI } from "better-auth/plugins";
import { getDb } from "../db";

async function authBuilder() {
    const dbInstance = await getDb();
    const cfCtx = getCloudflareContext();
    return betterAuth({
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: () => getCloudflareContext().cf,
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },
                kv: cfCtx.env.KV,
                r2: {
                    bucket: cfCtx.env.R2_BUCKET,
                    maxFileSize: 2 * 1024 * 1024,
                    allowedTypes: [".jpg", ".jpeg", ".png", ".gif"],
                    additionalFields: {
                        category: { type: "string", required: false },
                        isPublic: { type: "boolean", required: false },
                        description: { type: "string", required: false },
                    },
                    hooks: {
                        upload: {
                            before: async (_file, ctx) => {
                                if (ctx.session === null) return null;
                            },
                            after: async file => {
                                console.log("File uploaded:", file);
                            },
                        },
                        download: {
                            before: async (file, ctx) => {
                                if (file.isPublic === false && file.userId !== ctx.session?.user.id) {
                                    return null;
                                }
                            },
                        },
                    },
                },
            },
            {
                baseURL: cfCtx.env.BETTER_AUTH_URL,
                trustedOrigins: (cfCtx.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
                verification: {
                    storeInDatabase: true,
                },
                rateLimit: {
                    enabled: true,
                    customStorage: createDurableObjectRateLimitStorage(cfCtx.env.BETTER_AUTH_STORAGE),
                },
                plugins: [openAPI(), anonymous()],
            }
        ),
    });
}

let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null;

export async function initAuth() {
    if (!authInstance) {
        authInstance = await authBuilder();
    }
    return authInstance;
}
