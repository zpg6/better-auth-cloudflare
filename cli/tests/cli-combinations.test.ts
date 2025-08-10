import { describe, expect, test } from "bun:test";
import * as TOML from "@iarna/toml";
import {
    appendOrReplaceKvNamespaceBlock,
    appendOrReplaceR2Block,
    clearAllKvBlocks,
    clearAllR2Blocks,
    updateD1Block,
} from "../src/index";

// Base template TOML that represents what's copied from examples
const baseTemplate = `# For more details on how to configure Wrangler, refer to:
# https://developers.cloudflare.com/workers/wrangler/configuration/

name = "better-auth-cloudflare"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[assets]
binding = "ASSETS"
directory = ".open-next/assets"

[observability]
enabled = true

[placement]
mode = "smart"

[[d1_databases]]
binding = "DATABASE"
database_name = "better-auth-cloudflare-db"
database_id = "abd74206-37a2-4233-9813-cda1473be8f9"
migrations_dir = "drizzle"

[[kv_namespaces]]
binding = "KV"
id = "cfa2f71dcfff43ffaab4c093968f6347"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "better-auth-cloudflare-files"
`;

describe("CLI Selection Combinations", () => {
    test("D1 + KV + R2 with default bindings", () => {
        let toml = baseTemplate;

        // Simulate CLI processing with default bindings
        toml = updateD1Block(toml, "DATABASE", "my-app-db");
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-12345");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "R2_BUCKET", "my-app-files");

        // Verify all blocks exist and are valid
        expect(toml).toContain('database_name = "my-app-db"');
        expect(toml).toContain('binding = "DATABASE"');
        expect(toml).toContain('binding = "KV"');
        expect(toml).toContain('id = "kv-12345"');
        expect(toml).toContain('binding = "R2_BUCKET"');
        expect(toml).toContain('bucket_name = "my-app-files"');

        // Ensure no duplicates
        expect((toml.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[r2_buckets\]\]/g) || []).length).toBe(1);
    });

    test("D1 + KV only (no R2)", () => {
        let toml = baseTemplate;

        // User chooses D1 + KV but no R2
        toml = updateD1Block(toml, "DATABASE", "my-app-db");
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-12345");
        toml = clearAllR2Blocks(toml); // Remove R2 since user didn't want it

        // Should have D1 and KV but no R2
        expect(toml).toContain("[[d1_databases]]");
        expect(toml).toContain("[[kv_namespaces]]");
        expect(toml).not.toContain("[[r2_buckets]]");

        expect((toml.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[r2_buckets\]\]/g) || []).length).toBe(0);
    });

    test("D1 + R2 only (no KV)", () => {
        let toml = baseTemplate;

        // User chooses D1 + R2 but no KV
        toml = updateD1Block(toml, "DATABASE", "my-app-db");
        toml = clearAllKvBlocks(toml); // Remove KV since user didn't want it
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "R2_BUCKET", "my-app-files");

        // Should have D1 and R2 but no KV
        expect(toml).toContain("[[d1_databases]]");
        expect(toml).toContain("[[r2_buckets]]");
        expect(toml).not.toContain("[[kv_namespaces]]");

        expect((toml.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(0);
        expect((toml.match(/\[\[r2_buckets\]\]/g) || []).length).toBe(1);
    });

    test("D1 only (no KV, no R2)", () => {
        let toml = baseTemplate;

        // User chooses only D1
        toml = updateD1Block(toml, "DATABASE", "my-app-db");
        toml = clearAllKvBlocks(toml);
        toml = clearAllR2Blocks(toml);

        // Should have only D1
        expect(toml).toContain("[[d1_databases]]");
        expect(toml).not.toContain("[[kv_namespaces]]");
        expect(toml).not.toContain("[[r2_buckets]]");

        expect((toml.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(0);
        expect((toml.match(/\[\[r2_buckets\]\]/g) || []).length).toBe(0);
    });

    test("Custom binding names", () => {
        let toml = baseTemplate;

        // User chooses custom binding names
        toml = updateD1Block(toml, "MY_DATABASE", "custom-db");
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "MY_KV", "kv-12345");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "MY_R2", "custom-files");

        // Should have custom bindings
        expect(toml).toContain('binding = "MY_DATABASE"');
        expect(toml).toContain('database_name = "custom-db"');
        expect(toml).toContain('binding = "MY_KV"');
        expect(toml).toContain('binding = "MY_R2"');
        expect(toml).toContain('bucket_name = "custom-files"');

        // Should not have old bindings
        expect(toml).not.toContain('binding = "DATABASE"');
        expect(toml).not.toContain('binding = "KV"');
        expect(toml).not.toContain('binding = "R2_BUCKET"');
        expect(toml).not.toContain('bucket_name = "better-auth-cloudflare-files"');
    });

    test("Hyperdrive Postgres + KV + R2", () => {
        // For Hyperdrive, we start with a simpler template (no D1)
        const hyperdriveTemplate = `name = "my-app"
compatibility_date = "2025-03-01"

[[kv_namespaces]]
binding = "KV"
id = "old-kv-id"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "old-bucket"
`;

        let toml = hyperdriveTemplate;

        // User chooses Hyperdrive + KV + R2
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-12345");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "FILES", "my-files");

        // Should have KV and R2 but no D1
        expect(toml).toContain("[[kv_namespaces]]");
        expect(toml).toContain("[[r2_buckets]]");
        expect(toml).not.toContain("[[d1_databases]]");

        expect(toml).toContain('binding = "KV"');
        expect(toml).toContain('binding = "FILES"');
        expect(toml).toContain('bucket_name = "my-files"');

        // Should not have old values
        expect(toml).not.toContain('binding = "R2_BUCKET"');
        expect(toml).not.toContain('bucket_name = "old-bucket"');
    });
});

