import { describe, expect, test } from "bun:test";
import {
    appendOrReplaceHyperdriveBlock,
    appendOrReplaceKvNamespaceBlock,
    appendOrReplaceR2Block,
    extractFirstBlock,
    updateD1Block,
    updateD1BlockWithId,
    updateHyperdriveBlockWithId,
    updateKvBlockWithId,
    validateBindingName,
} from "../src/lib/helpers.js";
import { clearAllHyperdriveBlocks, clearAllKvBlocks, clearAllR2Blocks } from "../src/index.js";

const baseToml = `name = "app"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "db"

[[kv_namespaces]]
binding = "KV"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "bucket"
`;

describe("validateBindingName", () => {
    test("accepts caps, numbers, underscores", () => {
        expect(validateBindingName("FOO_123")).toBeUndefined();
    });
    test("rejects lowercase", () => {
        expect(validateBindingName("foo")).toBeTruthy();
    });
    test("rejects dash", () => {
        expect(validateBindingName("BAD-NAME")).toBeTruthy();
    });
});

describe("extractFirstBlock", () => {
    test("finds d1 block", () => {
        const res = extractFirstBlock(baseToml, "d1_databases");
        expect(res?.block).toContain("[[d1_databases]]");
    });
    test("returns null when header not present", () => {
        const res = extractFirstBlock(baseToml, "not_exists");
        expect(res).toBeNull();
    });
});

describe("updateD1Block", () => {
    test("updates binding and database name", () => {
        const out = updateD1Block(baseToml, "DB", "mydb");
        expect(out).toContain('binding = "DB"');
        expect(out).toContain('database_name = "mydb"');
    });
    test("no-op if no d1 block", () => {
        const noD1 = baseToml.replace(/\[\[d1_databases\]\][\s\S]*/m, "");
        const out = updateD1Block(noD1, "DB", "mydb");
        expect(out).toEqual(noD1);
    });
});

