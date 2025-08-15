export interface AuthConfig {
    template: "hono" | "nextjs";
    database: "sqlite" | "postgres" | "mysql";
    resources: {
        d1: boolean;
        kv: boolean;
        r2: boolean;
        hyperdrive: boolean;
    };
    bindings: {
        d1?: string;
        kv?: string;
        r2?: string;
        hyperdrive?: string;
    };
}

export function generateAuthFile(config: AuthConfig): string {
    if (config.template === "hono") {
        return generateHonoAuth(config);
    } else {
        return generateNextjsAuth(config);
    }
}

function generateHonoAuth(config: AuthConfig): string {
    const imports = [
        `import type { D1Database, IncomingRequestCfProperties } from "@cloudflare/workers-types";`,
        `import { betterAuth } from "better-auth";`,
        `import { withCloudflare } from "better-auth-cloudflare";`,
        `import { anonymous } from "better-auth/plugins";`,
        `import { drizzleAdapter } from "better-auth/adapters/drizzle";`,
    ];

    // Database-specific imports
    if (config.database === "sqlite") {
        imports.push(`import { drizzle } from "drizzle-orm/d1";`);
    } else if (config.database === "postgres") {
        imports.push(`import { drizzle } from "drizzle-orm/postgres-js";`);
    } else {
        imports.push(`import { drizzle } from "drizzle-orm/mysql2";`);
    }

    imports.push(`import { schema } from "../db";`, `import type { CloudflareBindings } from "../env";`);

    const cloudflareConfig = generateHonoCloudflareConfig(config);
    const cliDatabaseConfig = generateCliDatabaseConfig(config);

    return `${imports.join("\n")}

// Single auth configuration that handles both CLI and runtime scenarios
function createAuth(env?: CloudflareBindings, cf?: IncomingRequestCfProperties) {
    // Use actual DB for runtime, empty object for CLI
    const db = env ? ${generateDbConnection(config)} : ({} as any);

    return betterAuth({
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: cf || {},${cloudflareConfig}
            },
            {
                emailAndPassword: {
                    enabled: true,
                },
                plugins: [anonymous()],
                rateLimit: {
                    enabled: true,
                },
            }
        ),
        // Only add database adapter for CLI schema generation
        ...(env
            ? {}
            : {
                  database: ${cliDatabaseConfig},
              }),
    });
}

// Export for CLI schema generation
export const auth = createAuth();

// Export for runtime usage
export { createAuth };
`;
}

function generateNextjsAuth(config: AuthConfig): string {
    const imports = [
        `import { getCloudflareContext } from "@opennextjs/cloudflare";`,
        `import { betterAuth } from "better-auth";`,
        `import { withCloudflare } from "better-auth-cloudflare";`,
        `import { drizzleAdapter } from "better-auth/adapters/drizzle";`,
        `import { anonymous, openAPI } from "better-auth/plugins";`,
    ];

    if (config.resources.kv) {
        imports.unshift(`import { KVNamespace } from "@cloudflare/workers-types";`);
    }

    imports.push(`import { getDb, schema } from "../db";`);

    const cloudflareConfig = generateNextjsCloudflareConfig(config);
    const cliDatabaseConfig = generateCliDatabaseConfig(config);

    return `${imports.join("\n")}

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb();
    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: getCloudflareContext().cf,${cloudflareConfig}
            },
            // Your core Better Auth configuration (see Better Auth docs for all options)
            {
                rateLimit: {
                    enabled: true,
                    // ... other rate limiting options
                },
                plugins: [openAPI(), anonymous()],
                // ... other Better Auth options
            }
        )
    );
}

// Singleton pattern to ensure a single auth instance
let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null;

// Asynchronously initializes and retrieves the shared auth instance
export async function initAuth() {
    if (!authInstance) {
        authInstance = await authBuilder();
    }
    return authInstance;
}

/* ======================================================================= */
/* Configuration for Schema Generation                                     */
/* ======================================================================= */

// This simplified configuration is used by the Better Auth CLI for schema generation.
// It includes only the options that affect the database schema.
// It's necessary because the main \`authBuilder\` performs operations (like \`getDb()\`)
// which use \`getCloudflareContext\` (not available in a CLI context only on Cloudflare).
// For more details, see: https://www.answeroverflow.com/m/1362463260636479488
export const auth = betterAuth({
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: {},${generateNextjsSchemaConfig(config)}
            // No actual database or KV instance is needed here, only schema-affecting options
        },
        {
            // Include only configurations that influence the Drizzle schema,
            // e.g., if certain features add tables or columns.
            // socialProviders: { /* ... */ } // If they add specific tables/columns
            plugins: [openAPI(), anonymous()],
        }
    ),

    // Used by the Better Auth CLI for schema generation.
    database: ${cliDatabaseConfig},
});
`;
}

