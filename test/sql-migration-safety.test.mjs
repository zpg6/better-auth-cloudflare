import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rejectUnsafeDml } from "../scripts/sql-migration-safety.mjs";

describe("migration SQL safety", () => {
    it("accepts a generated Drizzle table-rebuild copy", () => {
        assert.doesNotThrow(() =>
            rejectUnsafeDml(
                "0001_generated.sql",
                'INSERT INTO `__new_users`("id", "name") SELECT "id", "name" FROM `users`;'
            )
        );
    });

    for (const [name, sql] of [
        ["delete after DDL", "CREATE TABLE temp (id text); DELETE FROM users;"],
        ["update after DDL", "ALTER TABLE users ADD name text; UPDATE users SET name = 'x';"],
        ["insert after DDL", "CREATE TABLE temp (id text); INSERT INTO temp VALUES ('x');"],
        ["insert with a block comment", "INSERT/* generated? */INTO audit VALUES ('x');"],
        ["insert with a line comment", "INSERT-- generated?\nINTO audit VALUES ('x');"],
        ["insert or ignore", "INSERT OR IGNORE INTO audit VALUES ('x');"],
        ["insert or replace", "INSERT OR REPLACE INTO audit VALUES ('x');"],
        ["replace after DDL", "CREATE TABLE temp (id text); REPLACE INTO temp VALUES ('x');"],
        [
            "second insert after a table copy",
            'INSERT INTO `__new_users`("id") SELECT "id" FROM `users`; INSERT INTO audit VALUES (1);',
        ],
    ]) {
        it(`rejects ${name}`, () => {
            assert.throws(() => rejectUnsafeDml("tampered.sql", sql), /not a single Drizzle table-rebuild copy/);
        });
    }

    it("does not classify SQL keywords inside quoted values as DML", () => {
        assert.doesNotThrow(() =>
            rejectUnsafeDml(
                "quoted.sql",
                "CREATE TABLE notes (template text DEFAULT 'DELETE FROM users', label text DEFAULT 'INSERT INTO');"
            )
        );
    });

    it("does not split breakpoint text inside quotes or comments", () => {
        assert.doesNotThrow(() =>
            rejectUnsafeDml(
                "quoted-breakpoint.sql",
                "CREATE TABLE notes (template text DEFAULT 'prefix --> statement-breakpoint DELETE FROM users');\n-- --> statement-breakpoint DELETE FROM users"
            )
        );
    });
});
