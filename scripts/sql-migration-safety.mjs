export function rejectUnsafeDml(migration, sql) {
    for (const statement of splitAtBreakpoints(sql)) {
        const { clean, classification } = sanitizeSql(statement);
        const trimmed = clean.trim();
        if (
            !/\b(?:DELETE\s+FROM|UPDATE\s+[^;]+\s+SET|INSERT(?:\s+OR\s+(?:ROLLBACK|ABORT|FAIL|IGNORE|REPLACE))?\s+INTO|REPLACE\s+INTO)\b/i.test(
                classification
            )
        ) {
            continue;
        }

        const drizzleTableCopy =
            /^INSERT\s+INTO\s+(?:`__new_[^`]+`|"__new_[^"]+")\s*\([^;]*\)\s+SELECT\s+[^;]+\s+FROM\s+(?:`[^`]+`|"[^"]+")\s*;?\s*$/is;
        if (!drizzleTableCopy.test(trimmed)) {
            throw new Error(`${migration} contains data-changing SQL that is not a single Drizzle table-rebuild copy.`);
        }
    }
}

function splitAtBreakpoints(sql) {
    const statements = [];
    let current = "";
    let quote = null;
    let comment = null;

    for (let index = 0; index < sql.length; index += 1) {
        const character = sql[index];
        const next = sql[index + 1];

        if (comment === "line") {
            current += character;
            if (character === "\n" || character === "\r") comment = null;
            continue;
        }
        if (comment === "block") {
            current += character;
            if (character === "*" && next === "/") {
                current += next;
                index += 1;
                comment = null;
            }
            continue;
        }
        if (quote !== null) {
            current += character;
            if (quote === "[") {
                if (character === "]") quote = null;
            } else if (character === quote) {
                if (next === quote) {
                    current += next;
                    index += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }

        const breakpoint = sql.startsWith("-->", index) ? /^-->\s*statement-breakpoint/.exec(sql.slice(index)) : null;
        if (breakpoint) {
            statements.push(current);
            current = "";
            index += breakpoint[0].length - 1;
            continue;
        }
        if (character === "'" || character === '"' || character === "`" || character === "[") {
            quote = character;
            current += character;
            continue;
        }
        if (character === "-" && next === "-") {
            comment = "line";
            current += character;
            continue;
        }
        if (character === "/" && next === "*") {
            comment = "block";
            current += character;
            continue;
        }
        current += character;
    }

    statements.push(current);
    return statements;
}

function sanitizeSql(sql) {
    let clean = "";
    let classification = "";
    let quote = null;

    for (let index = 0; index < sql.length; index += 1) {
        const character = sql[index];
        const next = sql[index + 1];

        if (quote !== null) {
            clean += character;
            classification += " ";
            if (quote === "[") {
                if (character === "]") quote = null;
            } else if (character === quote) {
                if (next === quote) {
                    clean += next;
                    classification += " ";
                    index += 1;
                } else {
                    quote = null;
                }
            }
            continue;
        }

        if (character === "'" || character === '"' || character === "`") {
            quote = character;
            clean += character;
            classification += " ";
            continue;
        }
        if (character === "[") {
            quote = character;
            clean += character;
            classification += " ";
            continue;
        }
        if (character === "-" && next === "-") {
            index += 2;
            while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
            clean += "\n";
            classification += "\n";
            continue;
        }
        if (character === "/" && next === "*") {
            index += 2;
            while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
            if (index < sql.length) index += 1;
            clean += " ";
            classification += " ";
            continue;
        }

        clean += character;
        classification += character;
    }

    return { clean, classification };
}
