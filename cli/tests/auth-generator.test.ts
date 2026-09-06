import { describe, test, expect } from "bun:test";
import { generateAuthFile, generateAuthSchemaFile } from "../src/lib/auth-generator";
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
            const schemaResult = generateAuthSchemaFile(config);

            // Check imports
            expect(result).toContain('import { drizzle } from "drizzle-orm/d1"');
            expect(result).toContain('import { schema } from "../db"');
            expect(result).toContain('import type { CloudflareBindings } from "../env"');

            // Check D1 configuration
            expect(result).toContain("d1: {");
            expect(result).toContain("usePlural: true");
            expect(result).toContain("debugLogs: true");

            expect(result).not.toContain("export const auth");
            expect(schemaResult).toContain('provider: "sqlite"');
            expect(schemaResult).toContain("const db = drizzle({} as D1Database)");

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
            const schemaResult = generateAuthSchemaFile(config);

            // Check imports
            expect(result).toContain('import { drizzle } from "drizzle-orm/postgres-js"');
            expect(result).toContain('import postgres from "postgres"');
            expect(result).not.toContain('import { drizzle } from "drizzle-orm/d1"');

            // Check PostgreSQL configuration
            expect(result).toContain("postgres: {");
            expect(result).toContain("db");
            expect(result).toContain(
                "postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false, prepare: true })"
            );
            expect(result).not.toContain("drizzleAdapter");
            expect(schemaResult).toContain('provider: "pg"');

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

            expect(result).toContain("kv: env.MY_KV");
            expect(result).toContain("storeInDatabase: true");
            expect(result).toContain('storage: "database"');
        });

        test("creates a MySQL client from the Hyperdrive connection string", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "mysql",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "MY_HYPERDRIVE" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain('import { createConnection } from "mysql2/promise"');
            expect(result).toContain("host: env.MY_HYPERDRIVE.host");
            expect(result).toContain("disableEval: true");
        });

        test("generates R2 configuration with custom binding", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: true, hyperdrive: false },
                bindings: { d1: "DATABASE", r2: "MY_BUCKET" },
            };

            const result = generateAuthFile(config);
            const schemaResult = generateAuthSchemaFile(config);

            expect(result).toContain("bucket: env.MY_BUCKET");
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

            expect(result).toContain("d1: {");
            expect(result).toContain("kv: env.KV");
            expect(result).toContain("bucket: env.R2_BUCKET");
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
            const schemaResult = generateAuthSchemaFile(config);

            // Check imports
            expect(result).toContain('import { getCloudflareContext } from "@opennextjs/cloudflare"');
            expect(result).toContain('import { getDb } from "../db"');
            expect(result).toContain('import { anonymous, openAPI } from "better-auth/plugins"');

            // Check D1 configuration
            expect(result).toContain("d1: {");
            expect(result).toContain("db: dbInstance");
            expect(result).toContain("usePlural: true");
            expect(result).toContain("cf: cfCtx.cf");

            // Check async auth builder pattern
            expect(result).toContain("async function authBuilder()");
            expect(result).toContain("let authInstance");
            expect(result).toContain("export async function initAuth()");

            expect(result).not.toContain("export const auth");
            expect(schemaResult).toContain("export const auth = betterAuth({");
        });

        test("generates Hyperdrive PostgreSQL configuration", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "postgres",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const result = generateAuthFile(config);
            const schemaResult = generateAuthSchemaFile(config);

            // Check imports
            expect(result).toContain('import { getDb } from "../db"');

            // Check PostgreSQL configuration
            expect(result).toContain("postgres: {");
            expect(result).toContain("db: dbInstance");
            expect(result).not.toContain("drizzleAdapter");
            expect(result).not.toContain("let authInstance");
            expect(result).toContain("return authBuilder()");
            expect(schemaResult).toContain('provider: "pg"');

            // Should not contain D1
            expect(result).not.toContain("d1: {");
        });

        test("does not cache a MySQL client across requests", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "mysql",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const result = generateAuthFile(config);

            expect(result).not.toContain("let authInstance");
            expect(result).toContain("return authBuilder()");
        });

        test("generates KV configuration with custom binding", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "sqlite",
                resources: { d1: true, kv: true, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE", kv: "MY_KV" },
            };

            const result = generateAuthFile(config);

            expect(result).toContain("kv: cfCtx.env.MY_KV");
            expect(result).toContain("storeInDatabase: true");
            expect(result).toContain('storage: "database"');
        });

        test("generates R2 configuration with schema generation", () => {
            const config: AuthConfig = {
                template: "nextjs",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: true, hyperdrive: false },
                bindings: { d1: "DATABASE", r2: "MY_BUCKET" },
            };

            const result = generateAuthFile(config);
            const schemaResult = generateAuthSchemaFile(config);

            // Runtime configuration
            expect(result).toContain("bucket: cfCtx.env.MY_BUCKET");

            expect(schemaResult).toContain("r2: {");
            expect(schemaResult).toContain("bucket: {} as R2Bucket");
            expect(schemaResult).toContain("additionalFields: {");
        });
    });

    describe("Database Provider Mapping", () => {
        test("honors disabled geolocation in runtime and schema configurations", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                geolocation: false,
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: { d1: "DATABASE" },
            };

            expect(generateAuthFile(config)).toContain("geolocationTracking: false");
            expect(generateAuthSchemaFile(config)).toContain("geolocationTracking: false");
        });

        test("maps sqlite to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "sqlite",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateAuthSchemaFile(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/d1"');
            expect(result).toContain('provider: "sqlite"');
            expect(result).toContain("const db = drizzle({} as D1Database)");
        });

        test("maps postgres to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "postgres",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: {},
            };

            const result = generateAuthSchemaFile(config);

            expect(result).toContain('provider: "pg"');
            expect(result).toContain("const db = {} as any");
        });

        test("maps mysql to correct provider and import", () => {
            const config: AuthConfig = {
                template: "hono",
                database: "mysql",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: {},
            };

            const result = generateAuthSchemaFile(config);

            expect(result).toContain('provider: "mysql"');
            expect(result).toContain("const db = {} as any");
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
            expect(result).toContain("kv: env.KV");
            expect(result).toContain("bucket: env.R2_BUCKET");
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
                const schemaResult = generateAuthSchemaFile(config);

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
                expect(schemaResult).toContain("export const auth");
            });
        });
    });
});
