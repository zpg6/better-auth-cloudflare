import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { updateD1BlockWithId, updateKvBlockWithId, updateHyperdriveBlockWithId } from "../src/lib/helpers.js";

describe("Existing Resources Placeholder ID Replacement", () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
        // Create a temporary directory for each test
        originalCwd = process.cwd();
        testDir = join(tmpdir(), `existing-resources-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        process.chdir(testDir);
    });

    afterEach(() => {
        // Clean up
        process.chdir(originalCwd);
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe("D1 Database Existing Resource Handling", () => {
        test("should replace D1 placeholder ID when database already exists", () => {
            // Create a wrangler.toml with placeholder ID (simulating initial generation)
            const wranglerTomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"
compatibility_date = "2025-03-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "your-d1-database-id-here"
migrations_dir = "drizzle"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            // Simulate the CLI detecting that the database already exists and updating the ID
            const existingDatabaseId = "existing-d1-database-id-12345";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateD1BlockWithId(currentWrangler, "DATABASE", "test-app-db", existingDatabaseId);
            writeFileSync(wranglerPath, updatedWrangler);

            // Verify the placeholder was replaced with the actual ID
            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`database_id = "${existingDatabaseId}"`);
            expect(finalWrangler).not.toContain("your-d1-database-id-here");
            expect(finalWrangler).toContain('database_name = "test-app-db"');
            expect(finalWrangler).toContain('binding = "DATABASE"');
        });

        test("should handle D1 database with custom binding name", () => {
            const wranglerTomlWithPlaceholder = `name = "test-app"

[[d1_databases]]
binding = "CUSTOM_DB"
database_name = "my-custom-db"
database_id = "your-d1-database-id-here"
migrations_dir = "drizzle"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            const existingDatabaseId = "custom-db-id-67890";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateD1BlockWithId(
                currentWrangler,
                "CUSTOM_DB",
                "my-custom-db",
                existingDatabaseId
            );
            writeFileSync(wranglerPath, updatedWrangler);

            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`database_id = "${existingDatabaseId}"`);
            expect(finalWrangler).toContain('binding = "CUSTOM_DB"');
            expect(finalWrangler).not.toContain("your-d1-database-id-here");
        });
    });

    describe("KV Namespace Existing Resource Handling", () => {
        test("should replace KV placeholder ID when namespace already exists", () => {
            const wranglerTomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            // Simulate the CLI detecting that the KV namespace already exists and updating the ID
            const existingNamespaceId = "existing-kv-namespace-id-abcdef";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateKvBlockWithId(currentWrangler, "KV", existingNamespaceId);
            writeFileSync(wranglerPath, updatedWrangler);

            // Verify the placeholder was replaced with the actual ID
            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`id = "${existingNamespaceId}"`);
            expect(finalWrangler).not.toContain("YOUR_KV_NAMESPACE_ID");
            expect(finalWrangler).toContain('binding = "KV"');
        });

        test("should handle KV namespace with custom binding name", () => {
            const wranglerTomlWithPlaceholder = `name = "test-app"

[[kv_namespaces]]
binding = "CACHE_STORE"
id = "YOUR_KV_NAMESPACE_ID"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            const existingNamespaceId = "cache-store-id-xyz123";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateKvBlockWithId(currentWrangler, "CACHE_STORE", existingNamespaceId);
            writeFileSync(wranglerPath, updatedWrangler);

            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`id = "${existingNamespaceId}"`);
            expect(finalWrangler).toContain('binding = "CACHE_STORE"');
            expect(finalWrangler).not.toContain("YOUR_KV_NAMESPACE_ID");
        });
    });

    describe("Hyperdrive Existing Resource Handling", () => {
        test("should replace Hyperdrive placeholder ID when hyperdrive already exists", () => {
            const wranglerTomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id-here"
localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            // Simulate the CLI detecting that the Hyperdrive already exists and updating the ID
            const existingHyperdriveId = "existing-hyperdrive-id-fedcba";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateHyperdriveBlockWithId(
                currentWrangler,
                "HYPERDRIVE",
                existingHyperdriveId,
                "postgresql://postgres:password@localhost:5432/postgres"
            );
            writeFileSync(wranglerPath, updatedWrangler);

            // Verify the placeholder was replaced with the actual ID
            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`id = "${existingHyperdriveId}"`);
            expect(finalWrangler).not.toContain("your-hyperdrive-id-here");
            expect(finalWrangler).toContain('binding = "HYPERDRIVE"');
            expect(finalWrangler).toContain(
                'localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"'
            );
        });

        test("should handle Hyperdrive with custom binding and connection string", () => {
            const wranglerTomlWithPlaceholder = `name = "test-app"

[[hyperdrive]]
binding = "POSTGRES_DB"
id = "your-hyperdrive-id-here"
localConnectionString = "postgresql://user:pass@custom-host:5432/mydb"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholder);

            const existingHyperdriveId = "postgres-hyperdrive-id-456789";
            const customConnectionString = "postgresql://user:pass@custom-host:5432/mydb";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateHyperdriveBlockWithId(
                currentWrangler,
                "POSTGRES_DB",
                existingHyperdriveId,
                customConnectionString
            );
            writeFileSync(wranglerPath, updatedWrangler);

            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain(`id = "${existingHyperdriveId}"`);
            expect(finalWrangler).toContain('binding = "POSTGRES_DB"');
            expect(finalWrangler).toContain(`localConnectionString = "${customConnectionString}"`);
            expect(finalWrangler).not.toContain("your-hyperdrive-id-here");
        });
    });

    describe("Multiple Existing Resources", () => {
        test("should replace all placeholder IDs when multiple resources already exist", () => {
            const wranglerTomlWithPlaceholders = `name = "test-app"
main = "src/index.ts"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "your-d1-database-id-here"
migrations_dir = "drizzle"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id-here"
localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlWithPlaceholders);

            // Simulate the CLI detecting that all resources already exist and updating their IDs
            const existingD1Id = "real-d1-id-111";
            const existingKvId = "real-kv-id-222";
            const existingHyperdriveId = "real-hyperdrive-id-333";

            let currentWrangler = readFileSync(wranglerPath, "utf-8");

            // Update D1 ID
            currentWrangler = updateD1BlockWithId(currentWrangler, "DATABASE", "test-app-db", existingD1Id);

            // Update KV ID
            currentWrangler = updateKvBlockWithId(currentWrangler, "KV", existingKvId);

            // Update Hyperdrive ID
            currentWrangler = updateHyperdriveBlockWithId(
                currentWrangler,
                "HYPERDRIVE",
                existingHyperdriveId,
                "postgresql://postgres:password@localhost:5432/postgres"
            );

            writeFileSync(wranglerPath, currentWrangler);

            // Verify all placeholders were replaced with actual IDs
            const finalWrangler = readFileSync(wranglerPath, "utf-8");

            // Check that real IDs are present
            expect(finalWrangler).toContain(`database_id = "${existingD1Id}"`);
            expect(finalWrangler).toContain(`id = "${existingKvId}"`);
            expect(finalWrangler).toContain(`id = "${existingHyperdriveId}"`);

            // Check that no placeholders remain
            expect(finalWrangler).not.toContain("your-d1-database-id-here");
            expect(finalWrangler).not.toContain("YOUR_KV_NAMESPACE_ID");
            expect(finalWrangler).not.toContain("your-hyperdrive-id-here");

            // Verify structure is preserved
            expect(finalWrangler).toContain('binding = "DATABASE"');
            expect(finalWrangler).toContain('binding = "KV"');
            expect(finalWrangler).toContain('binding = "HYPERDRIVE"');
        });

        test("should handle partial existing resources (some new, some existing)", () => {
            const wranglerTomlMixed = `name = "test-app"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "newly-created-d1-id-123"
migrations_dir = "drizzle"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "newly-created-hyperdrive-id-456"
localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlMixed);

            // Only update the KV namespace ID (simulating that D1 and Hyperdrive were newly created, but KV already existed)
            const existingKvId = "existing-kv-id-from-account";
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateKvBlockWithId(currentWrangler, "KV", existingKvId);
            writeFileSync(wranglerPath, updatedWrangler);

            const finalWrangler = readFileSync(wranglerPath, "utf-8");

            // Check that the existing KV ID was updated
            expect(finalWrangler).toContain(`id = "${existingKvId}"`);
            expect(finalWrangler).not.toContain("YOUR_KV_NAMESPACE_ID");

            // Check that the newly created resource IDs remain unchanged
            expect(finalWrangler).toContain('database_id = "newly-created-d1-id-123"');
            expect(finalWrangler).toContain('id = "newly-created-hyperdrive-id-456"');
        });
    });

    describe("Edge Cases", () => {
        test("should handle wrangler.toml with no placeholder IDs (all resources newly created)", () => {
            const wranglerTomlNoPlaceholders = `name = "test-app"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "newly-created-d1-id"
migrations_dir = "drizzle"

[[kv_namespaces]]
binding = "KV"
id = "newly-created-kv-id"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, wranglerTomlNoPlaceholders);

            // This should not change anything since there are no placeholders
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateD1BlockWithId(currentWrangler, "DATABASE", "test-app-db", "different-id");
            writeFileSync(wranglerPath, updatedWrangler);

            const finalWrangler = readFileSync(wranglerPath, "utf-8");
            expect(finalWrangler).toContain('database_id = "different-id"'); // Should be updated
            expect(finalWrangler).toContain('id = "newly-created-kv-id"'); // Should remain unchanged
        });

        test("should handle empty wrangler.toml", () => {
            const emptyWrangler = `name = "test-app"
main = "src/index.ts"`;

            const wranglerPath = join(testDir, "wrangler.toml");
            writeFileSync(wranglerPath, emptyWrangler);

            // This should not crash or change anything
            const currentWrangler = readFileSync(wranglerPath, "utf-8");
            const updatedWrangler = updateD1BlockWithId(currentWrangler, "DATABASE", "test-db", "some-id");

            // Since there's no D1 block, it should remain unchanged
            expect(updatedWrangler).toBe(currentWrangler);
        });
    });
});
