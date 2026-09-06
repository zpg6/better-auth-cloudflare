import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateJournalHistory, validateMigrationChanges } from "../scripts/verify-migration-history.mjs";

describe("migration history safety", () => {
    it("accepts one generated migration and matching snapshot", () => {
        assert.deepEqual(
            validateMigrationChanges([
                { status: "A", paths: ["examples/hono/drizzle/0002_generated.sql"] },
                { status: "A", paths: ["examples/hono/drizzle/meta/0002_snapshot.json"] },
                { status: "M", paths: ["examples/hono/drizzle/meta/_journal.json"] },
            ]),
            []
        );
    });

    it("rejects edits and renames of existing generated history", () => {
        const errors = validateMigrationChanges([
            { status: "M", paths: ["examples/hono/drizzle/0001_existing.sql"] },
            {
                status: "R100",
                paths: [
                    "examples/hono/drizzle/meta/0001_snapshot.json",
                    "examples/hono/drizzle/meta/0001_renamed_snapshot.json",
                ],
            },
        ]);
        assert.equal(errors.filter(error => error.includes("immutable")).length, 2);
    });

    it("rejects multiple or unmatched generated additions", () => {
        const errors = validateMigrationChanges([
            { status: "A", paths: ["examples/hono/drizzle/0002_a.sql"] },
            { status: "A", paths: ["examples/hono/drizzle/0003_b.sql"] },
            { status: "A", paths: ["examples/hono/drizzle/meta/0002_snapshot.json"] },
        ]);
        assert.ok(errors.some(error => error.includes("at most one generated migration")));
        assert.ok(errors.some(error => error.includes("additions must match")));
    });

    it("accepts one generated journal entry", () => {
        const base = {
            version: "7",
            dialect: "sqlite",
            entries: [{ idx: 0, when: 1, tag: "0000_initial", breakpoints: true }],
        };
        const head = {
            ...base,
            entries: [...base.entries, { idx: 1, when: 2, tag: "0001_generated", breakpoints: true }],
        };
        assert.deepEqual(validateJournalHistory(base, head, "0001_generated.sql"), []);
    });

    it("rejects edits to journal metadata and historical entries", () => {
        const base = {
            version: "7",
            dialect: "sqlite",
            entries: [{ idx: 0, when: 1, tag: "0000_initial", breakpoints: true }],
        };
        const head = {
            version: "8",
            dialect: "sqlite",
            entries: [{ idx: 0, when: 1, tag: "0000_rewritten", breakpoints: true }],
        };
        const errors = validateJournalHistory(base, head);
        assert.ok(errors.some(error => error.includes("metadata is immutable")));
        assert.ok(errors.some(error => error.includes("entry 0 is immutable")));
    });

    it("rejects malformed appended journal entries", () => {
        const base = { version: "7", dialect: "sqlite", entries: [] };
        const head = {
            ...base,
            entries: [{ idx: 4, when: 0, tag: "wrong", breakpoints: "yes" }],
        };
        const errors = validateJournalHistory(base, head, "0000_generated.sql");
        assert.ok(errors.some(error => error.includes("tag")));
        assert.ok(errors.some(error => error.includes("index")));
        assert.ok(errors.some(error => error.includes("malformed")));
    });
});
