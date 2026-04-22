import { describe, expect, test } from "bun:test";
import { parseWranglerConfig } from "../src/lib/helpers.js";

describe("parseWranglerConfig", () => {
    test("parses D1 database from TOML", () => {
        const toml = `
name = "test"

[[d1_databases]]
binding = "DATABASE"
database_name = "mydb"
database_id = "abc-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: "abc-123",
        });
    });

    test("parses D1 database from JSON", () => {
        const json = JSON.stringify({
            name: "test",
            d1_databases: [
                {
                    binding: "DATABASE",
                    database_name: "mydb",
                    database_id: "abc-123",
                },
            ],
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: "abc-123",
        });
    });

    test("parses D1 database from JSONC with comments", () => {
        const jsonc = `{
            // This is a comment
            "name": "test",
            "d1_databases": [
                {
                    "binding": "DATABASE",
                    "database_name": "mydb"
                }
            ]
        }`;
        const result = parseWranglerConfig(jsonc, "jsonc");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0].type).toBe("d1");
        expect(result.databases[0].binding).toBe("DATABASE");
    });

    test("parses Hyperdrive from TOML", () => {
        const toml = `
name = "test"

[[hyperdrive]]
binding = "HD"
id = "hyperdrive-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "hyperdrive",
            binding: "HD",
            id: "hyperdrive-123",
        });
    });

    test("parses Hyperdrive from JSON", () => {
        const json = JSON.stringify({
            name: "test",
            hyperdrive: [
                {
                    binding: "HD",
                    id: "hyperdrive-123",
                },
            ],
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0]).toEqual({
            type: "hyperdrive",
            binding: "HD",
            id: "hyperdrive-123",
        });
    });

    test("parses multiple databases", () => {
        const toml = `
name = "test"

[[d1_databases]]
binding = "DB"
database_name = "db1"

[[hyperdrive]]
binding = "HD"
id = "hd-123"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toHaveLength(2);
        expect(result.hasMultipleDatabases).toBe(true);
    });

    test("returns empty array when no databases", () => {
        const json = JSON.stringify({ name: "test" });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(0);
        expect(result.hasMultipleDatabases).toBe(false);
    });

    test("handles JSON with environment-specific config", () => {
        const json = JSON.stringify({
            name: "test",
            env: {
                production: {
                    d1_databases: [
                        {
                            binding: "DB",
                            database_name: "prod-db",
                        },
                    ],
                },
            },
        });
        const result = parseWranglerConfig(json, "json");
        expect(result.databases).toHaveLength(0);
    });

    test("parses with trailing commas in JSONC", () => {
        const jsonc = `{
            "name": "test",
            "d1_databases": [
                {
                    "binding": "DB",
                    "database_name": "db"
                },
            ],
        }`;
        const result = parseWranglerConfig(jsonc, "jsonc");
        expect(result.databases).toHaveLength(1);
        expect(result.databases[0].binding).toBe("DB");
    });
});
