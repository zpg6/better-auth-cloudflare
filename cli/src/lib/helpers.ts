import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, resolve } from "path";
import { parse as parseJSONC, printParseErrorCode, type ParseError } from "jsonc-parser";
import { parse as parseTOML } from "smol-toml";

export type JSONValue = string | number | boolean | null | JSONArray | JSONObject;
export interface JSONObject {
    [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

const DYNAMIC_CORS_ORIGIN = `origin: (requestOrigin: string, c) => {
            const self = new URL(c.req.url).origin;
            return requestOrigin === self ? requestOrigin : "";
        },`;

/**
 * Replace a hardcoded/wildcard CORS origin in the Hono template with a dynamic
 * origin function that derives the allowed origin from the request URL.
 * Handles both the demo URL and the wildcard `"*"` placeholder.
 * Returns the input unchanged if neither pattern is present.
 */
export function replaceDemoCorsOrigin(code: string): string {
    return code
        .replace(`origin: "https://better-auth-cloudflare-hono.zpg6.workers.dev",`, DYNAMIC_CORS_ORIGIN)
        .replace(/origin: "\*",.*/, DYNAMIC_CORS_ORIGIN);
}

export function validateBindingName(name: string): string | undefined {
    if (!name || name.trim().length === 0) return "Please enter a binding name";
    if (!/^[A-Z0-9_]+$/.test(name)) return "Use ONLY A-Z, 0-9, and underscores";
    return undefined;
}

export function updateJSON(filePath: string, mutator: (json: JSONObject) => JSONObject) {
    const { readFileSync, writeFileSync } = require("fs") as typeof import("fs");
    const json = JSON.parse(readFileSync(filePath, "utf8")) as JSONObject;
    const next = mutator(json);
    writeFileSync(filePath, JSON.stringify(next, null, 2));
}

export function extractFirstBlock(toml: string, header: string) {
    const re = new RegExp(`(\\[\\[${header}\\]\\][\\s\\S]*?)(?=\\n\\[\\[|$)`);
    const match = re.exec(toml);
    if (!match) return null;
    return { block: match[1], start: match.index, end: match.index + match[1].length };
}

export function updateD1Block(toml: string, binding: string, dbName: string) {
    const found = extractFirstBlock(toml, "d1_databases");
    if (!found) return toml;
    let block = found.block;
    if (/binding\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/binding\s*=\s*"[^"]+"/, `binding = "${binding}"`);
    } else {
        block = block.replace(/\[\[d1_databases\]\]/, `[[d1_databases]]\nbinding = "${binding}"`);
    }
    if (/database_name\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/database_name\s*=\s*"[^"]+"/, `database_name = "${dbName}"`);
    }
    return toml.slice(0, found.start) + block + toml.slice(found.end);
}

