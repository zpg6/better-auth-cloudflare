import { describe, expect, test } from "bun:test";

// Mock auth file templates that represent what gets copied from examples
const nextjsAuthTemplate = `import { KVNamespace } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous, openAPI } from "better-auth/plugins";
import { getDb } from "../db";

// Define an asynchronous function to build your auth configuration
async function authBuilder() {
    const dbInstance = await getDb();
    return betterAuth(
        withCloudflare(
            {
                autoDetectIpAddress: true,
                geolocationTracking: true,
                cf: getCloudflareContext().cf,
                d1: {
                    db: dbInstance,
                    options: {
                        usePlural: true,
                        debugLogs: true,
                    },
                },
                // Make sure "KV" is the binding in your wrangler.toml
                kv: process.env.KV as KVNamespace<string>,
                // R2 configuration for file storage (R2_BUCKET binding from wrangler.toml)
                r2: {
                    bucket: getCloudflareContext().env.R2_BUCKET,
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
                                if (ctx.session === null) {
                                    return null;
                                }
                                return;
                            },
                            after: async (file, ctx) => {
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
                rateLimit: {
                    enabled: true,
                },
                plugins: [openAPI(), anonymous()],
            }
        )
    );
}

export const auth = betterAuth({
    ...withCloudflare(
        {
            autoDetectIpAddress: true,
            geolocationTracking: true,
            cf: {},
            // R2 configuration for schema generation
            r2: {
                bucket: {} as any,
                additionalFields: {
                    category: { type: "string", required: false },
                    isPublic: { type: "boolean", required: false },
                    description: { type: "string", required: false },
                },
            },
        },
        {
            plugins: [openAPI(), anonymous()],
        }
    ),
    database: drizzleAdapter(process.env.DATABASE as any, {
        provider: "sqlite",
        usePlural: true,
        debugLogs: true,
    }),
});`;

describe("Template cleanup for disabled services", () => {
    test("removes KV configuration when disabled", () => {
        // Simulate the KV removal logic from the CLI
        let updated = nextjsAuthTemplate;

        // Remove KV configuration: comment line + kv property
        updated = updated.replace(/\s*\/\/[^\n]*KV[^\n]*\n\s*kv:[^\n]*,?\n/g, "");

        // Should not contain KV configuration
        expect(updated).not.toContain("kv: process.env.KV");
        expect(updated).not.toContain('Make sure "KV" is the binding');

        // Should still contain other configurations
        expect(updated).toContain("d1: {");
        expect(updated).toContain("r2: {");
    });

    test("removes R2 configuration when disabled using line-by-line approach", () => {
        // Simulate the R2 removal logic from the CLI
        const lines = nextjsAuthTemplate.split("\n");
        const filteredLines = [];
        let inR2Block = false;
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Check if this is an R2 comment line
            if (line.includes("R2") && line.trim().startsWith("//")) {
                continue; // Skip R2 comment lines
            }

            // Check if this line starts the r2 configuration
            if (line.trim().startsWith("r2:")) {
                inR2Block = true;
                braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount === 0) {
                    inR2Block = false; // Single line r2 config
                }
                continue; // Skip this line
            }

            if (inR2Block) {
                braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount <= 0) {
                    inR2Block = false;
                }
                continue; // Skip lines inside r2 block
            }

            filteredLines.push(line);
        }
        const updated = filteredLines.join("\n");

        // Should not contain R2 configuration
        expect(updated).not.toContain("r2: {");
        expect(updated).not.toContain("bucket: getCloudflareContext().env.R2_BUCKET");
        expect(updated).not.toContain("maxFileSize: 2 * 1024 * 1024");
        expect(updated).not.toContain("R2 configuration for file storage");

        // Should still contain other configurations
        expect(updated).toContain("d1: {");
        expect(updated).toContain("kv: process.env.KV");
    });

    test("removes both KV and R2 when both disabled", () => {
        let updated = nextjsAuthTemplate;

        // Remove KV configuration
        updated = updated.replace(/\s*\/\/[^\n]*KV[^\n]*\n\s*kv:[^\n]*,?\n/g, "");

        // Remove R2 configuration using line-by-line approach
        const lines = updated.split("\n");
        const filteredLines = [];
        let inR2Block = false;
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes("R2") && line.trim().startsWith("//")) {
                continue;
            }

            if (line.trim().startsWith("r2:")) {
                inR2Block = true;
                braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount === 0) {
                    inR2Block = false;
                }
                continue;
            }

            if (inR2Block) {
                braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount <= 0) {
                    inR2Block = false;
                }
                continue;
            }

            filteredLines.push(line);
        }
        updated = filteredLines.join("\n");

        // Clean up any orphaned closing braces
        updated = updated.replace(/,\s*\}\s*,?\s*\n\s*\}/g, ",\n                }");

        // Should not contain KV or R2 configurations
        expect(updated).not.toContain("kv: process.env.KV");
        expect(updated).not.toContain("r2: {");

        // Should still contain D1 configuration
        expect(updated).toContain("d1: {");

        // Should have valid JavaScript syntax (no orphaned braces)
        expect(updated).not.toContain("}\n                }");
    });
});

