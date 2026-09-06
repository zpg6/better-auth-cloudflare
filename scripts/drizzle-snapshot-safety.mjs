export function normalizeDrizzleSnapshot(snapshot) {
    const parsed = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Drizzle snapshot must be a JSON object.");
    }
    const { id: _generatedId, ...stableSnapshot } = parsed;
    return JSON.stringify(sortJson(stableSnapshot));
}

export function assertDrizzleSnapshotsMatch(committed, reproduced, filename) {
    if (normalizeDrizzleSnapshot(committed) !== normalizeDrizzleSnapshot(reproduced)) {
        throw new Error(
            `The latest snapshot does not match Drizzle Kit output. Regenerate ${filename} instead of editing generated migration state by hand.`
        );
    }
}

export function normalizeGeneratedSql(sql) {
    return sql.replaceAll(/\n+$/g, "");
}

export function assertDrizzleJournalEntriesMatch(committed, reproduced, filename) {
    const committedEntry = parseObject(committed, "Committed Drizzle journal entry");
    const reproducedEntry = parseObject(reproduced, "Reproduced Drizzle journal entry");
    const { tag: _committedTag, when: _committedWhen, ...committedShape } = committedEntry;
    const { tag: _reproducedTag, when: _reproducedWhen, ...reproducedShape } = reproducedEntry;
    if (JSON.stringify(sortJson(committedShape)) !== JSON.stringify(sortJson(reproducedShape))) {
        throw new Error(
            `The latest journal entry does not match Drizzle Kit output. Regenerate ${filename} instead of editing generated migration state by hand.`
        );
    }
}

function sortJson(value) {
    if (Array.isArray(value)) return value.map(sortJson);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map(key => [key, sortJson(value[key])])
    );
}

function parseObject(value, label) {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be an object.`);
    return parsed;
}