export function appendOrReplaceKvNamespaceBlock(toml: string, binding: string, id?: string) {
    const kvBlockRegex = /\[\[kv_namespaces\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(kvBlockRegex) || [];
    const newBlock = [
        "[[kv_namespaces]]",
        `binding = "${binding}"`,
        id ? `id = "${id}"` : `id = "YOUR_KV_NAMESPACE_ID"`,
    ].join("\n");

    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export function appendOrReplaceR2Block(toml: string, binding: string, bucketName: string) {
    const r2BlockRegex = /\[\[r2_buckets\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(r2BlockRegex) || [];
    const newBlock = ["[[r2_buckets]]", `binding = "${binding}"`, `bucket_name = "${bucketName}"`].join("\n");
    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export function appendOrReplaceHyperdriveBlock(
    toml: string,
    binding: string,
    id?: string,
    database?: "hyperdrive-postgres" | "hyperdrive-mysql",
    connectionString?: string
) {
    const blockRegex = /\[\[hyperdrive\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(blockRegex) || [];

    // Use provided connection string or fallback to proper local defaults
    let localConnectionString = connectionString || "postgresql://postgres:password@localhost:5432/postgres";
    if (!connectionString && database === "hyperdrive-mysql") {
        localConnectionString = "mysql://root:password@localhost:3306/mysql";
    }

    const placeholderId = id || "YOUR_HYPERDRIVE_ID";
    const newBlock = [
        "[[hyperdrive]]",
        `binding = "${binding}"`,
        `id = "${placeholderId}"`,
        `localConnectionString = "${localConnectionString}"`,
    ].join("\n");

    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export interface DatabaseConfig {
    type: "d1" | "hyperdrive";
    binding: string;
    name?: string;
    id?: string;
}

export function parseWranglerToml(tomlContent: string): {
    databases: DatabaseConfig[];
    hasMultipleDatabases: boolean;
} {
    return parseWranglerConfigObject(parseTOML(tomlContent));
}

export type WranglerConfigFormat = "toml" | "json" | "jsonc";

export interface WranglerConfigResult {
    path: string;
    content: string;
    format: WranglerConfigFormat;
}

function findFileUpward(referencePath: string, filename: string): string | null {
    let directory = resolve(referencePath);
    while (true) {
        const candidate = join(directory, filename);
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
        const parent = dirname(directory);
        if (parent === directory) return null;
        directory = parent;
    }
}

const unsupportedBoms = [
    { bytes: Buffer.from([0x00, 0x00, 0xfe, 0xff]), encoding: "UTF-32 BE" },
    { bytes: Buffer.from([0xff, 0xfe, 0x00, 0x00]), encoding: "UTF-32 LE" },
    { bytes: Buffer.from([0xfe, 0xff]), encoding: "UTF-16 BE" },
    { bytes: Buffer.from([0xff, 0xfe]), encoding: "UTF-16 LE" },
];

function readWranglerConfigFile(configPath: string): string {
    const content = readFileSync(configPath);
    for (const bom of unsupportedBoms) {
        if (content.subarray(0, bom.bytes.length).equals(bom.bytes)) {
            throw new Error(`Wrangler config uses ${bom.encoding}. Save it as UTF-8.`);
        }
    }

    const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const start = content.subarray(0, utf8Bom.length).equals(utf8Bom) ? utf8Bom.length : 0;
    return content.subarray(start).toString("utf8");
}

export function findWranglerConfig(cwd: string = process.cwd()): WranglerConfigResult | null {
    const configFiles: Array<{ name: string; format: WranglerConfigFormat }> = [
        { name: "wrangler.json", format: "json" },
        { name: "wrangler.jsonc", format: "jsonc" },
        { name: "wrangler.toml", format: "toml" },
    ];

    for (const configFile of configFiles) {
        const configPath = findFileUpward(cwd, configFile.name);
        if (configPath) {
            const content = readWranglerConfigFile(configPath);
            return {
                path: configPath,
                content,
                format: configFile.format,
            };
        }
    }

    return null;
}

export function parseWranglerConfig(
    content: string,
    format: WranglerConfigFormat
): {
    databases: DatabaseConfig[];
    hasMultipleDatabases: boolean;
} {
    if (format === "toml") {
        return parseWranglerToml(content);
    }

    const errors: ParseError[] = [];
    const parsed: unknown = parseJSONC(content, errors, {
        allowTrailingComma: true,
    });
    if (errors.length > 0) {
        const firstError = errors[0];
        throw new Error(
            `Invalid ${format.toUpperCase()} Wrangler config: ${printParseErrorCode(firstError.error)} at offset ${firstError.offset}.`
        );
    }
    return parseWranglerConfigObject(parsed);
}

interface WranglerConfigShape {
    d1_databases?: unknown;
    hyperdrive?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function parseWranglerConfigObject(parsed: unknown): {
    databases: DatabaseConfig[];
    hasMultipleDatabases: boolean;
} {
    if (!isRecord(parsed)) {
        throw new Error("Wrangler config must contain an object at its root.");
    }

    const config: WranglerConfigShape = {
        d1_databases: parsed["d1_databases"],
        hyperdrive: parsed["hyperdrive"],
    };
    const databases: DatabaseConfig[] = [];

    if (Array.isArray(config.d1_databases)) {
        for (const db of config.d1_databases) {
            if (!isRecord(db)) continue;
            const binding = readOptionalString(db["binding"]);
            if (binding) {
                databases.push({
                    type: "d1",
                    binding,
                    name: readOptionalString(db["database_name"]),
                    id: readOptionalString(db["database_id"]),
                });
            }
        }
    }

    if (Array.isArray(config.hyperdrive)) {
        for (const hd of config.hyperdrive) {
            if (!isRecord(hd)) continue;
            const binding = readOptionalString(hd["binding"]);
            if (binding) {
                databases.push({
                    type: "hyperdrive",
                    binding,
                    id: readOptionalString(hd["id"]),
                });
            }
        }
    }

    return {
        databases,
        hasMultipleDatabases: databases.length > 1,
    };
}

// Functions to extract IDs from wrangler command responses
export function extractD1DatabaseId(wranglerOutput: string): string | null {
    try {
        // Look for TOML format: database_id = "uuid"
        const tomlRegex = /database_id\s*=\s*"([^"]+)"/;
        const tomlMatch = tomlRegex.exec(wranglerOutput);
        if (tomlMatch) {
            return tomlMatch[1];
        }

        // Look for JSON response with database_id
        const jsonRegex = /\{[\s\S]*"database_id":\s*"([^"]+)"[\s\S]*\}/;
        const jsonMatch = jsonRegex.exec(wranglerOutput);
        if (jsonMatch) {
            return jsonMatch[1];
        }

        // Parse table format from `wrangler d1 info` command
        // The ID appears in the first row of the table without a label
        const lines = wranglerOutput.split("\n");
        for (const line of lines) {
            // Look for a line that contains a UUID (36 characters with hyphens)
            const uuidRegex = /│\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*│/i;
            const uuidMatch = uuidRegex.exec(line);
            if (uuidMatch) {
                return uuidMatch[1];
            }
        }

        return null;
    } catch {
        return null;
    }
}

export function extractKvNamespaceId(wranglerOutput: string): string | null {
    try {
        // Look for TOML format: id = "uuid"
        const tomlRegex = /id\s*=\s*"([^"]+)"/;
        const tomlMatch = tomlRegex.exec(wranglerOutput);
        if (tomlMatch) {
            return tomlMatch[1];
        }

        // Fallback: Look for JSON response with id field in KV context
        const jsonRegex = /"id":\s*"([a-f0-9]+)"/;
        const jsonMatch = jsonRegex.exec(wranglerOutput);
        if (jsonMatch) {
            return jsonMatch[1];
        }
        return null;
    } catch {
        return null;
    }
}

export function extractHyperdriveId(wranglerOutput: string): string | null {
    try {
        // Look for TOML format: id = "uuid"
        const tomlRegex = /id\s*=\s*"([^"]+)"/;
        const tomlMatch = tomlRegex.exec(wranglerOutput);
        if (tomlMatch) {
            return tomlMatch[1];
        }

        // Fallback: Look for Hyperdrive ID in text format: "id: uuid"
        const textRegex = /id:\s*([a-f0-9-]+)/i;
        const textMatch = textRegex.exec(wranglerOutput);
        if (textMatch) {
            return textMatch[1];
        }

        // Fallback: Look for JSON response with id field
        const jsonRegex = /\{[\s\S]*"id":\s*"([^"]+)"[\s\S]*\}/;
        const jsonMatch = jsonRegex.exec(wranglerOutput);
        if (jsonMatch) {
            return jsonMatch[1];
        }
        return null;
    } catch {
        return null;
    }
}

// Functions to update TOML with extracted IDs
export function updateD1BlockWithId(toml: string, binding: string, dbName: string, databaseId: string) {
    const found = extractFirstBlock(toml, "d1_databases");
    if (!found) return toml;
    let block = found.block;

    // Update binding
    if (/binding\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/binding\s*=\s*"[^"]+"/, `binding = "${binding}"`);
    } else {
        block = block.replace(/\[\[d1_databases\]\]/, `[[d1_databases]]\nbinding = "${binding}"`);
    }

    // Update database_name
    if (/database_name\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/database_name\s*=\s*"[^"]+"/, `database_name = "${dbName}"`);
    }

    // Update database_id
    if (/database_id\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/database_id\s*=\s*"[^"]+"/, `database_id = "${databaseId}"`);
    } else {
        // Add database_id after database_name
        block = block.replace(
            /database_name\s*=\s*"[^"]+"/,
            `database_name = "${dbName}"\ndatabase_id = "${databaseId}"`
        );
    }

    return toml.slice(0, found.start) + block + toml.slice(found.end);
}

