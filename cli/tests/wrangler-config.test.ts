import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { findWranglerConfig, parseWranglerConfig } from "../src/lib/helpers.js";

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

    test("parses valid single-quoted TOML strings", () => {
        const result = parseWranglerConfig("[[d1_databases]]\nbinding = 'DATABASE'\ndatabase_name = 'mydb'", "toml");
        expect(result.databases[0]).toEqual({
            type: "d1",
            binding: "DATABASE",
            name: "mydb",
            id: undefined,
        });
    });

    test("accepts mixed-type TOML arrays", () => {
        const toml = `
[vars]
MIXED = [1, "two"]

[[d1_databases]]
binding = "DATABASE"
database_name = "mydb"
`;
        const result = parseWranglerConfig(toml, "toml");
        expect(result.databases).toEqual([
            {
                type: "d1",
                binding: "DATABASE",
                name: "mydb",
                id: undefined,
            },
        ]);
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

    test("ignores bindings under named environments", () => {
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

    test("accepts comments and trailing commas in a .json config", () => {
        const result = parseWranglerConfig('{ /* comment */ "d1_databases": [], }', "json");
        expect(result.databases).toEqual([]);
    });

    test("rejects a non-object root", () => {
        for (const value of ["[]", "null", '"value"', "1"]) {
            expect(() => parseWranglerConfig(value, "json")).toThrow("object at its root");
        }
    });

    test("ignores database entries without a string binding", () => {
        const result = parseWranglerConfig(
            '{ "d1_databases": [null, 1, { "binding": 123 }, { "binding": "DB", "database_name": 123 }] }',
            "json"
        );
        expect(result.databases).toEqual([{ type: "d1", binding: "DB", name: undefined, id: undefined }]);
    });

    test("ignores non-array d1_databases and hyperdrive values", () => {
        const result = parseWranglerConfig('{ "d1_databases": {}, "hyperdrive": "HD" }', "json");
        expect(result.databases).toEqual([]);
        expect(result.hasMultipleDatabases).toBe(false);
    });

    test("sets hasMultipleDatabases for two D1 bindings", () => {
        const result = parseWranglerConfig('{ "d1_databases": [{ "binding": "DB1" }, { "binding": "DB2" }] }', "json");
        expect(result.databases.map(database => database.binding)).toEqual(["DB1", "DB2"]);
        expect(result.hasMultipleDatabases).toBe(true);
    });

    test("rejects malformed and empty configs", () => {
        expect(() => parseWranglerConfig("", "json")).toThrow("Invalid JSON Wrangler config");
        expect(() => parseWranglerConfig('{ "d1_databases": [', "jsonc")).toThrow("Invalid JSONC Wrangler config");
        expect(() => parseWranglerConfig('name = "unterminated', "toml")).toThrow();
    });
});

describe("Wrangler config discovery", () => {
    test("matches Wrangler precedence", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            writeFileSync(join(directory, "wrangler.toml"), 'name = "toml"');
            writeFileSync(join(directory, "wrangler.jsonc"), '{ "name": "jsonc" }');
            writeFileSync(join(directory, "wrangler.json"), '{ "name": "json" }');

            const result = findWranglerConfig(directory);
            expect(result?.format).toBe("json");
            expect(basename(result?.path ?? "")).toBe("wrangler.json");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("matches Wrangler precedence across parent directories", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            const project = join(directory, "project");
            const nested = join(project, "src", "routes");
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(directory, "wrangler.json"), '{ "name": "parent-json" }');
            writeFileSync(join(project, "wrangler.toml"), 'name = "nearer-toml"');

            const result = findWranglerConfig(nested);
            expect(result?.format).toBe("json");
            expect(result?.path).toBe(join(directory, "wrangler.json"));
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("finds each supported filename in a parent directory", () => {
        const configs = [
            ["wrangler.json", "json"],
            ["wrangler.jsonc", "jsonc"],
            ["wrangler.toml", "toml"],
        ] as const;

        for (const [filename, format] of configs) {
            const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
            try {
                const nested = join(directory, "src", "routes");
                mkdirSync(nested, { recursive: true });
                writeFileSync(join(directory, filename), format === "toml" ? 'name = "test"' : '{ "name": "test" }');

                const result = findWranglerConfig(nested);
                expect(result?.format).toBe(format);
                expect(result?.path).toBe(join(directory, filename));
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    });

    test("applies filename precedence before directory proximity", () => {
        const cases = [
            ["wrangler.json", "wrangler.jsonc", "json"],
            ["wrangler.json", "wrangler.toml", "json"],
            ["wrangler.jsonc", "wrangler.toml", "jsonc"],
        ] as const;

        for (const [farther, nearer, expectedFormat] of cases) {
            const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
            try {
                const nested = join(directory, "project", "src");
                mkdirSync(nested, { recursive: true });
                writeFileSync(join(directory, farther), farther.endsWith(".toml") ? 'name = "far"' : "{}");
                writeFileSync(join(directory, "project", nearer), nearer.endsWith(".toml") ? 'name = "near"' : "{}");

                expect(findWranglerConfig(nested)?.format).toBe(expectedFormat);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    });

    test("uses the nearest file when filenames match", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            const project = join(directory, "project");
            const nested = join(project, "src");
            mkdirSync(nested, { recursive: true });
            writeFileSync(join(directory, "wrangler.jsonc"), '{ "name": "far" }');
            writeFileSync(join(project, "wrangler.jsonc"), '{ "name": "near" }');

            expect(findWranglerConfig(nested)?.content).toContain('"near"');
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("does not treat a directory as a config file", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            mkdirSync(join(directory, "wrangler.json"));
            expect(findWranglerConfig(directory)).toBeNull();
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("returns null when no config exists", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            expect(findWranglerConfig(directory)).toBeNull();
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test("strips a UTF-8 BOM from every supported format", () => {
        const configs = [
            ["wrangler.json", '{ "d1_databases": [{ "binding": "DB" }] }'],
            ["wrangler.jsonc", '{ /* comment */ "d1_databases": [{ "binding": "DB" }] }'],
            ["wrangler.toml", '[[d1_databases]]\nbinding = "DB"'],
        ] as const;

        for (const [filename, content] of configs) {
            const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
            try {
                writeFileSync(
                    join(directory, filename),
                    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content)])
                );
                const config = findWranglerConfig(directory);
                expect(config).not.toBeNull();
                if (!config) throw new Error("Expected Wrangler config");
                expect(config.content.charCodeAt(0)).not.toBe(0xfeff);
                expect(parseWranglerConfig(config.content, config.format).databases[0].binding).toBe("DB");
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    });

    test("rejects UTF-16 and UTF-32 byte order markers", () => {
        const boms = [
            [Buffer.from([0xfe, 0xff]), "UTF-16 BE"],
            [Buffer.from([0xff, 0xfe]), "UTF-16 LE"],
            [Buffer.from([0x00, 0x00, 0xfe, 0xff]), "UTF-32 BE"],
            [Buffer.from([0xff, 0xfe, 0x00, 0x00]), "UTF-32 LE"],
        ] as const;

        for (const [bom, encoding] of boms) {
            const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
            try {
                writeFileSync(join(directory, "wrangler.json"), bom);
                expect(() => findWranglerConfig(directory)).toThrow(encoding);
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    });

    test("does not fall back after finding an invalid higher-priority config", () => {
        const directory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-wrangler-"));
        try {
            writeFileSync(join(directory, "wrangler.json"), "{");
            writeFileSync(join(directory, "wrangler.toml"), '[[d1_databases]]\nbinding = "DB"');
            const config = findWranglerConfig(directory);

            expect(config?.format).toBe("json");
            if (!config) throw new Error("Expected Wrangler config");
            expect(() => parseWranglerConfig(config.content, config.format)).toThrow("Invalid JSON");
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