describe("TOML Validation", () => {
    test("validates binding name format", () => {
        // Test valid binding names
        const validBindings = ["DATABASE", "KV", "R2_BUCKET", "MY_FILES", "TEST123"];

        for (const binding of validBindings) {
            let toml = baseTemplate;
            toml = clearAllKvBlocks(toml);
            toml = appendOrReplaceKvNamespaceBlock(toml, binding, "test-id");

            expect(toml).toContain(`binding = "${binding}"`);
            expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);
        }
    });

    test("handles special characters in names", () => {
        let toml = baseTemplate;

        // Test names with hyphens and underscores
        toml = updateD1Block(toml, "DATABASE", "my-app_test-db");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "R2_BUCKET", "my-app_test-files");

        expect(toml).toContain('database_name = "my-app_test-db"');
        expect(toml).toContain('bucket_name = "my-app_test-files"');
    });

    test("preserves TOML structure and formatting", () => {
        let toml = baseTemplate;

        // Apply all transformations
        toml = updateD1Block(toml, "DATABASE", "test-db");
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-id");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "R2_BUCKET", "test-files");

        // Should preserve comments and structure
        expect(toml).toContain("# For more details on how to configure Wrangler");
        expect(toml).toContain("[assets]");
        expect(toml).toContain("[observability]");
        expect(toml).toContain("[placement]");
        expect(toml).toContain('compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]');
    });

    test("handles empty/minimal configurations", () => {
        const minimalTemplate = `name = "test-app"
compatibility_date = "2025-03-01"
`;

        let toml = minimalTemplate;

        // Add only KV
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-id");

        expect(toml).toContain("[[kv_namespaces]]");
        expect(toml).toContain('binding = "KV"');
        expect(toml).toContain('id = "kv-id"');

        // Should not have other blocks
        expect(toml).not.toContain("[[d1_databases]]");
        expect(toml).not.toContain("[[r2_buckets]]");
    });
});