export function updateKvBlockWithId(toml: string, binding: string, namespaceId: string) {
    // Use the existing appendOrReplaceKvNamespaceBlock but ensure it updates the ID
    return appendOrReplaceKvNamespaceBlock(toml, binding, namespaceId);
}

export function updateHyperdriveBlockWithId(
    toml: string,
    binding: string,
    hyperdriveId: string,
    connectionString?: string
) {
    const found = extractFirstBlock(toml, "hyperdrive");
    if (!found) return toml;
    let block = found.block;

    // Update id field
    if (/id\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/id\s*=\s*"[^"]+"/, `id = "${hyperdriveId}"`);
    } else {
        // Add id after binding
        block = block.replace(/binding\s*=\s*"[^"]+"/, `binding = "${binding}"\nid = "${hyperdriveId}"`);
    }

    // Update localConnectionString if provided
    if (connectionString) {
        if (/localConnectionString\s*=\s*"[^"]+"/.test(block)) {
            block = block.replace(
                /localConnectionString\s*=\s*"[^"]+"/,
                `localConnectionString = "${connectionString}"`
            );
        } else {
            // Add localConnectionString after id
            block = block.replace(
                /id\s*=\s*"[^"]+"/,
                `id = "${hyperdriveId}"\nlocalConnectionString = "${connectionString}"`
            );
        }
    }

    return toml.slice(0, found.start) + block + toml.slice(found.end);
}

