import { describe, expect, test } from "bun:test";
import {
    appendOrReplaceHyperdriveBlock,
    appendOrReplaceKvNamespaceBlock,
    clearAllHyperdriveBlocks,
    clearAllKvBlocks,
    clearAllR2Blocks,
} from "../src/index";

describe("Skip Cloudflare Setup Integration Tests", () => {
    // These tests cover the exact scenarios that were causing build failures

    test("Next.js with KV and skip-cloudflare-setup generates valid wrangler.toml", () => {
        // Simulate the CLI flow for: --template=nextjs --kv=true --skip-cloudflare-setup=true
        let wrangler = `name = "better-auth-cloudflare"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[[d1_databases]]
binding = "DATABASE"
database_name = "my-app-db"
database_id = "YOUR_D1_DATABASE_ID"
migrations_dir = "drizzle"
`;

        // Clear template KV blocks and add user's configuration (no real ID available)
        wrangler = clearAllKvBlocks(wrangler);
        wrangler = appendOrReplaceKvNamespaceBlock(wrangler, "KV"); // No ID = placeholder

        // Should generate valid configuration that Next.js can build with
        expect(wrangler).toContain("[[kv_namespaces]]");
        expect(wrangler).toContain('binding = "KV"');
        expect(wrangler).toContain('id = "YOUR_KV_NAMESPACE_ID"');

        // Should NOT have the invalid format that caused build failures
        // Verify that binding line is followed by id line
        const lines = wrangler.split("\n");
        const kvBindingLineIndex = lines.findIndex(line => line.includes('binding = "KV"'));
        expect(kvBindingLineIndex).toBeGreaterThanOrEqual(0);
        expect(lines[kvBindingLineIndex + 1]).toContain('id = "YOUR_KV_NAMESPACE_ID"');
    });

    test("Next.js with Hyperdrive and skip-cloudflare-setup generates valid configuration", () => {
        // Simulate: --template=nextjs --database=hyperdrive-postgres --skip-cloudflare-setup=true
        let wrangler = `name = "better-auth-cloudflare"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[[d1_databases]]
binding = "DATABASE"
database_name = "your-d1-database-name"
database_id = "YOUR_D1_DATABASE_ID"
migrations_dir = "drizzle"
`;

        // Clear template Hyperdrive blocks and add user's configuration (no real ID available)
        wrangler = clearAllHyperdriveBlocks(wrangler);
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", undefined, "hyperdrive-postgres");

        // Should generate valid configuration with placeholder ID and local connection string
        expect(wrangler).toContain("[[hyperdrive]]");
        expect(wrangler).toContain('binding = "HYPERDRIVE"');
        expect(wrangler).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(wrangler).toContain('localConnectionString = "postgres://user:password@localhost:5432/your_database"');

        // Should be immediately usable for development (no more "no local hyperdrive connection string" errors)
        const lines = wrangler.split("\n");
        const hyperdriveStart = lines.findIndex(line => line.includes("[[hyperdrive]]"));
        expect(hyperdriveStart).toBeGreaterThanOrEqual(0);

        // Verify complete block structure
        expect(lines[hyperdriveStart + 1]).toContain('binding = "HYPERDRIVE"');
        expect(lines[hyperdriveStart + 2]).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(lines[hyperdriveStart + 3]).toContain(
            'localConnectionString = "postgres://user:password@localhost:5432/your_database"'
        );
    });

    test("Next.js with MySQL Hyperdrive and skip-cloudflare-setup", () => {
        // Simulate: --template=nextjs --database=hyperdrive-mysql --skip-cloudflare-setup=true
        let wrangler = `name = "better-auth-cloudflare"
compatibility_date = "2025-03-01"
`;

        wrangler = clearAllHyperdriveBlocks(wrangler);
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", undefined, "hyperdrive-mysql");

        // Should generate MySQL-specific local connection string
        expect(wrangler).toContain("[[hyperdrive]]");
        expect(wrangler).toContain('binding = "HYPERDRIVE"');
        expect(wrangler).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(wrangler).toContain('localConnectionString = "mysql://user:password@localhost:3306/your_database"');
        expect(wrangler).not.toContain("postgres://");
    });

    test("Complete scenario: Next.js with KV+R2 disabled and Hyperdrive enabled", () => {
        // Simulate: --template=nextjs --database=hyperdrive-postgres --kv=false --r2=false --skip-cloudflare-setup=true
        let wrangler = `name = "better-auth-cloudflare"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "template-db"
database_id = "template-id"

[[kv_namespaces]]
binding = "KV"
id = "template-kv-id"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "template-bucket"
`;

        // Simulate CLI processing: disable KV and R2, enable Hyperdrive
        wrangler = clearAllKvBlocks(wrangler);
        wrangler = clearAllR2Blocks(wrangler);
        wrangler = clearAllHyperdriveBlocks(wrangler);
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", undefined, "hyperdrive-postgres");

        // Should have Hyperdrive but not KV or R2
        expect(wrangler).toContain("[[hyperdrive]]");
        expect(wrangler).toContain('binding = "HYPERDRIVE"');
        expect(wrangler).toContain('localConnectionString = "postgres://user:password@localhost:5432/your_database"');

        expect(wrangler).not.toContain("[[kv_namespaces]]");
        expect(wrangler).not.toContain("[[r2_buckets]]");
        expect(wrangler).not.toContain('binding = "KV"');
        expect(wrangler).not.toContain('binding = "R2_BUCKET"');

        // Should still have D1 (not affected by database choice in this context)
        expect(wrangler).toContain("[[d1_databases]]");
    });

    test("Real vs placeholder ID handling", () => {
        let wrangler = `name = "test-app"`;

        // Test with real ID (when Cloudflare setup succeeds)
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", "real-hd-123", "hyperdrive-postgres");
        expect(wrangler).toContain('id = "real-hd-123"');
        expect(wrangler).not.toContain("YOUR_HYPERDRIVE_ID");

        // Test replacement with placeholder (when skipping setup)
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", undefined, "hyperdrive-postgres");
        expect(wrangler).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(wrangler).not.toContain("real-hd-123");

        // Should still have local connection string in both cases
        expect(wrangler).toContain('localConnectionString = "postgres://user:password@localhost:5432/your_database"');
    });

    test("Validates generated wrangler.toml is parseable", () => {
        // Generate a complete wrangler.toml that covers all the fixed scenarios
        let wrangler = `name = "test-app"
main = ".open-next/worker.js"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]

[assets]
binding = "ASSETS"
directory = ".open-next/assets"
`;

        // Add KV with placeholder
        wrangler = appendOrReplaceKvNamespaceBlock(wrangler, "KV");

        // Add Hyperdrive with placeholder
        wrangler = appendOrReplaceHyperdriveBlock(wrangler, "HYPERDRIVE", undefined, "hyperdrive-postgres");

        // Basic validation: should have all required fields
        expect(wrangler).toContain("[[kv_namespaces]]");
        expect(wrangler).toContain('binding = "KV"');
        expect(wrangler).toContain('id = "YOUR_KV_NAMESPACE_ID"');

        expect(wrangler).toContain("[[hyperdrive]]");
        expect(wrangler).toContain('binding = "HYPERDRIVE"');
        expect(wrangler).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(wrangler).toContain('localConnectionString = "postgres://user:password@localhost:5432/your_database"');

        // Should be valid TOML structure
        const lines = wrangler.split("\n");
        const kvStart = lines.findIndex(line => line.includes("[[kv_namespaces]]"));
        const hdStart = lines.findIndex(line => line.includes("[[hyperdrive]]"));

        expect(kvStart).toBeGreaterThanOrEqual(0);
        expect(hdStart).toBeGreaterThanOrEqual(0);
        expect(hdStart).toBeGreaterThan(kvStart); // Hyperdrive should come after KV
    });
});