describe("TOML Syntax Validation", () => {
    test("all generated TOML is parseable by TOML parsers", () => {
        const testCases = [
            {
                name: "D1 + KV + R2 with defaults (dynamic naming)",
                transform: (toml: string) => {
                    const appName = "test-app";
                    let result = toml;
                    result = updateD1Block(result, "DATABASE", `${appName}-db`);
                    result = clearAllKvBlocks(result);
                    result = appendOrReplaceKvNamespaceBlock(result, "KV", "kv-12345");
                    result = clearAllR2Blocks(result);
                    result = appendOrReplaceR2Block(result, "R2_BUCKET", `${appName}-files`);
                    return result;
                },
            },
            {
                name: "Custom bindings with special names",
                transform: (toml: string) => {
                    let result = toml;
                    result = updateD1Block(result, "MY_DATABASE", "test-app_v2-db");
                    result = clearAllKvBlocks(result);
                    result = appendOrReplaceKvNamespaceBlock(result, "CACHE_STORE", "kv-abc123");
                    result = clearAllR2Blocks(result);
                    result = appendOrReplaceR2Block(result, "FILE_STORAGE", "test-app_v2-files");
                    return result;
                },
            },
            {
                name: "Minimal configuration",
                transform: (toml: string) => {
                    const appName = "minimal-app";
                    let result = toml;
                    result = clearAllKvBlocks(result);
                    result = clearAllR2Blocks(result);
                    result = updateD1Block(result, "DATABASE", `${appName}-db`);
                    return result;
                },
            },
            {
                name: "KV and R2 only",
                transform: (toml: string) => {
                    const appName = "storage-app";
                    let result = toml;
                    result = clearAllKvBlocks(result);
                    result = appendOrReplaceKvNamespaceBlock(result, "KV", "kv-only-123");
                    result = clearAllR2Blocks(result);
                    result = appendOrReplaceR2Block(result, "FILES", `${appName}-files`);
                    return result;
                },
            },
        ];

        for (const testCase of testCases) {
            const transformedToml = testCase.transform(baseTemplate);

            // Attempt to parse the TOML - this will throw if invalid
            expect(() => {
                const parsed = TOML.parse(transformedToml);

                // Verify the parsed structure makes sense
                expect(parsed.name).toBeDefined();
                expect(parsed.compatibility_date).toBeDefined();

                // Log success for debugging and verify dynamic names
                console.log(`✅ ${testCase.name}: Valid TOML with ${Object.keys(parsed).length} top-level keys`);

                // Verify dynamic naming is working
                if (testCase.name.includes("dynamic naming") && Array.isArray(parsed.d1_databases)) {
                    expect((parsed.d1_databases[0] as any).database_name).toBe("test-app-db");
                }
                if (testCase.name.includes("Minimal") && Array.isArray(parsed.d1_databases)) {
                    expect((parsed.d1_databases[0] as any).database_name).toBe("minimal-app-db");
                }
            }).not.toThrow();
        }
    });

    test("validates wrangler-specific TOML structure", () => {
        let toml = baseTemplate;

        // Apply full configuration
        toml = updateD1Block(toml, "DATABASE", "test-db");
        toml = clearAllKvBlocks(toml);
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-12345");
        toml = clearAllR2Blocks(toml);
        toml = appendOrReplaceR2Block(toml, "R2_BUCKET", "test-files");

        const parsed = TOML.parse(toml);

        // Verify wrangler.toml structure
        expect(parsed.name).toBe("better-auth-cloudflare");
        expect(parsed.compatibility_date).toBe("2025-03-01");
        expect(Array.isArray(parsed.compatibility_flags)).toBe(true);

        // Verify D1 configuration
        expect(Array.isArray(parsed.d1_databases)).toBe(true);
        expect(parsed.d1_databases).toHaveLength(1);
        expect((parsed.d1_databases as any)[0].binding).toBe("DATABASE");
        expect((parsed.d1_databases as any)[0].database_name).toBe("test-db");

        // Verify KV configuration
        expect(Array.isArray(parsed.kv_namespaces)).toBe(true);
        expect(parsed.kv_namespaces).toHaveLength(1);
        expect((parsed.kv_namespaces as any)[0].binding).toBe("KV");
        expect((parsed.kv_namespaces as any)[0].id).toBe("kv-12345");

        // Verify R2 configuration
        expect(Array.isArray(parsed.r2_buckets)).toBe(true);
        expect(parsed.r2_buckets).toHaveLength(1);
        expect((parsed.r2_buckets as any)[0].binding).toBe("R2_BUCKET");
        expect((parsed.r2_buckets as any)[0].bucket_name).toBe("test-files");

        // Verify other sections are preserved
        expect(parsed.assets).toBeDefined();
        expect(parsed.observability).toBeDefined();
        expect(parsed.placement).toBeDefined();
    });

    test("handles edge cases and special characters", () => {
        const edgeCases = [
            { db: "app-with-hyphens-db", bucket: "bucket-with-hyphens" },
            { db: "app_with_underscores_db", bucket: "bucket_with_underscores" },
            { db: "app123db", bucket: "bucket123" },
            { db: "a", bucket: "b" }, // Single character names
            {
                db: "very-long-database-name-that-might-cause-issues",
                bucket: "very-long-bucket-name-that-might-cause-issues",
            },
        ];

        for (const edgeCase of edgeCases) {
            let toml = baseTemplate;
            toml = updateD1Block(toml, "DATABASE", edgeCase.db);
            toml = clearAllR2Blocks(toml);
            toml = appendOrReplaceR2Block(toml, "R2_BUCKET", edgeCase.bucket);

            // Should parse without errors
            expect(() => {
                const parsed = TOML.parse(toml);
                expect((parsed.d1_databases as any)[0].database_name).toBe(edgeCase.db);
                expect((parsed.r2_buckets as any)[0].bucket_name).toBe(edgeCase.bucket);
            }).not.toThrow();
        }
    });
});
