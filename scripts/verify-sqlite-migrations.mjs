import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { rejectUnsafeDml } from "./sql-migration-safety.mjs";
import {
    assertDrizzleJournalEntriesMatch,
    assertDrizzleSnapshotsMatch,
    normalizeGeneratedSql,
} from "./drizzle-snapshot-safety.mjs";

const projectDirectory = resolve(process.argv[2] ?? ".");
const migrationDirectory = join(projectDirectory, "drizzle");
const migrationDatabase = new DatabaseSync(":memory:");
const schemaDatabase = new DatabaseSync(":memory:");
const verificationDirectory = mkdtempSync(join(tmpdir(), "bac-drizzle-verification-"));

try {
    const migrations = readdirSync(migrationDirectory)
        .filter(file => file.endsWith(".sql"))
        .sort();
    if (migrations.length === 0) throw new Error(`No migrations found in ${migrationDirectory}`);

    for (const migration of migrations) {
        const sql = readFileSync(join(migrationDirectory, migration), "utf8");
        rejectUnsafeDml(migration, sql);
        migrationDatabase.exec(sql);
    }

    const projectRequire = createRequire(join(projectDirectory, "package.json"));
    const packagePath = join(dirname(projectRequire.resolve("drizzle-kit")), "package.json");
    const drizzleKitPackage = JSON.parse(readFileSync(packagePath, "utf8"));
    const bin =
        typeof drizzleKitPackage.bin === "string" ? drizzleKitPackage.bin : drizzleKitPackage.bin?.["drizzle-kit"];
    if (typeof bin !== "string") throw new Error("Cannot find the installed drizzle-kit executable.");
    const drizzleKit = resolve(dirname(packagePath), bin);
    verifyLatestMigrationWasGenerated({
        drizzleKit,
        migrations,
        migrationDirectory,
        projectDirectory,
    });
    const schemaConfigPath = writeSchemaOnlyConfig(
        verificationDirectory,
        projectDirectory,
        join(verificationDirectory, "export")
    );
    const schemaSql = execFileSync(process.execPath, [drizzleKit, "export", `--config=${schemaConfigPath}`], {
        cwd: projectDirectory,
        encoding: "utf8",
    });
    schemaDatabase.exec(schemaSql);

    const migratedSchema = inspectSchema(migrationDatabase);
    const declaredSchema = inspectSchema(schemaDatabase);
    if (JSON.stringify(migratedSchema) !== JSON.stringify(declaredSchema)) {
        throw new Error(
            `The migration chain does not match the declared Drizzle schema.\n\nMigrations:\n${JSON.stringify(migratedSchema, null, 2)}\n\nSchema:\n${JSON.stringify(declaredSchema, null, 2)}`
        );
    }

    console.log(`Verified ${migrations.length} migrations against the declared Drizzle schema.`);
} finally {
    rmSync(verificationDirectory, { force: true, recursive: true });
    migrationDatabase.close();
    schemaDatabase.close();
}

function query(database, sql) {
    return database
        .prepare(sql)
        .all()
        .map(row => ({ ...row }));
}

