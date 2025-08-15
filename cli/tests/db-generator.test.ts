import { describe, test, expect } from "bun:test";
import { generateDbIndex } from "../src/lib/db-generator";
import type { DbConfig } from "../src/lib/db-generator";

describe("Database Generator", () => {
    describe("Hono Template", () => {
        test("generates Hono database index file", () => {
            const config: DbConfig = {
                template: "hono",
                database: "sqlite",
                bindings: {},
            };

            const result = generateDbIndex(config);

            expect(result).toContain('import { schema } from "./schema"');
            expect(result).toContain('export * from "drizzle-orm"');
            expect(result).toContain('export * from "./auth.schema"');
            expect(result).toContain('export * from "./schema"');
            expect(result).toContain("// Export individual tables for drizzle-kit");
        });

        test("Hono template is consistent regardless of database type", () => {
            const sqliteConfig: DbConfig = {
                template: "hono",
                database: "sqlite",
                bindings: {},
            };

            const postgresConfig: DbConfig = {
                template: "hono",
                database: "postgres",
                bindings: {},
            };

            const sqliteResult = generateDbIndex(sqliteConfig);
            const postgresResult = generateDbIndex(postgresConfig);

            // Hono template should be the same regardless of database
            expect(sqliteResult).toBe(postgresResult);
        });
    });

    describe("Next.js Template - SQLite/D1", () => {
        test("generates Next.js D1 database index with default binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "sqlite",
                bindings: {},
            };

            const result = generateDbIndex(config);

            expect(result).toContain('import { getCloudflareContext } from "@opennextjs/cloudflare"');
            expect(result).toContain('import { drizzle } from "drizzle-orm/d1"');
            expect(result).toContain('import { schema } from "./schema"');
            expect(result).toContain("export async function getDb()");
            expect(result).toContain("env.DATABASE");
            expect(result).toContain("schema,");
            expect(result).toContain("logger: true");
            expect(result).toContain('export * from "@/db/auth.schema"');
        });

        test("generates Next.js D1 database index with custom binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "sqlite",
                bindings: { d1: "MY_DATABASE" },
            };

            const result = generateDbIndex(config);

            expect(result).toContain("env.MY_DATABASE");
            expect(result).toContain('// Ensure "MY_DATABASE" matches your D1 binding name');
        });
    });

    describe("Next.js Template - PostgreSQL/Hyperdrive", () => {
        test("generates Next.js PostgreSQL database index with default binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "postgres",
                bindings: {},
            };

            const result = generateDbIndex(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/postgres-js"');
            expect(result).toContain('import postgres from "postgres"');
            expect(result).toContain("export async function getDb()");
            expect(result).toContain("postgres(env.HYPERDRIVE.connectionString)");
            expect(result).toContain('// Ensure "HYPERDRIVE" matches your Hyperdrive binding name');
        });

        test("generates Next.js PostgreSQL database index with custom binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "postgres",
                bindings: { hyperdrive: "MY_HYPERDRIVE" },
            };

            const result = generateDbIndex(config);

            expect(result).toContain("postgres(env.MY_HYPERDRIVE.connectionString)");
            expect(result).toContain('// Ensure "MY_HYPERDRIVE" matches your Hyperdrive binding name');
        });
    });

    describe("Next.js Template - MySQL/Hyperdrive", () => {
        test("generates Next.js MySQL database index with default binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "mysql",
                bindings: {},
            };

            const result = generateDbIndex(config);

            expect(result).toContain('import { drizzle } from "drizzle-orm/mysql2"');
            expect(result).toContain('import mysql from "mysql2/promise"');
            expect(result).toContain("export async function getDb()");
            expect(result).toContain("mysql.createPool(env.HYPERDRIVE.connectionString)");
            expect(result).toContain('// Ensure "HYPERDRIVE" matches your Hyperdrive binding name');
        });

        test("generates Next.js MySQL database index with custom binding", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "mysql",
                bindings: { hyperdrive: "MY_HYPERDRIVE" },
            };

            const result = generateDbIndex(config);

            expect(result).toContain("mysql.createPool(env.MY_HYPERDRIVE.connectionString)");
            expect(result).toContain('// Ensure "MY_HYPERDRIVE" matches your Hyperdrive binding name');
        });
    });

    describe("Import Generation", () => {
        test("generates correct imports for each database type", () => {
            const configs = [
                { database: "sqlite" as const, expectedImport: "drizzle-orm/d1" },
                { database: "postgres" as const, expectedImport: "drizzle-orm/postgres-js" },
                { database: "mysql" as const, expectedImport: "drizzle-orm/mysql2" },
            ];

            configs.forEach(({ database, expectedImport }) => {
                const config: DbConfig = {
                    template: "nextjs",
                    database,
                    bindings: {},
                };

                const result = generateDbIndex(config);
                expect(result).toContain(`import { drizzle } from "${expectedImport}"`);
            });
        });

        test("includes database-specific additional imports", () => {
            const postgresConfig: DbConfig = {
                template: "nextjs",
                database: "postgres",
                bindings: {},
            };

            const mysqlConfig: DbConfig = {
                template: "nextjs",
                database: "mysql",
                bindings: {},
            };

            const postgresResult = generateDbIndex(postgresConfig);
            const mysqlResult = generateDbIndex(mysqlConfig);

            expect(postgresResult).toContain('import postgres from "postgres"');
            expect(mysqlResult).toContain('import mysql from "mysql2/promise"');
        });
    });

    describe("Function Generation", () => {
        test("generates appropriate connection logic for each database", () => {
            const sqliteConfig: DbConfig = {
                template: "nextjs",
                database: "sqlite",
                bindings: { d1: "DATABASE" },
            };

            const postgresConfig: DbConfig = {
                template: "nextjs",
                database: "postgres",
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const mysqlConfig: DbConfig = {
                template: "nextjs",
                database: "mysql",
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const sqliteResult = generateDbIndex(sqliteConfig);
            const postgresResult = generateDbIndex(postgresConfig);
            const mysqlResult = generateDbIndex(mysqlConfig);

            // SQLite should use direct D1 connection
            expect(sqliteResult).toContain("drizzle(env.DATABASE, {");

            // PostgreSQL should use postgres connection
            expect(postgresResult).toContain("drizzle(postgres(env.HYPERDRIVE.connectionString), {");

            // MySQL should use pool creation
            expect(mysqlResult).toContain("const pool = await mysql.createPool(env.HYPERDRIVE.connectionString)");
            expect(mysqlResult).toContain("return drizzle(pool, {");
        });
    });

    describe("Export Generation", () => {
        test("generates consistent exports for all configurations", () => {
            const configs: DbConfig[] = [
                { template: "hono", database: "sqlite", bindings: {} },
                { template: "nextjs", database: "sqlite", bindings: {} },
                { template: "nextjs", database: "postgres", bindings: {} },
                { template: "nextjs", database: "mysql", bindings: {} },
            ];

            configs.forEach((config, index) => {
                const result = generateDbIndex(config);

                expect(result).toContain('export * from "drizzle-orm"');
                expect(result).toContain('export * from "./schema"');

                if (config.template === "hono") {
                    expect(result).toContain('export * from "./auth.schema"');
                } else {
                    expect(result).toContain('export * from "@/db/auth.schema"');
                }
            });
        });
    });

    describe("Code Syntax Validation", () => {
        test("generates valid TypeScript syntax", () => {
            const configs: DbConfig[] = [
                { template: "hono", database: "sqlite", bindings: {} },
                { template: "nextjs", database: "sqlite", bindings: { d1: "DATABASE" } },
                { template: "nextjs", database: "postgres", bindings: { hyperdrive: "HYPERDRIVE" } },
                { template: "nextjs", database: "mysql", bindings: { hyperdrive: "HYPERDRIVE" } },
            ];

            configs.forEach((config, index) => {
                const result = generateDbIndex(config);

                // Basic syntax checks
                expect(result).toMatch(/^import/); // Starts with imports
                expect(result).toContain("export"); // Has exports
                expect(result).not.toContain(";;"); // No double semicolons
                expect(result).not.toContain(",,"); // No double commas

                // Balanced braces and parentheses
                const openBraces = (result.match(/\{/g) || []).length;
                const closeBraces = (result.match(/\}/g) || []).length;
                expect(openBraces).toBe(closeBraces);

                const openParens = (result.match(/\(/g) || []).length;
                const closeParens = (result.match(/\)/g) || []).length;
                expect(openParens).toBe(closeParens);
            });
        });

        test("generates properly formatted code with consistent spacing", () => {
            const config: DbConfig = {
                template: "nextjs",
                database: "postgres",
                bindings: { hyperdrive: "HYPERDRIVE" },
            };

            const result = generateDbIndex(config);

            // Check for proper spacing and formatting
            expect(result).not.toMatch(/\{\s*\n\s*\}/); // No empty function bodies
            expect(result).not.toMatch(/import.*from.*".*"\s*;.*import/); // Proper import spacing
            expect(result).toMatch(/export async function getDb\(\)/); // Proper function declaration
        });
    });
});