function generateHonoCloudflareConfig(config: AuthConfig): string {
    const parts: string[] = [];

    // Database configuration
    if (config.resources.d1) {
        parts.push(`
                d1: env
                    ? {
                          db,
                          options: {
                              usePlural: true,
                              debugLogs: true,
                          },
                      }
                    : undefined,`);
    } else if (config.resources.hyperdrive) {
        parts.push(`
                ${config.database === "postgres" ? "postgres" : "mysql"}: {
                    db
                },`);
    }

    // KV configuration
    if (config.resources.kv) {
        parts.push(`
                kv: env?.${config.bindings.kv || "KV"},`);
    }

    // R2 configuration
    if (config.resources.r2) {
        parts.push(`
                // R2 configuration for file storage (${config.bindings.r2 || "R2_BUCKET"} binding from wrangler.toml)
                r2: {
                    bucket: env?.${config.bindings.r2 || "R2_BUCKET"},
                    maxFileSize: 2 * 1024 * 1024, // 2MB
                    allowedTypes: [".jpg", ".jpeg", ".png", ".gif"],
                    additionalFields: {
                        category: { type: "string", required: false },
                        isPublic: { type: "boolean", required: false },
                        description: { type: "string", required: false },
                    },
                    hooks: {
                        upload: {
                            before: async (file, ctx) => {
                                // Only allow authenticated users to upload files
                                if (ctx.session === null) {
                                    return null; // Blocks upload
                                }

                                // Only allow paid users to upload files (for example)
                                const isPaidUser = (userId: string) => true; // example
                                if (isPaidUser(ctx.session.user.id) === false) {
                                    return null; // Blocks upload
                                }

                                // Allow upload
                            },
                            after: async (file, ctx) => {
                                // Track your analytics (for example)
                                console.log("File uploaded:", file);
                            },
                        },
                        download: {
                            before: async (file, ctx) => {
                                // Only allow user to access their own files (by default all files are public)
                                if (file.isPublic === false && file.userId !== ctx.session?.user.id) {
                                    return null; // Blocks download
                                }
                                // Allow download
                            },
                        },
                    },
                },`);
    }

    return parts.join("");
}

function generateNextjsCloudflareConfig(config: AuthConfig): string {
    const parts: string[] = [];

    // Database configuration
    if (config.resources.d1) {
        parts.push(`
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true, // Optional: Use plural table names (e.g., "users" instead of "user")
                        debugLogs: true, // Optional
                    },
                },`);
    } else if (config.resources.hyperdrive) {
        parts.push(`
                ${config.database === "postgres" ? "postgres" : "mysql"}: {
                    db: dbInstance
                },`);
    }

    // KV configuration
    if (config.resources.kv) {
        parts.push(`
                // Make sure "${config.bindings.kv || "KV"}" is the binding in your wrangler.toml
                kv: process.env.${config.bindings.kv || "KV"} as KVNamespace<string>,`);
    }

    // R2 configuration
    if (config.resources.r2) {
        parts.push(`
                // R2 configuration for file storage (${config.bindings.r2 || "R2_BUCKET"} binding from wrangler.toml)
                r2: {
                    bucket: getCloudflareContext().env.${config.bindings.r2 || "R2_BUCKET"},
                    maxFileSize: 2 * 1024 * 1024, // 2MB
                    allowedTypes: [".jpg", ".jpeg", ".png", ".gif"],
                    additionalFields: {
                        category: { type: "string", required: false },
                        isPublic: { type: "boolean", required: false },
                        description: { type: "string", required: false },
                    },
                    hooks: {
                        upload: {
                            before: async (file, ctx) => {
                                // Only allow authenticated users to upload files
                                if (ctx.session === null) {
                                    return null; // Blocks upload
                                }

                                // Only allow paid users to upload files (for example)
                                const isPaidUser = (userId: string) => true; // example
                                if (isPaidUser(ctx.session.user.id) === false) {
                                    return null; // Blocks upload
                                }

                                // Allow upload
                            },
                            after: async (file, ctx) => {
                                // Track your analytics (for example)
                                console.log("File uploaded:", file);
                            },
                        },
                        download: {
                            before: async (file, ctx) => {
                                // Only allow user to access their own files (by default all files are public)
                                if (file.isPublic === false && file.userId !== ctx.session?.user.id) {
                                    return null; // Blocks download
                                }
                                // Allow download
                            },
                        },
                    },
                },`);
    }

    return parts.join("");
}

function generateSchemaConfig(config: AuthConfig): string {
    const parts: string[] = [];

    // R2 configuration for schema generation
    if (config.resources.r2) {
        parts.push(`
            // R2 configuration for schema generation
            r2: {
                bucket: {} as any, // Mock bucket for schema generation
                additionalFields: {
                    category: { type: "string", required: false },
                    isPublic: { type: "boolean", required: false },
                    description: { type: "string", required: false },
                },
            },`);
    }

    return parts.join("");
}

const generateHonoSchemaConfig = generateSchemaConfig;
const generateNextjsSchemaConfig = generateSchemaConfig;

function generateDbConnection(config: AuthConfig): string {
    if (config.database === "sqlite") {
        return `drizzle(env.${config.bindings.d1 || "DATABASE"}, { schema, logger: true })`;
    } else if (config.database === "postgres") {
        return `drizzle(env.${config.bindings.hyperdrive || "HYPERDRIVE"}, { schema, logger: true })`;
    } else {
        return `drizzle(env.${config.bindings.hyperdrive || "HYPERDRIVE"}, { schema, logger: true })`;
    }
}

function generateCliDatabaseConfig(config: AuthConfig): string {
    const provider = config.database === "sqlite" ? "sqlite" : config.database === "postgres" ? "pg" : "mysql";

    const dbType = config.database === "sqlite" ? "D1Database" : "any";

    return `drizzleAdapter({} as ${dbType}, {
                      provider: "${provider}",
                      usePlural: true,
                      debugLogs: true
                  })`;
}
