import { describe, test, expect } from "bun:test";
import { generateAuthFile } from "../src/lib/auth-generator";
import type { AuthConfig } from "../src/lib/auth-generator";

describe("Auth Generator", () => {
    describe("Hono Template", () => {
        test("generates D1 only configuration", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE" },
            };

            const result = generateAuthFile(config);

            // Check imports
            expect(result).toContain('import { drizzle } from "drizzle-orm/d1"');
            expect(result).toContain('import { schema } from "../db"');
            expect(result).toContain('import type { CloudflareBindings } from "../env"');

            // Check D1 configuration
            expect(result).toContain("d1: env");
            expect(result).toContain("usePlural: true");
            expect(result).toContain("debugLogs: true");

            // Check CLI database config
            expect(result).toContain('provider: "sqlite"');
            expect(result).toContain("drizzleAdapter({} as D1Database");

            // Should not contain other resources
            expect(result).not.toContain("kv: env");
            expect(result).not.toContain("r2: {");
            expect(result).not.toContain("postgres: {");
        });

        test("generates Hyperdrive PostgreSQL configuration", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "postgres",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const result = generateAuthFile(config);

            // Check imports
            expect(result).toContain('import { drizzle } from "drizzle-orm/postgres-js"');
            expect(result).not.toContain('import { drizzle } from "drizzle-orm/d1"');

            // Check PostgreSQL configuration
            expect(result).toContain("postgres: {");
            expect(result).toContain("db");
            expect(result).toContain('provider: "pg"');

            // Should not contain D1
            expect(result).not.toContain("d1: env");
        });

        test("generates KV configuration with custom binding", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE", kv: "MY_KV" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain("kv: env?.MY_KV");
        });

        test("generates R2 configuration with custom binding", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: true, hyperdrive: false },
                bindings: { d1: "DATABASE", r2: "MY_BUCKET" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain("bucket: env?.MY_BUCKET");
            expect(result).toContain("maxFileSize: 2 * 1024 * 1024");
            expect(result).toContain('allowedTypes: [".jpg", ".jpeg", ".png", ".gif"]');
            expect(result).toContain("hooks: {");
        });

        test("generates all resources configuration", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: true, hyperdrive: false },
                bindings: { d1: "DATABASE", kv: "KV", r2: "R2_BUCKET" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain("d1: env");
            expect(result).toContain("kv: env?.KV");
            expect(result).toContain("bucket: env?.R2_BUCKET");
        });
    });

    describe("Next.js Template", () => {
        test("generates D1 only configuration", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE" },
            };

            const result = generateAuthFile(config);

            // Check imports
            expect(result).toContain('import { getCloudflareContext } from "@opennextjs/cloudflare"');
            expect(result).toContain('import { getDb, schema } from "../db"');
            expect(result).toContain('import { anonymous, openAPI } from "better-auth/plugins"');

            // Check D1 configuration
            expect(result).toContain("d1: {");
            expect(result).toContain("db: dbInstance");
            expect(result).toContain("usePlural: true");

            // Check async auth builder pattern
            expect(result).toContain("async function authBuilder()");
            expect(result).toContain("let authInstance");
            expect(result).toContain("export async function initAuth()");

            // Check CLI export
            expect(result).toContain("export const auth = betterAuth({");
        });

        test("generates Hyperdrive PostgreSQL configuration", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "postgres",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const result = generateAuthFile(config);

            // Check imports
            expect(result).toContain('import { getDb, schema } from "../db"');

            // Check PostgreSQL configuration
            expect(result).toContain("postgres: {");
            expect(result).toContain("db: dbInstance");
            expect(result).toContain('provider: "pg"');

            // Should not contain D1
            expect(result).not.toContain("d1: {");
        });

        test("generates KV configuration with custom binding", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE", kv: "MY_KV" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain('import { KVNamespace } from "@cloudflare/workers-types"');
            expect(result).toContain("kv: process.env.MY_KV as KVNamespace<string>");
        });

        test("generates R2 configuration with schema generation", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: true, hyperdrive: false },
                bindings: { d1: "DATABASE", r2: "MY_BUCKET" },
            };

            const result = generateAuthFile(config);

            // Runtime configuration
            expect(result).toContain("bucket: getCloudflareContext().env.MY_BUCKET");

            // Schema generation configuration
            expect(result).toContain("r2: {");
            expect(result).toContain("bucket: {} as any, // Mock bucket for schema generation");
            expect(result).toContain("additionalFields: {");
        });
    });

    describe("Database Provider Mapping", () => {
        test("maps sqlite to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateAuthFile(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/d1"');
            expect(result).toContain('provider: "sqlite"');
            expect(result).toContain("drizzleAdapter({} as D1Database");
        });

        test("maps postgres to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "postgres",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: {},
            };

            const result = generateAuthFile(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/postgres-js"');
            expect(result).toContain('provider: "pg"');
            expect(result).toContain("drizzleAdapter({} as any");
        });

        test("maps mysql to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "mysql",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: {},
            };

            const result = generateAuthFile(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/mysql2"');
            expect(result).toContain('provider: "mysql"');
            expect(result).toContain("drizzleAdapter({} as any");
        });
    });

    describe("Error Cases", () => {
        test("handles missing bindings gracefully", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: true, hyperdrive: false },
                bindings: {}, // No bindings provided
            };

            const result = generateAuthFile(config);

            // Should use default binding names
            expect(result).toContain("kv: env?.KV");
            expect(result).toContain("bucket: env?.R2_BUCKET");
        });

        test("handles empty resources", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: false, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateAuthFile(config);

            // Should not contain any resource configurations
            expect(result).not.toContain("d1: env");
            expect(result).not.toContain("kv: env");
            expect(result).not.toContain("r2: {");
            expect(result).not.toContain("postgres: {");
        });
    });

    describe("Code Syntax Validation", () => {
        test("generates valid TypeScript syntax for all configurations", () => {
            const configs: AuthConfig[] = [
                {
                    template: "hono",
                    database: "sqlite",
                    resources: { d1: true, kv: true, r2: true, hyperdrive: false },
                    bindings: { d1: "DATABASE", kv: "KV", r2: "R2_BUCKET" },
                },
                {
                    template: "nextjs",
                    database: "postgres",
                    resources: { d1: false, kv: true, r2: false, hyperdrive: true },
                    bindings: { hyperdrive: "HYPERDRIVE", kv: "KV" },
                },
            ];

            configs.forEach((config, index) => {
                const result = generateAuthFile(config);

                // Basic syntax checks
                expect(result).not.toContain(",,"); // No double commas
                expect(result).not.toContain("}}"); // No double closing braces without content
                expect(result).not.toContain("undefined,}"); // No trailing undefined

                // Balanced braces and parentheses
                const openBraces = (result.match(/\{/g) || []).length;
                const closeBraces = (result.match(/\}/g) || []).length;
                const openParens = (result.match(/\(/g) || []).length;
                const closeParens = (result.match(/\)/g) || []).length;

                expect(openBraces).toBe(closeBraces);
                expect(openParens).toBe(closeParens);

                // Should contain required exports
                expect(result).toContain("export");
                expect(result).toContain("betterAuth");
            });
        });
    });
});
