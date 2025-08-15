/**
 * Unit tests for env.d.ts generator
 */

import { describe, test, expect } from "bun:test";
import { generateEnvDFile, validateEnvDContent, type EnvDConfig } from "../src/lib/env-d-generator";

describe("env.d.ts Generator", () => {
    test("generates basic Hono env.d.ts with D1 only", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: true,
                kv: false,
                r2: false,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("export interface CloudflareBindings");
        expect(result).toContain("DATABASE: D1Database;");
        expect(result).toContain("declare global");
        expect(result).toContain("interface ProcessEnv extends CloudflareBindings");
        expect(result).not.toContain("KVNamespace");
        expect(result).not.toContain("R2Bucket");
    });

    test("generates Next.js env.d.ts with D1 only", () => {
        const config: EnvDConfig = {
            template: "nextjs",
            database: "sqlite",
            resources: {
                d1: true,
                kv: false,
                r2: false,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("export interface CloudflareBindings");
        expect(result).toContain("DATABASE: D1Database;");
        expect(result).toContain("declare global");
        expect(result).toContain("interface ProcessEnv extends CloudflareBindings");
    });

    test("generates env.d.ts with custom D1 binding name", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: true,
                kv: false,
                r2: false,
                hyperdrive: false,
            },
            bindings: {
                d1: "MY_DATABASE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("MY_DATABASE: D1Database;");
        expect(result).not.toContain("    DATABASE: D1Database;");
    });

    test("generates env.d.ts with KV namespace", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: true,
                kv: true,
                r2: false,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
                kv: "KV_STORE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("DATABASE: D1Database;");
        expect(result).toContain("KV_STORE: KVNamespace;");
        expect(result).not.toContain("R2Bucket");
    });

    test("generates env.d.ts with R2 bucket", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: true,
                kv: false,
                r2: true,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
                r2: "MY_BUCKET",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("DATABASE: D1Database;");
        expect(result).toContain("MY_BUCKET: R2Bucket;");
        expect(result).not.toContain("KVNamespace");
    });

    test("generates env.d.ts with Hyperdrive (PostgreSQL)", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "postgres",
            resources: {
                d1: false,
                kv: false,
                r2: false,
                hyperdrive: true,
            },
            bindings: {
                hyperdrive: "HYPERDRIVE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("HYPERDRIVE: any;");
        expect(result).not.toContain("D1Database");
        expect(result).not.toContain("KVNamespace");
        expect(result).not.toContain("R2Bucket");
    });

    test("generates env.d.ts with custom Hyperdrive binding name", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "postgres",
            resources: {
                d1: false,
                kv: false,
                r2: false,
                hyperdrive: true,
            },
            bindings: {
                hyperdrive: "MY_DB_CONNECTION",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("MY_DB_CONNECTION: any;");
        expect(result).not.toContain("HYPERDRIVE: any;");
    });

    test("generates env.d.ts with all resources enabled", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: true,
                kv: true,
                r2: true,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
                kv: "KV_STORE",
                r2: "R2_BUCKET",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("DATABASE: D1Database;");
        expect(result).toContain("KV_STORE: KVNamespace;");
        expect(result).toContain("R2_BUCKET: R2Bucket;");
    });

    test("generates env.d.ts with mixed Hyperdrive and KV", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "postgres",
            resources: {
                d1: false,
                kv: true,
                r2: false,
                hyperdrive: true,
            },
            bindings: {
                kv: "SESSION_STORE",
                hyperdrive: "DATABASE_CONNECTION",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("SESSION_STORE: KVNamespace;");
        expect(result).toContain("DATABASE_CONNECTION: any;");
        expect(result).not.toContain("D1Database");
        expect(result).not.toContain("R2Bucket");
    });

    test("generates env.d.ts with no resources (fallback)", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: false,
                kv: false,
                r2: false,
                hyperdrive: false,
            },
            bindings: {},
        };

        const result = generateEnvDFile(config);

        expect(result).toContain("export interface CloudflareBindings");
        expect(result).toContain("// No Cloudflare bindings configured");
        expect(result).toContain("declare global");
        expect(result).toContain("interface ProcessEnv extends CloudflareBindings");
    });

    test("ignores bindings when resources are disabled", () => {
        const config: EnvDConfig = {
            template: "hono",
            database: "sqlite",
            resources: {
                d1: false,
                kv: false,
                r2: false,
                hyperdrive: false,
            },
            bindings: {
                d1: "DATABASE",
                kv: "KV_STORE",
                r2: "R2_BUCKET",
                hyperdrive: "HYPERDRIVE",
            },
        };

        const result = generateEnvDFile(config);

        expect(result).not.toContain("DATABASE: D1Database;");
        expect(result).not.toContain("KV_STORE: KVNamespace;");
        expect(result).not.toContain("R2_BUCKET: R2Bucket;");
        expect(result).not.toContain("HYPERDRIVE: any;");
        expect(result).toContain("// No Cloudflare bindings configured");
    });

    test("validates correct env.d.ts content", () => {
        const validContent = `export interface CloudflareBindings {
    DATABASE: D1Database;
    KV: KVNamespace;
}

declare global {
    namespace NodeJS {
        interface ProcessEnv extends CloudflareBindings {
        }
    }
}`;

        const result = validateEnvDContent(validContent);

        expect(result.isValid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    test("detects missing CloudflareBindings interface", () => {
        const invalidContent = `declare global {
    namespace NodeJS {
        interface ProcessEnv {
        }
    }
}`;

        const result = validateEnvDContent(invalidContent);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Missing CloudflareBindings interface export");
    });

    test("detects missing global declaration", () => {
        const invalidContent = `export interface CloudflareBindings {
    DATABASE: D1Database;
}`;

        const result = validateEnvDContent(invalidContent);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Missing global declaration");
    });

    test("detects missing ProcessEnv extension", () => {
        const invalidContent = `export interface CloudflareBindings {
    DATABASE: D1Database;
}

declare global {
    namespace NodeJS {
        interface ProcessEnv {
        }
    }
}`;

        const result = validateEnvDContent(invalidContent);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Missing ProcessEnv interface extension");
    });

    test("detects mismatched braces", () => {
        const invalidContent = `export interface CloudflareBindings {
    DATABASE: D1Database;

declare global {
    namespace NodeJS {
        interface ProcessEnv extends CloudflareBindings {
        }
    }
}`;

        const result = validateEnvDContent(invalidContent);

        expect(result.isValid).toBe(false);
        expect(result.errors).toContain("Mismatched braces in generated content");
    });

    test("all generated content passes validation", () => {
        const configs: EnvDConfig[] = [
            {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE" },
            },
            {
                template: "nextjs",
                database: "postgres",
                resources: { d1: false, kv: true, r2: true, hyperdrive: true },
                bindings: { kv: "KV", r2: "R2_BUCKET", hyperdrive: "HYPERDRIVE" },
            },
            {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: true, hyperdrive: false },
                bindings: { d1: "DB", kv: "CACHE", r2: "STORAGE" },
            },
        ];

        for (const config of configs) {
            const generated = generateEnvDFile(config);
            const validation = validateEnvDContent(generated);

            expect(validation.isValid).toBe(true);
            if (!validation.isValid) {
                console.error("Validation errors for config:", config);
                console.error("Errors:", validation.errors);
                console.error("Generated content:", generated);
            }
        }
    });
});
