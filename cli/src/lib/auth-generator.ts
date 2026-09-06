export interface AuthConfig {
    template: "hono" | "nextjs";
    database: "sqlite" | "postgres" | "mysql";
    geolocation?: boolean;
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

export function generateAuthSchemaFile(config: AuthConfig): string {
    const typeImports = [config.database === "sqlite" ? "D1Database" : "", config.resources.r2 ? "R2Bucket" : ""]
        .filter(Boolean)
        .join(", ");
    const imports = [
        typeImports ? `import type { ${typeImports} } from "@cloudflare/workers-types";` : "",
        `import { drizzleAdapter } from "@better-auth/drizzle-adapter";`,
        `import { betterAuth } from "better-auth";`,
        config.template === "nextjs"
            ? `import { anonymous, openAPI } from "better-auth/plugins";`
            : `import { anonymous } from "better-auth/plugins";`,
        `import { withCloudflare } from "better-auth-cloudflare";`,
        config.database === "sqlite" ? `import { drizzle } from "drizzle-orm/d1";` : "",
    ].filter(Boolean);
    const database = config.database === "sqlite" ? `drizzle({} as D1Database)` : `{} as any`;
    const plugins = config.template === "nextjs" ? "[openAPI(), anonymous()]" : "[anonymous()]";

    return `${imports.join("\n")}

const db = ${database};

export const auth = betterAuth({
    baseURL: "http://localhost",
    secret: "schema-generation-only-secret-32-characters",
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: ${config.geolocation !== false},
            cf: {},${generateSchemaConfig(config)}
        },
        {
${generateStorageConfig(config, "            ")}
            plugins: ${plugins},
        }
    ),
    database: ${generateCliDatabaseConfig(config)},
});
`;
}

function generateHonoAuth(config: AuthConfig): string {
    const imports = [
        `import type { IncomingRequestCfProperties } from "@cloudflare/workers-types";`,
        `import { betterAuth } from "better-auth";`,
        `import { withCloudflare } from "better-auth-cloudflare";`,
        `import { anonymous } from "better-auth/plugins";`,
    ];

    if (config.database === "sqlite") {
        imports.push(`import { drizzle } from "drizzle-orm/d1";`);
    } else if (config.database === "postgres") {
        imports.push(`import { drizzle } from "drizzle-orm/postgres-js";`);
        imports.push(`import postgres from "postgres";`);
    } else {
        imports.push(`import { drizzle } from "drizzle-orm/mysql2";`);
        imports.push(`import { createConnection } from "mysql2/promise";`);
    }

    imports.push(`import { schema } from "../db";`, `import type { CloudflareBindings } from "../env";`);

    const cloudflareConfig = generateHonoCloudflareConfig(config);
    const storageConfig = generateStorageConfig(config);

    return `${imports.join("\n")}

export async function createAuth(env: CloudflareBindings, cf?: IncomingRequestCfProperties, baseURL?: string) {
    const db = ${generateDbConnection(config)};

    return betterAuth({
        baseURL,
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: ${config.geolocation !== false},
                cf: cf || {},${cloudflareConfig}
            },
            {
                emailAndPassword: {
                    enabled: true,
                },
                plugins: [anonymous()],
${storageConfig}
            }
        ),
    });
}
`;
}

function generateNextjsAuth(config: AuthConfig): string {
    const imports = [
        `import { getCloudflareContext } from "@opennextjs/cloudflare";`,
        `import { betterAuth } from "better-auth";`,
        `import { withCloudflare } from "better-auth-cloudflare";`,
        `import { anonymous, openAPI } from "better-auth/plugins";`,
    ];

    imports.push(`import { getDb } from "../db";`);

    const cloudflareConfig = generateNextjsCloudflareConfig(config);
    const storageConfig = generateStorageConfig(config);
    const initializer = config.resources.hyperdrive
        ? `export async function initAuth() {
    return authBuilder();
}`
        : `let authInstance: Awaited<ReturnType<typeof authBuilder>> | null = null;

export async function initAuth() {
    if (!authInstance) {
        authInstance = await authBuilder();
    }
    return authInstance;
}`;

    return `${imports.join("\n")}

async function authBuilder() {
    const dbInstance = await getDb();
    const cfCtx = getCloudflareContext();
    return betterAuth({
        ...withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: ${config.geolocation !== false},
                cf: cfCtx.cf,${cloudflareConfig}
            },
            {
                baseURL: cfCtx.env.BETTER_AUTH_URL,
                trustedOrigins: (cfCtx.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "").split(",").filter(Boolean),
${storageConfig}
                plugins: [openAPI(), anonymous()],
            }
        ),
    });
}

${initializer}
`;
}

function generateHonoCloudflareConfig(config: AuthConfig): string {
    const parts: string[] = [];

    if (config.resources.d1) {
        parts.push(`
                d1: {
                    db,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },`);
    } else if (config.resources.hyperdrive) {
        parts.push(`
                ${config.database === "postgres" ? "postgres" : "mysql"}: {
                    db,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },`);
    }

    if (config.resources.kv) {
        parts.push(`
                kv: env.${config.bindings.kv || "KV"},`);
    }

    if (config.resources.r2) {
        parts.push(`
                // R2 configuration for file storage (${config.bindings.r2 || "R2_BUCKET"} binding from wrangler.toml)
                r2: {
                    bucket: env.${config.bindings.r2 || "R2_BUCKET"},
                    maxFileSize: 2 * 1024 * 1024,
                    allowedTypes: [".jpg", ".jpeg", ".png", ".gif"],
                    additionalFields: {
                        category: { type: "string", required: false },
                        isPublic: { type: "boolean", required: false },
                        description: { type: "string", required: false },
                    },
                    hooks: {
                        upload: {
                            before: async (file, ctx) => {
                                if (ctx.session === null) {
                                    return null;
                                }

                                const isPaidUser = (userId: string) => true;
                                if (isPaidUser(ctx.session.user.id) === false) {
                                    return null;
                                }
                            },
                            after: async (file) => {
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
                },`);
    }

    return parts.join("");
}

function generateNextjsCloudflareConfig(config: AuthConfig): string {
    const parts: string[] = [];

    if (config.resources.d1) {
        parts.push(`
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },`);
    } else if (config.resources.hyperdrive) {
        parts.push(`
                ${config.database === "postgres" ? "postgres" : "mysql"}: {
                    db: dbInstance,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },`);
    }

    if (config.resources.kv) {
        parts.push(`
                kv: cfCtx.env.${config.bindings.kv || "KV"},`);
    }

    if (config.resources.r2) {
        parts.push(`
                r2: {
                    bucket: cfCtx.env.${config.bindings.r2 || "R2_BUCKET"},
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
                },`);
    }

    return parts.join("");
}

function generateSchemaConfig(config: AuthConfig): string {
    const parts: string[] = [];

    if (config.resources.r2) {
        parts.push(`
            r2: {
                bucket: {} as R2Bucket,
                additionalFields: {
                    category: { type: "string", required: false },
                    isPublic: { type: "boolean", required: false },
                    description: { type: "string", required: false },
                },
            },`);
    }

    return parts.join("");
}

function generateStorageConfig(config: AuthConfig, indent = "                "): string {
    const lines = config.resources.kv
        ? [
              "verification: {",
              "    storeInDatabase: true,",
              "},",
              "rateLimit: {",
              "    enabled: true,",
              '    storage: "database",',
              "},",
          ]
        : ["rateLimit: {", "    enabled: true,", "},"];
    return lines.map(line => indent + line).join("\n");
}

function generateDbConnection(config: AuthConfig): string {
    const binding = config.bindings.hyperdrive || "HYPERDRIVE";
    if (config.database === "sqlite") {
        return `drizzle(env.${config.bindings.d1 || "DATABASE"}, { schema, logger: true })`;
    } else if (config.database === "postgres") {
        return `drizzle(postgres(env.${binding}.connectionString, { max: 5, fetch_types: false, prepare: true }), { schema, logger: true })`;
    } else {
        return `drizzle(await createConnection({
        host: env.${binding}.host,
        user: env.${binding}.user,
        password: env.${binding}.password,
        database: env.${binding}.database,
        port: env.${binding}.port,
        disableEval: true,
    }), { schema, mode: "default", logger: true })`;
    }
}

function generateCliDatabaseConfig(config: AuthConfig): string {
    const provider = config.database === "sqlite" ? "sqlite" : config.database === "postgres" ? "pg" : "mysql";

    return `drizzleAdapter(db, {
        provider: "${provider}",
        usePlural: true,
        debugLogs: true,
    })`;
}