function inspectSchema(database) {
    const tables = query(
        database,
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map(({ name }) => name);

    return {
        tables: tables.map(table => ({
            name: table,
            columns: query(
                database,
                `SELECT name, type, \"notnull\", dflt_value, pk, hidden FROM pragma_table_xinfo(${quote(table)}) ORDER BY name`
            ),
            foreignKeys: query(
                database,
                `SELECT id, seq, \"table\", \"from\", \"to\", on_update, on_delete, \"match\" FROM pragma_foreign_key_list(${quote(table)}) ORDER BY id, seq`
            ),
            indexes: inspectIndexes(database, table),
        })),
        viewsAndTriggers: query(
            database,
            "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE type IN ('view', 'trigger') ORDER BY type, name"
        ).map(object => ({ ...object, sql: normalizeSql(object.sql) })),
    };
}

function inspectIndexes(database, table) {
    return query(
        database,
        `SELECT name, \"unique\", origin, partial FROM pragma_index_list(${quote(table)}) ORDER BY name`
    ).map(index => ({
        ...index,
        columns: query(
            database,
            `SELECT seqno, name, \"desc\", coll, \"key\" FROM pragma_index_xinfo(${quote(index.name)}) ORDER BY seqno`
        ),
    }));
}

function quote(value) {
    return `'${value.replaceAll("'", "''")}'`;
}

function normalizeSql(sql) {
    return sql.replaceAll(/\s+/g, " ").trim();
}

function verifyLatestMigrationWasGenerated({ drizzleKit, migrations, migrationDirectory, projectDirectory }) {
    const journalPath = join(migrationDirectory, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const snapshots = readdirSync(join(migrationDirectory, "meta"))
        .filter(file => file.endsWith("_snapshot.json"))
        .sort();
    if (journal.entries.length !== migrations.length || snapshots.length !== migrations.length) {
        throw new Error("The Drizzle journal, migrations, and snapshots do not have matching lengths.");
    }
    const latestEntry = journal.entries.at(-1);
    if (!latestEntry || `${latestEntry.tag}.sql` !== migrations.at(-1)) {
        throw new Error("The latest Drizzle journal entry does not match the latest migration file.");
    }

    const temporaryDirectory = mkdtempSync(join(tmpdir(), "bac-drizzle-reproduction-"));
    const reproducedDirectory = join(temporaryDirectory, "drizzle");
    const reproducedMetaDirectory = join(reproducedDirectory, "meta");
    try {
        mkdirSync(reproducedMetaDirectory, { recursive: true });
        for (const migration of migrations.slice(0, -1)) {
            cpSync(join(migrationDirectory, migration), join(reproducedDirectory, migration));
        }
        for (const snapshot of snapshots.slice(0, -1)) {
            cpSync(join(migrationDirectory, "meta", snapshot), join(reproducedMetaDirectory, snapshot));
        }
        writeFileSync(
            join(reproducedMetaDirectory, "_journal.json"),
            JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }, null, 2)
        );

        const configPath = writeSchemaOnlyConfig(temporaryDirectory, projectDirectory, reproducedDirectory);
        execFileSync(process.execPath, [drizzleKit, "generate", `--config=${configPath}`], {
            cwd: projectDirectory,
            encoding: "utf8",
        });

        const reproducedMigrations = readdirSync(reproducedDirectory)
            .filter(file => file.endsWith(".sql"))
            .sort();
        const reproducedLatest = reproducedMigrations.at(-1);
        if (!reproducedLatest || reproducedMigrations.length !== migrations.length) {
            throw new Error("Drizzle did not reproduce exactly one latest migration.");
        }

        const committedSql = normalizeGeneratedSql(readFileSync(join(migrationDirectory, migrations.at(-1)), "utf8"));
        const reproducedSql = normalizeGeneratedSql(readFileSync(join(reproducedDirectory, reproducedLatest), "utf8"));
        if (committedSql !== reproducedSql) {
            throw new Error(
                `The latest migration does not match Drizzle Kit output. Regenerate ${migrations.at(-1)} instead of editing SQL by hand.`
            );
        }

        const reproducedSnapshots = readdirSync(reproducedMetaDirectory)
            .filter(file => file.endsWith("_snapshot.json"))
            .sort();
        const reproducedSnapshot = reproducedSnapshots.at(-1);
        if (!reproducedSnapshot || reproducedSnapshots.length !== snapshots.length) {
            throw new Error("Drizzle did not reproduce exactly one latest snapshot.");
        }
        assertDrizzleSnapshotsMatch(
            readFileSync(join(migrationDirectory, "meta", snapshots.at(-1)), "utf8"),
            readFileSync(join(reproducedMetaDirectory, reproducedSnapshot), "utf8"),
            snapshots.at(-1)
        );
        const reproducedJournal = JSON.parse(readFileSync(join(reproducedMetaDirectory, "_journal.json"), "utf8"));
        assertDrizzleJournalEntriesMatch(
            journal.entries.at(-1),
            reproducedJournal.entries?.at(-1),
            "meta/_journal.json"
        );
    } finally {
        rmSync(temporaryDirectory, { force: true, recursive: true });
    }
}

function writeSchemaOnlyConfig(directory, projectDirectory, out) {
    const configPath = join(directory, "drizzle.config.mjs");
    writeFileSync(
        configPath,
        `export default ${JSON.stringify({
            dialect: "sqlite",
            schema: join(projectDirectory, "src", "db", "index.ts"),
            out: relative(projectDirectory, out),
        })};\n`
    );
    return configPath;
}