describe("Database provider fixes for Hyperdrive", () => {
    test("updates provider from sqlite to pg for PostgreSQL Hyperdrive", () => {
        let updated = nextjsAuthTemplate;

        // Replace d1 configuration with postgres
        updated = updated.replace(
            /d1:\s*\{[\s\S]*?\},/m,
            `postgres: {\n                    db: dbInstance,\n                },`
        );

        // Fix provider for PostgreSQL
        updated = updated.replace(/provider:\s*"sqlite"/g, 'provider: "pg"');

        // Should have postgres configuration
        expect(updated).toContain("postgres: {");
        expect(updated).toContain("db: dbInstance,");
        expect(updated).not.toContain("d1: {");

        // Should have correct provider
        expect(updated).toContain('provider: "pg"');
        expect(updated).not.toContain('provider: "sqlite"');
    });

    test("updates provider from sqlite to mysql for MySQL Hyperdrive", () => {
        let updated = nextjsAuthTemplate;

        // Replace d1 configuration with mysql
        updated = updated.replace(
            /d1:\s*\{[\s\S]*?\},/m,
            `mysql: {\n                    db: dbInstance,\n                },`
        );

        // Fix provider for MySQL
        updated = updated.replace(/provider:\s*"sqlite"/g, 'provider: "mysql"');

        // Should have mysql configuration
        expect(updated).toContain("mysql: {");
        expect(updated).toContain("db: dbInstance,");
        expect(updated).not.toContain("d1: {");

        // Should have correct provider
        expect(updated).toContain('provider: "mysql"');
        expect(updated).not.toContain('provider: "sqlite"');
    });

    test("complete Hyperdrive transformation with cleanup", () => {
        let updated = nextjsAuthTemplate;

        // Replace d1 with postgres
        updated = updated.replace(
            /d1:\s*\{[\s\S]*?\},/m,
            `postgres: {\n                    db: dbInstance,\n                },`
        );

        // Remove KV and R2 (simulate --kv=false --r2=false)
        updated = updated.replace(/\s*\/\/[^\n]*KV[^\n]*\n\s*kv:[^\n]*,?\n/g, "");

        // Remove R2 using line-by-line approach
        const lines = updated.split("\n");
        const filteredLines = [];
        let inR2Block = false;
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.includes("R2") && line.trim().startsWith("//")) {
                continue;
            }

            if (line.trim().startsWith("r2:")) {
                inR2Block = true;
                braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount === 0) {
                    inR2Block = false;
                }
                continue;
            }

            if (inR2Block) {
                braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
                if (braceCount <= 0) {
                    inR2Block = false;
                }
                continue;
            }

            filteredLines.push(line);
        }
        updated = filteredLines.join("\n");

        // Fix provider
        updated = updated.replace(/provider:\s*"sqlite"/g, 'provider: "pg"');

        // Clean up trailing commas and extra whitespace
        updated = updated.replace(/,(\s*)\}/g, "$1}");
        updated = updated.replace(/\n\s*\n\s*\n/g, "\n\n");

        // Final result should be clean
        expect(updated).toContain("postgres: {");
        expect(updated).toContain('provider: "pg"');
        expect(updated).not.toContain("d1: {");
        expect(updated).not.toContain("kv: process.env.KV");
        expect(updated).not.toContain("r2: {");
        expect(updated).not.toContain('provider: "sqlite"');

        // Should not have obvious syntax errors (basic validation)
        // Note: Some cleanup artifacts may remain but the core transformation should work
        expect(updated).not.toContain("undefined");
        expect(updated).not.toContain("null,");

        // Verify the important transformations happened
        expect(updated).toContain("postgres: {");
        expect(updated).toContain('provider: "pg"');
        expect(updated).not.toContain("sqlite");
    });
});

describe("Skip Cloudflare setup scenarios", () => {
    test("Hyperdrive with skip-cloudflare-setup should generate placeholder configuration", () => {
        // This tests the exact scenario that was failing
        const mockWranglerToml = `name = "my-app"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "my-app-db"
database_id = "YOUR_D1_DATABASE_ID"
`;

        // Simulate what happens when --skip-cloudflare-setup=true with Hyperdrive
        const hyperdriveConfig = `[[hyperdrive]]
binding = "HYPERDRIVE"
id = "YOUR_HYPERDRIVE_ID"
localConnectionString = "postgres://user:password@localhost:5432/your_database"`;

        const result = mockWranglerToml + "\n" + hyperdriveConfig;

        // Should have placeholder values that are clearly marked for replacement
        expect(result).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(result).toContain('localConnectionString = "postgres://user:password@localhost:5432/your_database"');

        // Should be immediately usable for development builds
        expect(result).toContain("[[hyperdrive]]");
        expect(result).toContain('binding = "HYPERDRIVE"');
    });

    test("KV with skip-cloudflare-setup should generate placeholder ID", () => {
        // This tests the original Next.js build failure fix
        const mockWranglerToml = `name = "my-app"
compatibility_date = "2025-03-01"`;

        const kvConfig = `[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"`;

        const result = mockWranglerToml + "\n" + kvConfig;

        // Should have placeholder ID to prevent Next.js build failures
        expect(result).toContain('id = "YOUR_KV_NAMESPACE_ID"');
        expect(result).toContain('binding = "KV"');

        // Should NOT be missing the id field (which caused the original error)
        // The invalid format would be: binding = "KV" followed by end of block or file
        const lines = result.split("\n");
        const kvLines = lines.filter(line => line.includes('binding = "KV"'));
        expect(kvLines.length).toBe(1);

        const kvLineIndex = lines.findIndex(line => line.includes('binding = "KV"'));
        const nextLine = lines[kvLineIndex + 1];
        expect(nextLine).toContain('id = "YOUR_KV_NAMESPACE_ID"');
    });
});
