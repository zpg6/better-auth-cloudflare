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

describe("Existing Resource ID Retrieval", () => {
    // Note: These tests would require mocking wrangler commands in a real test environment
    // For now, we test the parsing logic with mock responses

    test("should parse D1 database info response correctly", () => {
        // Mock response from `wrangler d1 info <database-name>`
        const mockD1InfoResponse = `
 ⛅️ wrangler 4.28.1
───────────────────
📋 Database information for 'test-app-db':

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "existing-d1-id-456"
`;

        const result = extractD1DatabaseId(mockD1InfoResponse);
        expect(result).toBe("existing-d1-id-456");
    });

    test("should parse D1 database info table format response correctly", () => {
        // Mock response from `wrangler d1 info <database-name>` in table format
        const mockD1InfoTableResponse = `
 ⛅️ wrangler 4.30.0
───────────────────
┌───────────────────────┬──────────────────────────────────────┐
│                       │ 1ecff3a2-1246-4349-894f-017f9ae1e8ca │
├───────────────────────┼──────────────────────────────────────┤
│ name                  │ profile-site-db                      │
├───────────────────────┼──────────────────────────────────────┤
│ created_at            │ 2025-08-16T19:46:00.243Z             │
├───────────────────────┼──────────────────────────────────────┤
│ num_tables            │ 5                                    │
├───────────────────────┼──────────────────────────────────────┤
│ running_in_region     │ ENAM                                 │
└───────────────────────┴──────────────────────────────────────┘
`;

        const result = extractD1DatabaseId(mockD1InfoTableResponse);
        expect(result).toBe("1ecff3a2-1246-4349-894f-017f9ae1e8ca");
    });

    test("should parse KV namespace list response correctly", () => {
        // Mock response from `wrangler kv namespace list`
        const mockKvListResponse = `[
  {
    "id": "existing-kv-id-789",
    "title": "test-app-kv",
    "supports_url_encoding": true
  },
  {
    "id": "other-kv-id-123",
    "title": "other-namespace",
    "supports_url_encoding": true
  }
]`;

        // Test the JSON parsing logic that would be used in getExistingKvNamespaceId
        const namespaces = JSON.parse(mockKvListResponse);
        const targetNamespace = namespaces.find((ns: any) => ns.title === "test-app-kv");
        expect(targetNamespace?.id).toBe("existing-kv-id-789");
    });

    test("should parse Hyperdrive list response correctly", () => {
        // Mock response from `wrangler hyperdrive list`
        const mockHyperdriveListResponse = `[
  {
    "id": "existing-hyperdrive-id-abc",
    "name": "test-app-hyperdrive",
    "origin": {
      "database": "postgres",
      "host": "example.com",
      "port": 5432,
      "user": "user"
    }
  },
  {
    "id": "other-hyperdrive-id-def",
    "name": "other-hyperdrive",
    "origin": {
      "database": "mysql",
      "host": "example.com",
      "port": 3306,
      "user": "user"
    }
  }
]`;

        // Test the JSON parsing logic that would be used in getExistingHyperdriveId
        const hyperdrives = JSON.parse(mockHyperdriveListResponse);
        const targetHyperdrive = hyperdrives.find((hd: any) => hd.name === "test-app-hyperdrive");
        expect(targetHyperdrive?.id).toBe("existing-hyperdrive-id-abc");
    });
});

describe("Placeholder ID Replacement Integration", () => {
    test("should replace D1 placeholder ID with actual ID when database already exists", () => {
        const tomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"
compatibility_date = "2025-03-01"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "your-d1-database-id-here"
migrations_dir = "drizzle"`;

        const result = updateD1BlockWithId(tomlWithPlaceholder, "DATABASE", "test-app-db", "existing-d1-id-456");

        expect(result).toContain('database_id = "existing-d1-id-456"');
        expect(result).not.toContain("your-d1-database-id-here");
        expect(result).toContain('database_name = "test-app-db"');
        expect(result).toContain('binding = "DATABASE"');
    });

    test("should replace KV placeholder ID with actual ID when namespace already exists", () => {
        const tomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"`;

        const result = updateKvBlockWithId(tomlWithPlaceholder, "KV", "existing-kv-id-789");

        expect(result).toContain('id = "existing-kv-id-789"');
        expect(result).not.toContain("YOUR_KV_NAMESPACE_ID");
        expect(result).toContain('binding = "KV"');
    });

    test("should replace Hyperdrive placeholder ID with actual ID when hyperdrive already exists", () => {
        const tomlWithPlaceholder = `name = "test-app"
main = "src/index.ts"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id-here"
localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"`;

        const result = updateHyperdriveBlockWithId(tomlWithPlaceholder, "HYPERDRIVE", "existing-hyperdrive-id-abc");

        expect(result).toContain('id = "existing-hyperdrive-id-abc"');
        expect(result).not.toContain("your-hyperdrive-id-here");
        expect(result).toContain('binding = "HYPERDRIVE"');
        expect(result).toContain('localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"');
    });

    test("should handle multiple resources with mixed placeholder and real IDs", () => {
        const tomlWithMixedIds = `name = "test-app"
main = "src/index.ts"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-app-db"
database_id = "your-d1-database-id-here"
migrations_dir = "drizzle"

[[kv_namespaces]]
binding = "KV"
id = "existing-kv-id-789"

[[hyperdrive]]
binding = "HYPERDRIVE"
id = "your-hyperdrive-id-here"
localConnectionString = "postgresql://postgres:password@localhost:5432/postgres"`;

        // Replace D1 placeholder
        let result = updateD1BlockWithId(tomlWithMixedIds, "DATABASE", "test-app-db", "existing-d1-id-456");

        // Replace Hyperdrive placeholder
        result = updateHyperdriveBlockWithId(result, "HYPERDRIVE", "existing-hyperdrive-id-abc");

        // Verify all IDs are correctly set
        expect(result).toContain('database_id = "existing-d1-id-456"');
        expect(result).toContain('id = "existing-kv-id-789"'); // Should remain unchanged
        expect(result).toContain('id = "existing-hyperdrive-id-abc"');

        // Verify no placeholders remain
        expect(result).not.toContain("your-d1-database-id-here");
        expect(result).not.toContain("your-hyperdrive-id-here");
    });
});
