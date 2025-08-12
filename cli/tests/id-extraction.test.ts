import { describe, test, expect } from "bun:test";
import {
    extractD1DatabaseId,
    extractKvNamespaceId,
    extractHyperdriveId,
    updateD1BlockWithId,
    updateKvBlockWithId,
    updateHyperdriveBlockWithId,
} from "../src/lib/helpers.js";

describe("ID Extraction from Wrangler Responses", () => {
    test("extractD1DatabaseId should extract database ID from TOML response", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
✅ Successfully created DB 'test-db' in region ENAM
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "test-db"
database_id = "2910d945-4dc7-4346-b0a9-2a14785ef92b"
`;

        const result = extractD1DatabaseId(wranglerOutput);
        expect(result).toBe("2910d945-4dc7-4346-b0a9-2a14785ef92b");
    });

    test("extractD1DatabaseId should extract database ID from JSON response (fallback)", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
✅ Successfully created DB 'test-db' in region ENAM
Created your new D1 database.

{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "test-db",
      "database_id": "2910d945-4dc7-4346-b0a9-2a14785ef92b"
    }
  ]
}`;

        const result = extractD1DatabaseId(wranglerOutput);
        expect(result).toBe("2910d945-4dc7-4346-b0a9-2a14785ef92b");
    });

    test("extractD1DatabaseId should return null for invalid response", () => {
        const wranglerOutput = "Error: Failed to create database";
        const result = extractD1DatabaseId(wranglerOutput);
        expect(result).toBe(null);
    });

    test("extractKvNamespaceId should extract namespace ID from TOML response", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
Resource location: remote
🌀 Creating namespace with title "test-kv"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "test_kv"
id = "94f7b677f6d0461cb9db26caefcc6b82"
`;

        const result = extractKvNamespaceId(wranglerOutput);
        expect(result).toBe("94f7b677f6d0461cb9db26caefcc6b82");
    });

    test("extractKvNamespaceId should extract namespace ID from JSON response (fallback)", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
Resource location: remote
🌀 Creating namespace with title "test-kv"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{
  "kv_namespaces": [
    {
      "binding": "test_kv",
      "id": "94f7b677f6d0461cb9db26caefcc6b82"
    }
  ]
}`;

        const result = extractKvNamespaceId(wranglerOutput);
        expect(result).toBe("94f7b677f6d0461cb9db26caefcc6b82");
    });

    test("extractKvNamespaceId should return null for invalid response", () => {
        const wranglerOutput = "Error: Failed to create namespace";
        const result = extractKvNamespaceId(wranglerOutput);
        expect(result).toBe(null);
    });

    test("extractHyperdriveId should extract ID from TOML format response", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
🚧 Creating 'test-hyperdrive'
✅ Created new Hyperdrive PostgreSQL config: a1b2c3d4-e5f6-7890-abcd-ef1234567890
📋 To start using your config from a Worker, add the following binding configuration to your wrangler.toml file:

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
`;

        const result = extractHyperdriveId(wranglerOutput);
        expect(result).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    test("extractHyperdriveId should extract ID from text format response (fallback)", () => {
        const wranglerOutput = `
 ⛅️ wrangler 4.28.1
───────────────────
🚀 Created new Hyperdrive config
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
name: test-hyperdrive
origin: postgresql://user:pass@host:5432/db`;

        const result = extractHyperdriveId(wranglerOutput);
        expect(result).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    test("extractHyperdriveId should extract ID from JSON format response", () => {
        const wranglerOutput = `
{
  "hyperdrive": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "test-hyperdrive"
  }
}`;

        const result = extractHyperdriveId(wranglerOutput);
        expect(result).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    test("extractHyperdriveId should return null for invalid response", () => {
        const wranglerOutput = "Error: Failed to create hyperdrive";
        const result = extractHyperdriveId(wranglerOutput);
        expect(result).toBe(null);
    });
});

describe("TOML Update Functions", () => {
    test("updateD1BlockWithId should update database_id in TOML", () => {
        const toml = `name = "test-app"
main = "src/index.ts"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-db"
database_id = "YOUR_D1_DATABASE_ID"
migrations_dir = "drizzle"`;

        const result = updateD1BlockWithId(toml, "DATABASE", "test-db", "real-database-id-123");

        expect(result).toContain('database_id = "real-database-id-123"');
        expect(result).not.toContain("YOUR_D1_DATABASE_ID");
    });

    test("updateKvBlockWithId should update KV namespace ID in TOML", () => {
        const toml = `name = "test-app"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"`;

        const result = updateKvBlockWithId(toml, "KV", "real-kv-id-123");

        expect(result).toContain('id = "real-kv-id-123"');
        expect(result).not.toContain("YOUR_KV_NAMESPACE_ID");
    });

    test("updateHyperdriveBlockWithId should update hyperdrive ID in TOML", () => {
        const toml = `name = "test-app"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "YOUR_HYPERDRIVE_ID"
localConnectionString = "postgresql://user:pass@localhost:5432/db"`;

        const result = updateHyperdriveBlockWithId(toml, "HYPERDRIVE", "real-hyperdrive-id-123");

        expect(result).toContain('id = "real-hyperdrive-id-123"');
        expect(result).not.toContain("YOUR_HYPERDRIVE_ID");
    });

    test("updateD1BlockWithId should add database_id if missing", () => {
        const toml = `name = "test-app"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-db"
migrations_dir = "drizzle"`;

        const result = updateD1BlockWithId(toml, "DATABASE", "test-db", "new-database-id-123");

        expect(result).toContain('database_id = "new-database-id-123"');
        expect(result).toContain('database_name = "test-db"');
    });

    test("updateHyperdriveBlockWithId should add id if missing", () => {
        const toml = `name = "test-app"

[[hyperdrive]]
binding = "HYPERDRIVE"
localConnectionString = "postgresql://user:pass@localhost:5432/db"`;

        const result = updateHyperdriveBlockWithId(toml, "HYPERDRIVE", "new-hyperdrive-id-123");

        expect(result).toContain('id = "new-hyperdrive-id-123"');
        expect(result).toContain('binding = "HYPERDRIVE"');
    });
});
