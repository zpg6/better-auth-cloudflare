import { readdirSync, readFileSync } from "fs";
import { join, relative } from "path";

const ignoredDirectories = new Set([".git", ".next", ".open-next", ".wrangler", "dist", "node_modules"]);

export function snapshotMigrationSql(projectDirectory: string): Map<string, string> {
    const snapshot = new Map<string, string>();
    visit(projectDirectory);
    return snapshot;

    function visit(directory: string): void {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            } else if (entry.isFile() && entry.name.endsWith(".sql")) {
                snapshot.set(relative(projectDirectory, path), readFileSync(path, "utf8"));
            }
        }
    }
}

export function migrationSqlChanged(before: Map<string, string>, after: Map<string, string>): boolean {
    if (before.size !== after.size) return true;
    for (const [path, sql] of before) {
        if (after.get(path) !== sql) return true;
    }
    return false;
}

export function d1MigrationArgs(binding: string, target: "dev" | "remote"): string[] {
    return ["wrangler", "d1", "migrations", "apply", binding, target === "dev" ? "--local" : "--remote"];
}
