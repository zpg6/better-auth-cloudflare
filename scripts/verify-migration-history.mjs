import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, relative, resolve, sep } from "node:path";

export function validateMigrationChanges(changes) {
    const errors = [];
    let addedMigrations = 0;
    let addedSnapshots = 0;
    const addedIndexes = new Set();

    for (const { status, paths } of changes) {
        for (const path of paths) {
            const filename = basename(path);
            if (filename === "_journal.json") {
                if (status !== "A" && status !== "M") errors.push(`Drizzle journal cannot be ${status}: ${path}`);
                continue;
            }

            const isMigration = filename.endsWith(".sql");
            const isSnapshot = /\d+_snapshot\.json$/.test(filename);
            if (!isMigration && !isSnapshot) continue;

            if (status !== "A") {
                errors.push(`Existing generated migration history is immutable: ${status} ${path}`);
                continue;
            }
            if (isMigration) addedMigrations += 1;
            if (isSnapshot) addedSnapshots += 1;
            addedIndexes.add(filename.slice(0, filename.indexOf("_")));
        }
    }

    if (addedMigrations > 1) errors.push(`A change may add at most one generated migration, found ${addedMigrations}.`);
    if (addedSnapshots > 1) errors.push(`A change may add at most one generated snapshot, found ${addedSnapshots}.`);
    if (addedMigrations !== addedSnapshots) {
        errors.push(
            `Generated migration and snapshot additions must match, found ${addedMigrations} migration(s) and ${addedSnapshots} snapshot(s).`
        );
    } else if (addedIndexes.size > 1) {
        errors.push(`The added migration and snapshot must share one index, found ${[...addedIndexes].join(", ")}.`);
    }
    return errors;
}

export function validateJournalHistory(baseInput, headInput, newMigrationFilename) {
    const errors = [];
    let base;
    let head;
    try {
        base = typeof baseInput === "string" ? JSON.parse(baseInput) : baseInput;
        head = typeof headInput === "string" ? JSON.parse(headInput) : headInput;
    } catch {
        return ["Drizzle journal must contain valid JSON."];
    }
    if (!base || !head || !Array.isArray(base.entries) || !Array.isArray(head.entries)) {
        return ["Drizzle journal must contain an entries array."];
    }

    const { entries: baseEntries, ...baseMetadata } = base;
    const { entries: headEntries, ...headMetadata } = head;
    if (!sameJson(baseMetadata, headMetadata)) errors.push("Drizzle journal metadata is immutable.");

    const additions = newMigrationFilename ? 1 : 0;
    if (headEntries.length !== baseEntries.length + additions) {
        errors.push(`Drizzle journal must append exactly ${additions} entries.`);
    }
    for (let index = 0; index < baseEntries.length; index += 1) {
        if (!sameJson(baseEntries[index], headEntries[index])) {
            errors.push(`Existing Drizzle journal entry ${index} is immutable.`);
        }
    }

    if (newMigrationFilename && headEntries.length > baseEntries.length) {
        const entry = headEntries[baseEntries.length];
        const expectedTag = newMigrationFilename.replace(/\.sql$/, "");
        const priorIndex = baseEntries.length === 0 ? -1 : baseEntries.at(-1)?.idx;
        if (!entry || entry.tag !== expectedTag) errors.push("The appended journal tag must match the new migration.");
        if (!Number.isInteger(priorIndex) || entry?.idx !== priorIndex + 1) {
            errors.push("The appended journal index must follow the existing history.");
        }
        if (!Number.isSafeInteger(entry?.when) || entry.when <= 0 || typeof entry?.breakpoints !== "boolean") {
            errors.push("The appended journal entry is malformed.");
        }
    }

    return errors;
}

function sameJson(left, right) {
    return JSON.stringify(sortJson(left)) === JSON.stringify(sortJson(right));
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

function parseNameStatus(output) {
    return output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => {
            const [status, ...paths] = line.split("\t");
            return { status, paths };
        });
}

function main() {
    const base = process.argv[2];
    const projectDirectory = resolve(process.argv[3] ?? ".");
    if (!base || /^0+$/.test(base)) {
        console.log("No comparison commit is available; skipping migration-history diff check.");
        return;
    }

    const repository = execFileSync("git", ["-C", projectDirectory, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", repository, "cat-file", "-e", `${base}^{commit}`]);
    const projectPath = relative(repository, projectDirectory).split(sep).join("/");
    const migrationPath = projectPath ? `${projectPath}/drizzle` : "drizzle";
    const output = execFileSync(
        "git",
        ["-C", repository, "diff", "--name-status", "--find-renames", base, "--", migrationPath],
        { encoding: "utf8" }
    );
    const changes = parseNameStatus(output);
    const errors = validateMigrationChanges(changes);
    const newMigrations = changes.flatMap(({ status, paths }) =>
        status === "A" ? paths.filter(path => path.endsWith(".sql")).map(path => basename(path)) : []
    );
    const journalPath = `${migrationPath}/meta/_journal.json`;
    const baseJournal = execFileSync("git", ["-C", repository, "show", `${base}:${journalPath}`], {
        encoding: "utf8",
    });
    const headJournal = readFileSync(resolve(repository, journalPath), "utf8");
    errors.push(
        ...validateJournalHistory(baseJournal, headJournal, newMigrations.length === 1 ? newMigrations[0] : undefined)
    );
    if (errors.length > 0) throw new Error(errors.join("\n"));
    console.log(`Verified generated migration history against ${base}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
