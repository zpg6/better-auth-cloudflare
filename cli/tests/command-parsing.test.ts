import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";

// Mock command output parsing functions that would be used in the CLI
function parseWranglerD1Output(output: string): { id: string; name: string } | null {
    // Parse: ✅ Successfully created DB 'my-db'! New database ID: abc123
    const match = output.match(/Successfully created DB '([^']+)'.*?ID:\s*([a-zA-Z0-9-]+)/is);
    if (match) {
        return { name: match[1], id: match[2] };
    }
    return null;
}

function parseWranglerKvOutput(output: string): { id: string; title?: string } | null {
    // Parse: 🌀 Creating namespace with title "my-app-sessions"
    // ✅ Success! Add the following to your configuration file:
    // id = "abc123"
    const titleMatch = output.match(/Creating namespace with title "([^"]+)"/);
    const idMatch = output.match(/id\s*=\s*"([^"]+)"/);

    if (idMatch) {
        return {
            id: idMatch[1],
            title: titleMatch ? titleMatch[1] : undefined,
        };
    }
    return null;
}

function parseWranglerR2Output(output: string): { bucketName: string } | null {
    // Parse: ✅ Successfully created R2 bucket 'my-bucket'!
    const match = output.match(/Successfully created R2 bucket '([^']+)'/i);
    if (match) {
        return { bucketName: match[1] };
    }
    return null;
}

function parseWranglerHyperdriveOutput(output: string): { id: string; name: string } | null {
    // Parse: ✅ Successfully created Hyperdrive config 'my-hyperdrive'!
    // ID: def456-ghi789-jkl012
    const nameMatch = output.match(/Successfully created Hyperdrive config '([^']+)'/i);
    const idMatch = output.match(/ID:\s*([a-zA-Z0-9-]+)/is);

    if (nameMatch && idMatch) {
        return { name: nameMatch[1], id: idMatch[1] };
    }
    return null;
}

function validateProjectName(name: string): string | undefined {
    if (!name || name.trim().length === 0) {
        return "Project name is required";
    }
    if (name.length > 50) {
        return "Project name must be 50 characters or less";
    }
    if (!/^[a-z0-9-]+$/.test(name)) {
        return "Use only lowercase letters, numbers, and hyphens";
    }
    if (name.startsWith("-") || name.endsWith("-")) {
        return "Cannot start or end with hyphen";
    }
    return undefined;
}

function validateDatabaseUrl(url: string, type: "postgres" | "mysql"): string | undefined {
    if (!url || url.trim().length === 0) {
        return "Database URL is required";
    }

    if (type === "postgres") {
        if (!url.startsWith("postgres://") && !url.startsWith("postgresql://")) {
            return "PostgreSQL URL must start with postgres:// or postgresql://";
        }
    } else if (type === "mysql") {
        if (!url.startsWith("mysql://")) {
            return "MySQL URL must start with mysql://";
        }
    }

    // Basic URL validation
    try {
        new URL(url);
    } catch {
        return "Invalid database URL format";
    }

    return undefined;
}

describe("Command output parsing", () => {
    test("parses D1 database creation output", () => {
        const output = `🌀 Creating D1 database 'my-test-db'...
✅ Successfully created DB 'my-test-db'! New database ID: 12345678-abcd-efgh-ijkl-mnopqrstuvwx`;

        const result = parseWranglerD1Output(output);
        expect(result).toEqual({
            name: "my-test-db",
            id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
        });
    });

    test("parses KV namespace creation output", () => {
        const output = `🌀 Creating namespace with title "my-app-sessions"
✅ Success! Add the following to your configuration file:
id = "abc123def456ghi789jkl012mno345pqr678"`;

        const result = parseWranglerKvOutput(output);
        expect(result).toEqual({
            id: "abc123def456ghi789jkl012mno345pqr678",
            title: "my-app-sessions",
        });
    });

    test("parses R2 bucket creation output", () => {
        const output = `🌀 Creating R2 bucket 'my-user-files'...
✅ Successfully created R2 bucket 'my-user-files'!`;

        const result = parseWranglerR2Output(output);
        expect(result).toEqual({
            bucketName: "my-user-files",
        });
    });

    test("parses Hyperdrive creation output", () => {
        const output = `🌀 Creating Hyperdrive config 'my-postgres-db'...
✅ Successfully created Hyperdrive config 'my-postgres-db'!
ID: def456-ghi789-jkl012-mno345-pqr678-stu901`;

        const result = parseWranglerHyperdriveOutput(output);
        expect(result).toEqual({
            name: "my-postgres-db",
            id: "def456-ghi789-jkl012-mno345-pqr678-stu901",
        });
    });

    test("returns null for malformed D1 output", () => {
        const output = "Some error occurred during database creation";
        expect(parseWranglerD1Output(output)).toBeNull();
    });

    test("returns null for malformed KV output", () => {
        const output = "Failed to create namespace";
        expect(parseWranglerKvOutput(output)).toBeNull();
    });
});

describe("Input validation", () => {
    test("validates project names", () => {
        expect(validateProjectName("my-app")).toBeUndefined();
        expect(validateProjectName("my-app-123")).toBeUndefined();
        expect(validateProjectName("simple")).toBeUndefined();

        expect(validateProjectName("")).toBeTruthy();
        expect(validateProjectName("My-App")).toBeTruthy(); // uppercase
        expect(validateProjectName("my_app")).toBeTruthy(); // underscore
        expect(validateProjectName("-my-app")).toBeTruthy(); // starts with hyphen
        expect(validateProjectName("my-app-")).toBeTruthy(); // ends with hyphen
        expect(validateProjectName("a".repeat(51))).toBeTruthy(); // too long
    });

    test("validates PostgreSQL URLs", () => {
        expect(validateDatabaseUrl("postgres://user:pass@host:5432/db", "postgres")).toBeUndefined();
        expect(validateDatabaseUrl("postgresql://user:pass@host:5432/db", "postgres")).toBeUndefined();

        expect(validateDatabaseUrl("", "postgres")).toBeTruthy();
        expect(validateDatabaseUrl("mysql://user:pass@host:3306/db", "postgres")).toBeTruthy();
        expect(validateDatabaseUrl("not-a-url", "postgres")).toBeTruthy();
    });

    test("validates MySQL URLs", () => {
        expect(validateDatabaseUrl("mysql://user:pass@host:3306/db", "mysql")).toBeUndefined();

        expect(validateDatabaseUrl("", "mysql")).toBeTruthy();
        expect(validateDatabaseUrl("postgres://user:pass@host:5432/db", "mysql")).toBeTruthy();
        expect(validateDatabaseUrl("invalid-url", "mysql")).toBeTruthy();
    });
});

describe("Command availability", () => {
    function commandAvailable(command: string): boolean {
        try {
            const result = spawnSync(command, ["--version"], { stdio: "pipe" });
            return (result.status ?? 1) === 0;
        } catch {
            return false;
        }
    }

    test("detects available commands", () => {
        // npm should be available in most environments
        expect(commandAvailable("npm")).toBe(true);
        // A non-existent command should return false
        expect(commandAvailable("definitely-not-a-real-command-12345")).toBe(false);
    });

    test("handles wrangler availability check", () => {
        // This test checks the logic without requiring wrangler to be installed
        const wranglerAvailable = commandAvailable("wrangler");
        expect(typeof wranglerAvailable).toBe("boolean");
        // The result can be true or false depending on the environment
        // but it should always be a boolean
    });
});
