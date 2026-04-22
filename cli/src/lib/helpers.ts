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
    const databases: DatabaseConfig[] = [];

    // Parse D1 databases
    const d1Regex = /\[\[d1_databases\]\]\s*\n([^[]*?)(?=\n\[|\n$|$)/g;
    let d1Match;
    while ((d1Match = d1Regex.exec(tomlContent)) !== null) {
        const block = d1Match[1];
        const bindingRegex = /binding\s*=\s*"([^"]+)"/;
        const nameRegex = /database_name\s*=\s*"([^"]+)"/;
        const idRegex = /database_id\s*=\s*"([^"]+)"/;
        const bindingMatch = bindingRegex.exec(block);
        const nameMatch = nameRegex.exec(block);
        const idMatch = idRegex.exec(block);

        if (bindingMatch) {
            databases.push({
                type: "d1",
                binding: bindingMatch[1],
                name: nameMatch?.[1],
                id: idMatch?.[1],
            });
        }
    }

    // Parse Hyperdrive databases
    const hyperdriveRegex = /\[\[hyperdrive\]\]\s*\n([^[]*?)(?=\n\[|\n$|$)/g;
    let hyperdriveMatch;
    while ((hyperdriveMatch = hyperdriveRegex.exec(tomlContent)) !== null) {
        const block = hyperdriveMatch[1];
        const bindingRegex = /binding\s*=\s*"([^"]+)"/;
        const idRegex = /id\s*=\s*"([^"]+)"/;
        const bindingMatch = bindingRegex.exec(block);
        const idMatch = idRegex.exec(block);

        if (bindingMatch) {
            databases.push({
                type: "hyperdrive",
                binding: bindingMatch[1],
                id: idMatch?.[1],
            });
        }
    }

    return {
        databases,
        hasMultipleDatabases: databases.length > 1,
    };
}

export type WranglerConfigFormat = "toml" | "json" | "jsonc";

export interface WranglerConfigResult {
    path: string;
    content: string;
    format: WranglerConfigFormat;
}

export function findWranglerConfig(cwd: string = process.cwd()): WranglerConfigResult | null {
    const { existsSync } = require("fs");
    const { join } = require("path");

    const configFiles: Array<{ name: string; format: WranglerConfigFormat }> = [
        { name: "wrangler.json", format: "json" },
        { name: "wrangler.jsonc", format: "jsonc" },
        { name: "wrangler.toml", format: "toml" },
    ];

    for (const configFile of configFiles) {
        const configPath = join(cwd, configFile.name);
        if (existsSync(configPath)) {
            const { readFileSync } = require("fs");
            const content = readFileSync(configPath, "utf8");
            return {
                path: configPath,
                content,
                format: configFile.format,
            };
        }
    }

    return null;
}

export function findWranglerConfigWithExplicitPath(configPath: string): WranglerConfigResult | null {
    const { existsSync, readFileSync } = require("fs");
    const { extname, resolve } = require("path");

    const resolvedPath = resolve(configPath);

    if (!existsSync(resolvedPath)) {
        return null;
    }

    const ext = extname(configPath).toLowerCase();
    let format: WranglerConfigFormat;

    switch (ext) {
        case ".json":
            format = "json";
            break;
        case ".jsonc":
            format = "jsonc";
            break;
        case ".toml":
            format = "toml";
            break;
        default:
            return null;
    }

    const content = readFileSync(resolvedPath, "utf8");
    return {
        path: resolvedPath,
        content,
        format,
    };
}

export function parseWranglerConfig(
    content: string,
    format: WranglerConfigFormat
): {
    databases: DatabaseConfig[];
    hasMultipleDatabases: boolean;
} {
    const databases: DatabaseConfig[] = [];

    if (format === "toml") {
        const toml = require("@iarna/toml");
        const parsed = toml.parse(content);
        return parseWranglerConfigObject(parsed);
    }

    const jsonc = require("jsonc-simple-parser");
    const parsed = jsonc.parse(content);
    return parseWranglerConfigObject(parsed);
}

function parseWranglerConfigObject(parsed: Record<string, unknown>): {
    databases: DatabaseConfig[];
    hasMultipleDatabases: boolean;
} {
    const databases: DatabaseConfig[] = [];

    const d1Databases = parsed.d1_databases as Array<Record<string, unknown>> | undefined;
    if (d1Databases && Array.isArray(d1Databases)) {
        for (const db of d1Databases) {
            const binding = db.binding as string | undefined;
            if (binding) {
                databases.push({
                    type: "d1",
                    binding,
                    name: db.database_name as string | undefined,
                    id: db.database_id as string | undefined,
                });
            }
        }
    }

    const hyperdriveConfigs = parsed.hyperdrive as Record<string, unknown> | undefined;
    if (hyperdriveConfigs) {
        if (Array.isArray(hyperdriveConfigs)) {
            for (const hd of hyperdriveConfigs) {
                const binding = hd.binding as string | undefined;
                if (binding) {
                    databases.push({
                        type: "hyperdrive",
                        binding,
                        id: hd.id as string | undefined,
                    });
                }
            }
        } else if (typeof hyperdriveConfigs === "object") {
            for (const hd of Object.values(hyperdriveConfigs)) {
                if (typeof hd === "object" && hd !== null) {
                    const hdObj = hd as Record<string, unknown>;
                    const binding = hdObj.binding as string | undefined;
                    if (binding) {
                        databases.push({
                            type: "hyperdrive",
                            binding,
                            id: hdObj.id as string | undefined,
                        });
                    }
                }
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