describe("appendOrReplaceKvNamespaceBlock", () => {
    test("replaces kv block by binding", () => {
        const out = appendOrReplaceKvNamespaceBlock(baseToml, "SESSIONS");
        expect(out).toContain('binding = "SESSIONS"');
    });
    test("adds id if provided", () => {
        const out = appendOrReplaceKvNamespaceBlock(baseToml, "SESSIONS", "123");
        expect(out).toContain('id = "123"');
    });
    test("appends when no kv block exists", () => {
        const noKv = baseToml.replace(/\[\[kv_namespaces\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
        const out = appendOrReplaceKvNamespaceBlock(noKv, "CACHE");
        expect(out).toContain("[[kv_namespaces]]");
        expect(out).toContain('binding = "CACHE"');
    });
});

describe("appendOrReplaceR2Block", () => {
    test("replaces r2 bucket binding", () => {
        const out = appendOrReplaceR2Block(baseToml, "FILES", "my-bucket");
        expect(out).toContain('binding = "FILES"');
        expect(out).toContain('bucket_name = "my-bucket"');
    });
    test("appends when no r2 block exists", () => {
        const noR2 = baseToml.replace(/\[\[r2_buckets\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
        const out = appendOrReplaceR2Block(noR2, "FILES", "my-bucket");
        expect(out).toContain("[[r2_buckets]]");
    });
});

describe("appendOrReplaceHyperdriveBlock", () => {
    test("adds hyperdrive block with PostgreSQL defaults", () => {
        const out = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", "abcd");
        expect(out).toContain("[[hyperdrive]]");
        expect(out).toContain('binding = "HYPERDRIVE"');
        expect(out).toContain('id = "abcd"');
        // Should default to PostgreSQL connection string
        expect(out).toContain('localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"');
    });

    test("adds hyperdrive block with MySQL connection string", () => {
        const out = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", "abcd", "hyperdrive-mysql");
        expect(out).toContain("[[hyperdrive]]");
        expect(out).toContain('binding = "HYPERDRIVE"');
        expect(out).toContain('id = "abcd"');
        expect(out).toContain('localConnectionString = "mysql://root:password@localhost:3306/mysql"');
    });

    test("adds hyperdrive block with PostgreSQL connection string explicitly", () => {
        const out = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", "abcd", "hyperdrive-postgres");
        expect(out).toContain("[[hyperdrive]]");
        expect(out).toContain('binding = "HYPERDRIVE"');
        expect(out).toContain('id = "abcd"');
        expect(out).toContain('localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"');
    });

    test("adds placeholder ID when no ID provided (skip-cloudflare-setup fix)", () => {
        const out = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", undefined, "hyperdrive-postgres");
        expect(out).toContain("[[hyperdrive]]");
        expect(out).toContain('binding = "HYPERDRIVE"');
        expect(out).toContain('id = "YOUR_HYPERDRIVE_ID"');
        expect(out).toContain('localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"');
    });

    test("replaces existing hyperdrive block", () => {
        const first = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", "abcd");
        const second = appendOrReplaceHyperdriveBlock(first, "HYPERDRIVE", "efgh");
        expect(second).toContain('id = "efgh"');
        expect(second).not.toContain('id = "abcd"');
        // Should still have local connection string
        expect(second).toContain('localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"');
    });

    test("validates complete Hyperdrive configuration format", () => {
        const out = appendOrReplaceHyperdriveBlock(baseToml, "HYPERDRIVE", "hd-123", "hyperdrive-postgres");

        // Verify structure is correct
        const lines = out.split("\n");
        const hyperdriveStart = lines.findIndex(line => line.includes("[[hyperdrive]]"));
        expect(hyperdriveStart).toBeGreaterThanOrEqual(0);

        // Should have all required fields in correct order
        expect(lines[hyperdriveStart + 1]).toContain('binding = "HYPERDRIVE"');
        expect(lines[hyperdriveStart + 2]).toContain('id = "hd-123"');
        expect(lines[hyperdriveStart + 3]).toContain(
            'localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"'
        );
    });
});

describe("Wrangler.toml format validation", () => {
    test("prevents duplicate R2 blocks with same binding", () => {
        // Start with a toml that has an existing R2 block
        const existingR2Toml = `name = "app"
compatibility_date = "2025-03-01"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "existing-bucket"
`;

        // Try to add another R2 block with same binding - should replace, not duplicate
        const result = appendOrReplaceR2Block(existingR2Toml, "R2_BUCKET", "new-bucket");

        // Should only have one R2 block
        const r2BlockCount = (result.match(/\[\[r2_buckets\]\]/g) || []).length;
        expect(r2BlockCount).toBe(1);

        // Should have the new bucket name
        expect(result).toContain('bucket_name = "new-bucket"');
        expect(result).not.toContain('bucket_name = "existing-bucket"');
    });

    test("prevents duplicate R2 blocks with different bindings", () => {
        const existingR2Toml = `name = "app"
compatibility_date = "2025-03-01"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "existing-bucket"
`;

        // Add a different R2 binding - should create new block
        const result = appendOrReplaceR2Block(existingR2Toml, "R2_FILES", "files-bucket");

        // Should have two R2 blocks
        const r2BlockCount = (result.match(/\[\[r2_buckets\]\]/g) || []).length;
        expect(r2BlockCount).toBe(2);

        // Should have both bucket names
        expect(result).toContain('bucket_name = "existing-bucket"');
        expect(result).toContain('bucket_name = "files-bucket"');
    });

    test("KV namespace requires id field", () => {
        const kvBlock = appendOrReplaceKvNamespaceBlock(baseToml, "KV", "test-kv-id");

        // Must have both binding and id
        expect(kvBlock).toContain('binding = "KV"');
        expect(kvBlock).toContain('id = "test-kv-id"');

        // Should not create invalid KV block without id
        const invalidKvBlock = appendOrReplaceKvNamespaceBlock(baseToml, "KV");
        expect(invalidKvBlock).toContain('binding = "KV"');
        // When no id provided, should not add id field (this would be invalid for actual wrangler)
    });

    test("KV namespace adds placeholder ID when no ID provided (skip-cloudflare-setup fix)", () => {
        // This tests the fix for the Next.js build failure when --skip-cloudflare-setup=true
        const kvBlock = appendOrReplaceKvNamespaceBlock(baseToml, "KV");

        // Should have placeholder ID to prevent Next.js build failures
        expect(kvBlock).toContain('binding = "KV"');
        expect(kvBlock).toContain('id = "YOUR_KV_NAMESPACE_ID"');

        // Verify the generated wrangler.toml is valid TOML
        const tomlLines = kvBlock.split("\n");
        const kvBlockStart = tomlLines.findIndex(line => line.includes("[[kv_namespaces]]"));
        expect(kvBlockStart).toBeGreaterThanOrEqual(0);

        // Next line should have binding
        expect(tomlLines[kvBlockStart + 1]).toContain('binding = "KV"');
        // Following line should have placeholder ID
        expect(tomlLines[kvBlockStart + 2]).toContain('id = "YOUR_KV_NAMESPACE_ID"');
    });

    test("KV namespace uses real ID when provided", () => {
        const kvBlock = appendOrReplaceKvNamespaceBlock(baseToml, "KV", "real-kv-id-123");

        expect(kvBlock).toContain('binding = "KV"');
        expect(kvBlock).toContain('id = "real-kv-id-123"');
        expect(kvBlock).not.toContain("YOUR_KV_NAMESPACE_ID");
    });

    test("validates complete CLI-generated wrangler.toml format", () => {
        let toml = `name = "my-app"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "placeholder"
database_id = "placeholder"
migrations_dir = "drizzle"
`;

        // Apply all CLI transformations
        toml = updateD1Block(toml, "DATABASE", "my-app-db");
        toml = appendOrReplaceKvNamespaceBlock(toml, "KV", "kv-id-123");
        toml = appendOrReplaceR2Block(toml, "R2", "my-app-files");

        // Verify final format
        expect(toml).toContain('database_name = "my-app-db"');
        expect(toml).toContain('binding = "KV"');
        expect(toml).toContain('id = "kv-id-123"');
        expect(toml).toContain('binding = "R2"');
        expect(toml).toContain('bucket_name = "my-app-files"');

        // Ensure no duplicate blocks
        expect((toml.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);
        expect((toml.match(/\[\[r2_buckets\]\]/g) || []).length).toBe(1);
    });

    test("reproduces CLI duplicate R2 block issue", () => {
        // This reproduces the exact issue from the CLI generation
        const templateToml = `# For more details on how to configure Wrangler, refer to:
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

        // User chooses different R2 binding "R2" instead of "R2_BUCKET"
        // Use the CLI's approach: clear existing blocks then add new one
        let result = clearAllR2Blocks(templateToml);
        result = appendOrReplaceR2Block(result, "R2", "my-app-files");

        // Should have exactly one R2 block
        const r2BlockCount = (result.match(/\[\[r2_buckets\]\]/g) || []).length;
        expect(r2BlockCount).toBe(1);

        // Should only have the new binding, not the old one
        expect(result).toContain('binding = "R2"');
        expect(result).toContain('bucket_name = "my-app-files"');
        expect(result).not.toContain('binding = "R2_BUCKET"');
        expect(result).not.toContain('bucket_name = "better-auth-cloudflare-files"');
    });
});

describe("Clear functions", () => {
    test("clearAllR2Blocks removes all R2 bucket configurations", () => {
        const tomlWithMultipleR2 = `name = "app"

[[r2_buckets]]
binding = "R2_BUCKET"
bucket_name = "bucket1"

[[r2_buckets]]  
binding = "FILES"
bucket_name = "bucket2"

[[d1_databases]]
binding = "DATABASE"
`;

        const result = clearAllR2Blocks(tomlWithMultipleR2);

        expect(result).not.toContain("[[r2_buckets]]");
        expect(result).not.toContain('binding = "R2_BUCKET"');
        expect(result).not.toContain('binding = "FILES"');
        // Should preserve other blocks
        expect(result).toContain("[[d1_databases]]");
    });

    test("clearAllKvBlocks removes all KV namespace configurations", () => {
        const tomlWithMultipleKv = `name = "app"

[[kv_namespaces]]
binding = "KV"
id = "id1"

[[kv_namespaces]]
binding = "CACHE"
id = "id2"

[[d1_databases]]
binding = "DATABASE"
`;

        const result = clearAllKvBlocks(tomlWithMultipleKv);

        expect(result).not.toContain("[[kv_namespaces]]");
        expect(result).not.toContain('binding = "KV"');
        expect(result).not.toContain('binding = "CACHE"');
        // Should preserve other blocks
        expect(result).toContain("[[d1_databases]]");
    });

    test("clearAllHyperdriveBlocks removes all Hyperdrive configurations", () => {
        const tomlWithMultipleHyperdrive = `name = "app"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "hd-123"
localConnectionString = "postgres://user:pass@localhost:5432/db"

[[hyperdrive]]
binding = "HYPERDRIVE_MYSQL"
id = "hd-456"
localConnectionString = "mysql://user:pass@localhost:3306/db"

[[d1_databases]]
binding = "DATABASE"
`;

        const result = clearAllHyperdriveBlocks(tomlWithMultipleHyperdrive);

        expect(result).not.toContain("[[hyperdrive]]");
        expect(result).not.toContain('binding = "HYPERDRIVE"');
        expect(result).not.toContain('binding = "HYPERDRIVE_MYSQL"');
        expect(result).not.toContain("localConnectionString");
        // Should preserve other blocks
        expect(result).toContain("[[d1_databases]]");
    });
});