export interface GitInitResult {
    success: boolean;
    error?: string;
}

export function initializeGitRepository(projectPath: string): GitInitResult {
    const { spawnSync } = require("child_process") as typeof import("child_process");

    // Check if git is available
    const gitCheck = spawnSync("git", ["--version"], { stdio: "pipe", encoding: "utf8" });
    if (gitCheck.status !== 0) {
        return { success: false, error: "Git is not installed or not available in PATH" };
    }

    // Initialize git repository
    const initResult = spawnSync("git", ["init"], {
        cwd: projectPath,
        stdio: "pipe",
        encoding: "utf8",
    });

    if (initResult.status !== 0) {
        return { success: false, error: `Failed to initialize git repository: ${initResult.stderr}` };
    }

    // Add all files to staging
    const addResult = spawnSync("git", ["add", "."], {
        cwd: projectPath,
        stdio: "pipe",
        encoding: "utf8",
    });

    if (addResult.status !== 0) {
        return { success: false, error: `Failed to add files to git: ${addResult.stderr}` };
    }

    // Create initial commit
    const commitResult = spawnSync("git", ["commit", "-m", "Initial commit"], {
        cwd: projectPath,
        stdio: "pipe",
        encoding: "utf8",
    });

    if (commitResult.status !== 0) {
        return { success: false, error: `Failed to create initial commit: ${commitResult.stderr}` };
    }

    return { success: true };
}