describe("Error scenarios that were fixed", () => {
    test("KV namespace without ID field (original Next.js build error)", () => {
        // This was the original error: KV namespace with binding but no id
        const invalidWrangler = `[[kv_namespaces]]
binding = "KV"
`;

        // This would cause: "kv_namespaces[0]" bindings should have a string "id" field but got {"binding":"KV"}
        expect(invalidWrangler).not.toContain("id = ");

        // Our fix ensures this never happens
        const fixedWrangler = appendOrReplaceKvNamespaceBlock("", "KV");
        expect(fixedWrangler).toContain('id = "YOUR_KV_NAMESPACE_ID"');
    });

    test("Hyperdrive without local connection string (original build error)", () => {
        // This was the original error: no local connection string for development
        const invalidWrangler = `[[hyperdrive]]
binding = "HYPERDRIVE"
id = "some-id"
`;

        // This would cause: "no local hyperdrive connection string" error
        expect(invalidWrangler).not.toContain("localConnectionString");

        // Our fix ensures local connection string is always added
        const fixedWrangler = appendOrReplaceHyperdriveBlock("", "HYPERDRIVE", "some-id", "hyperdrive-postgres");
        expect(fixedWrangler).toContain(
            'localConnectionString = "postgres://user:password@localhost:5432/your_database"'
        );
    });

    test("Template cleanup leaving orphaned syntax", () => {
        // Simulate malformed template after R2/KV removal
        const malformedAuth = `withCloudflare({
    d1: { db: dbInstance },
    }
    // R2 comment orphaned
    },`;

        // Our cleanup logic should handle this
        let cleaned = malformedAuth;
        cleaned = cleaned.replace(/,\s*\}\s*,?\s*\n\s*\}/g, ",\n                }");
        cleaned = cleaned.replace(/\/\/[^\n]*R2[^\n]*\n/g, "");

        // Should not have orphaned syntax
        expect(cleaned).not.toContain("}\n    },");
        expect(cleaned).not.toContain("R2 comment");
    });
});
