export type JSONValue = string | number | boolean | null | JSONArray | JSONObject;
export interface JSONObject {
    [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

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
    const newBlock = ["[[kv_namespaces]]", `binding = "${binding}"`, id ? `id = "${id}"` : ""]
        .filter(Boolean)
        .join("\n");

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

export function appendOrReplaceHyperdriveBlock(toml: string, binding: string, id: string) {
    const blockRegex = /\[\[hyperdrive\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(blockRegex) || [];
    const newBlock = ["[[hyperdrive]]", `binding = "${binding}"`, `id = "${id}"`].join("\n");
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
        const bindingMatch = bindingRegex.exec(block);
        const nameMatch = nameRegex.exec(block);

        if (bindingMatch) {
            databases.push({
                type: "d1",
                binding: bindingMatch[1],
                name: nameMatch?.[1],
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
