import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { d1MigrationArgs, migrationSqlChanged, snapshotMigrationSql } from "../src/lib/migration-safety";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

test("detects generated and modified migration SQL", () => {
    const directory = mkdtempSync(join(tmpdir(), "bac-migration-safety-"));
    temporaryDirectories.push(directory);
    mkdirSync(join(directory, "drizzle"));
    writeFileSync(join(directory, "drizzle/0000_initial.sql"), "CREATE TABLE users (id text);");

    const initial = snapshotMigrationSql(directory);
    expect(migrationSqlChanged(initial, snapshotMigrationSql(directory))).toBe(false);

    writeFileSync(join(directory, "drizzle/0001_next.sql"), "ALTER TABLE users ADD name text;");
    expect(migrationSqlChanged(initial, snapshotMigrationSql(directory))).toBe(true);

    const generated = snapshotMigrationSql(directory);
    writeFileSync(join(directory, "drizzle/0001_next.sql"), "DELETE FROM users;");
    expect(migrationSqlChanged(generated, snapshotMigrationSql(directory))).toBe(true);
});

test("ignores SQL under dependency and build directories", () => {
    const directory = mkdtempSync(join(tmpdir(), "bac-migration-safety-"));
    temporaryDirectories.push(directory);
    for (const ignored of ["node_modules", ".next", ".open-next", ".wrangler", "dist", ".git"]) {
        mkdirSync(join(directory, ignored));
        writeFileSync(join(directory, ignored, "ignored.sql"), "DELETE FROM users;");
    }

    expect(snapshotMigrationSql(directory).size).toBe(0);
});

test("targets the selected D1 binding", () => {
    expect(d1MigrationArgs("AUTH_DB", "dev")).toEqual(["wrangler", "d1", "migrations", "apply", "AUTH_DB", "--local"]);
    expect(d1MigrationArgs("AUDIT_DB", "remote")).toEqual([
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "AUDIT_DB",
        "--remote",
    ]);
});
