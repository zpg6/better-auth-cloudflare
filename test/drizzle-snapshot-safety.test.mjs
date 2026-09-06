import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    assertDrizzleJournalEntriesMatch,
    assertDrizzleSnapshotsMatch,
    normalizeDrizzleSnapshot,
    normalizeGeneratedSql,
} from "../scripts/drizzle-snapshot-safety.mjs";

describe("Drizzle snapshot safety", () => {
    const snapshot = {
        id: "generated-a",
        prevId: "previous",
        tables: {
            users: {
                columns: {
                    email: { name: "email", notNull: true, primaryKey: false, type: "text" },
                },
            },
        },
    };

    it("ignores only the generated top-level id and object key order", () => {
        const reproduced = {
            tables: snapshot.tables,
            prevId: snapshot.prevId,
            id: "generated-b",
        };
        assert.equal(normalizeDrizzleSnapshot(snapshot), normalizeDrizzleSnapshot(reproduced));
    });

    it("rejects schema mutations", () => {
        const mutated = structuredClone(snapshot);
        mutated.tables.users.columns.email.notNull = false;
        assert.throws(
            () => assertDrizzleSnapshotsMatch(mutated, snapshot, "0002_snapshot.json"),
            /does not match Drizzle Kit output/
        );
    });

    it("rejects migration-chain mutations", () => {
        assert.throws(
            () => assertDrizzleSnapshotsMatch({ ...snapshot, prevId: "wrong" }, snapshot, "0002_snapshot.json"),
            /does not match Drizzle Kit output/
        );
    });

    it("normalizes terminal newlines without changing SQL bytes", () => {
        assert.equal(normalizeGeneratedSql("SELECT 'a  b';\n"), "SELECT 'a  b';");
        assert.notEqual(normalizeGeneratedSql("SELECT 'a  b';\n"), normalizeGeneratedSql("SELECT 'a b';\n"));
        assert.notEqual(normalizeGeneratedSql("SELECT 'a\r\nb';\n"), normalizeGeneratedSql("SELECT 'a\nb';\n"));
    });

    it("compares the deterministic journal entry shape", () => {
        const committed = { idx: 2, version: "6", when: 1, tag: "0002_committed", breakpoints: true };
        const reproduced = { ...committed, when: 2, tag: "0002_reproduced" };
        assert.doesNotThrow(() => assertDrizzleJournalEntriesMatch(committed, reproduced, "meta/_journal.json"));
        for (const mutation of [
            { ...committed, version: "999" },
            { ...committed, breakpoints: false },
            { idx: 2, when: 1, tag: "0002_committed", breakpoints: true },
            { ...committed, extra: true },
        ]) {
            assert.throws(
                () => assertDrizzleJournalEntriesMatch(mutation, reproduced, "meta/_journal.json"),
                /does not match Drizzle Kit output/
            );
        }
    });
});
