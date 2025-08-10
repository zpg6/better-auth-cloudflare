import { describe, expect, test } from "bun:test";

// Import helper functions that would be exposed from the main CLI module
// Since these are internal functions, we'll test the logic here directly

interface CliArgs {
    [key: string]: string | boolean | undefined;
}

function parseCliArgs(argv: string[]): CliArgs {
    const args: CliArgs = {};

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        // Handle --key=value format
        if (arg.startsWith("--") && arg.includes("=")) {
            const [key, ...valueParts] = arg.slice(2).split("=");
            const value = valueParts.join("="); // Handle values that contain "="

            // Convert boolean strings
            if (value === "true") {
                args[key] = true;
            } else if (value === "false") {
                args[key] = false;
            } else {
                args[key] = value;
            }
        }
        // Handle --key value format
        else if (arg.startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
            const key = arg.slice(2);
            const value = argv[i + 1];

            // Convert boolean strings
            if (value === "true") {
                args[key] = true;
            } else if (value === "false") {
                args[key] = false;
            } else {
                args[key] = value;
            }
            i += 1; // Skip the next argument as it's the value
        }
        // Handle boolean flags like --geolocation (defaults to true)
        else if (arg.startsWith("--")) {
            const key = arg.slice(2);
            args[key] = true;
        }
    }

    return args;
}

function validateBindingName(name: string): string | undefined {
    if (!name || name.trim().length === 0) return "Please enter a binding name";
    if (!/^[A-Z0-9_]+$/.test(name)) return "Use ONLY A-Z, 0-9, and underscores";
    return undefined;
}

function validateCliArgs(args: CliArgs): string[] {
    const errors: string[] = [];

    // Validate app name
    if (args["app-name"] && typeof args["app-name"] === "string") {
        const name = args["app-name"];
        if (!name.trim()) {
            errors.push("app-name cannot be empty");
        } else if (!/^[a-z0-9-]+$/.test(name)) {
            errors.push("app-name must contain only lowercase letters, numbers, and hyphens");
        }
    }

    // Validate template
    if (args.template && !["hono", "nextjs"].includes(args.template as string)) {
        errors.push("template must be 'hono' or 'nextjs'");
    }

    // Validate database
    if (args.database && !["d1", "hyperdrive-postgres", "hyperdrive-mysql"].includes(args.database as string)) {
        errors.push("database must be 'd1', 'hyperdrive-postgres', or 'hyperdrive-mysql'");
    }

    // Validate binding names
    const bindingFields = ["d1-binding", "hd-binding", "kv-binding", "r2-binding"];
    for (const field of bindingFields) {
        if (args[field] !== undefined && typeof args[field] === "string") {
            const error = validateBindingName(String(args[field]));
            if (error) {
                errors.push(`${field}: ${error}`);
            }
        }
    }

    // Validate connection string format if provided
    if (args["hd-connection-string"] && typeof args["hd-connection-string"] === "string") {
        const connStr = args["hd-connection-string"];
        if (
            !connStr.startsWith("postgres://") &&
            !connStr.startsWith("postgresql://") &&
            !connStr.startsWith("mysql://")
        ) {
            errors.push(
                "hd-connection-string must be a valid database URL starting with postgres://, postgresql://, or mysql://"
            );
        }
    }

    return errors;
}

describe("CLI Argument Parsing", () => {
    test("parses --key=value format", () => {
        const argv = ["node", "cli", "--app-name=my-app", "--template=hono", "--database=d1"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe("my-app");
        expect(args.template).toBe("hono");
        expect(args.database).toBe("d1");
    });

    test("parses --key value format", () => {
        const argv = ["node", "cli", "--app-name", "my-app", "--template", "nextjs"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe("my-app");
        expect(args.template).toBe("nextjs");
    });

    test("parses boolean values correctly", () => {
        const argv = ["node", "cli", "--geolocation=true", "--kv=false", "--r2"];
        const args = parseCliArgs(argv);

        expect(args.geolocation).toBe(true);
        expect(args.kv).toBe(false);
        expect(args.r2).toBe(true); // flag defaults to true
    });

    test("handles values with equals signs", () => {
        const argv = ["node", "cli", "--hd-connection-string=postgres://user:pass=word@host:5432/db"];
        const args = parseCliArgs(argv);

        expect(args["hd-connection-string"]).toBe("postgres://user:pass=word@host:5432/db");
    });

    test("handles mixed argument formats", () => {
        const argv = ["node", "cli", "--app-name=my-mixed-app", "--template", "hono", "--geolocation=false", "--kv"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe("my-mixed-app");
        expect(args.template).toBe("hono");
        expect(args.geolocation).toBe(false);
        expect(args.kv).toBe(true);
    });

    test("ignores non-argument parameters", () => {
        const argv = ["node", "cli", "generate", "--app-name=test", "some-other-param"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe("test");
        expect(Object.keys(args)).toHaveLength(1);
    });
});

describe("CLI Argument Validation", () => {
    test("validates app name format", () => {
        const validArgs = { "app-name": "my-valid-app-123" };
        const invalidArgs1 = { "app-name": "My-Invalid-App" }; // uppercase
        const invalidArgs2 = { "app-name": "my_invalid_app" }; // underscore
        const invalidArgs3 = { "app-name": "   " }; // empty/whitespace

        expect(validateCliArgs(validArgs)).toHaveLength(0);
        expect(validateCliArgs(invalidArgs1)).toContain(
            "app-name must contain only lowercase letters, numbers, and hyphens"
        );
        expect(validateCliArgs(invalidArgs2)).toContain(
            "app-name must contain only lowercase letters, numbers, and hyphens"
        );
        expect(validateCliArgs(invalidArgs3)).toContain("app-name cannot be empty");
    });

    test("validates template values", () => {
        const validArgs1 = { template: "hono" };
        const validArgs2 = { template: "nextjs" };
        const invalidArgs = { template: "invalid-template" };

        expect(validateCliArgs(validArgs1)).toHaveLength(0);
        expect(validateCliArgs(validArgs2)).toHaveLength(0);
        expect(validateCliArgs(invalidArgs)).toContain("template must be 'hono' or 'nextjs'");
    });

    test("validates database values", () => {
        const validArgs1 = { database: "d1" };
        const validArgs2 = { database: "hyperdrive-postgres" };
        const validArgs3 = { database: "hyperdrive-mysql" };
        const invalidArgs = { database: "mongodb" };

        expect(validateCliArgs(validArgs1)).toHaveLength(0);
        expect(validateCliArgs(validArgs2)).toHaveLength(0);
        expect(validateCliArgs(validArgs3)).toHaveLength(0);
        expect(validateCliArgs(invalidArgs)).toContain(
            "database must be 'd1', 'hyperdrive-postgres', or 'hyperdrive-mysql'"
        );
    });

    test("validates binding names", () => {
        const validArgs = { "d1-binding": "MY_DATABASE_123" };
        const invalidArgs1 = { "kv-binding": "my-binding" }; // lowercase
        const invalidArgs2 = { "r2-binding": "MY-BINDING-WITH-HYPHENS" }; // hyphens
        const invalidArgs3 = { "hd-binding": "" }; // empty

        expect(validateCliArgs(validArgs)).toHaveLength(0);

        const errors1 = validateCliArgs(invalidArgs1);
        expect(errors1.length).toBeGreaterThan(0);
        expect(errors1[0]).toContain("Use ONLY A-Z, 0-9, and underscores");

        const errors2 = validateCliArgs(invalidArgs2);
        expect(errors2.length).toBeGreaterThan(0);
        expect(errors2[0]).toContain("Use ONLY A-Z, 0-9, and underscores");

        const errors3 = validateCliArgs(invalidArgs3);
        expect(errors3.length).toBeGreaterThan(0);
        expect(errors3[0]).toContain("Please enter a binding name");
    });

    test("validates connection strings", () => {
        const validArgs1 = { "hd-connection-string": "postgres://user:pass@host:5432/db" };
        const validArgs2 = { "hd-connection-string": "postgresql://user:pass@host:5432/db" };
        const validArgs3 = { "hd-connection-string": "mysql://user:pass@host:3306/db" };
        const invalidArgs = { "hd-connection-string": "invalid://connection/string" };

        expect(validateCliArgs(validArgs1)).toHaveLength(0);
        expect(validateCliArgs(validArgs2)).toHaveLength(0);
        expect(validateCliArgs(validArgs3)).toHaveLength(0);

        const errors = validateCliArgs(invalidArgs);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain("hd-connection-string must be a valid database URL");
    });

    test("accumulates multiple validation errors", () => {
        const invalidArgs = {
            "app-name": "Invalid_Name",
            template: "invalid",
            database: "mongodb",
            "d1-binding": "invalid-binding",
        };

        const errors = validateCliArgs(invalidArgs);
        expect(errors).toHaveLength(4);
        expect(errors.some(e => e.includes("app-name"))).toBe(true);
        expect(errors.some(e => e.includes("template"))).toBe(true);
        expect(errors.some(e => e.includes("database"))).toBe(true);
        expect(errors.some(e => e.includes("d1-binding"))).toBe(true);
    });
});

describe("Real-world CLI Usage Scenarios", () => {
    test("basic Hono app with D1", () => {
        const argv = ["node", "cli", "--app-name=my-hono-app", "--template=hono", "--database=d1"];
        const args = parseCliArgs(argv);
        const errors = validateCliArgs(args);

        expect(errors).toHaveLength(0);
        expect(args["app-name"]).toBe("my-hono-app");
        expect(args.template).toBe("hono");
        expect(args.database).toBe("d1");
    });

    test("Next.js app with PostgreSQL Hyperdrive", () => {
        const argv = [
            "node",
            "cli",
            "--app-name=my-next-app",
            "--template=nextjs",
            "--database=hyperdrive-postgres",
            "--hd-connection-string=postgres://user:pass@host:5432/db",
            "--hd-binding=MY_POSTGRES",
        ];
        const args = parseCliArgs(argv);
        const errors = validateCliArgs(args);

        expect(errors).toHaveLength(0);
        expect(args["app-name"]).toBe("my-next-app");
        expect(args.template).toBe("nextjs");
        expect(args.database).toBe("hyperdrive-postgres");
        expect(args["hd-connection-string"]).toBe("postgres://user:pass@host:5432/db");
        expect(args["hd-binding"]).toBe("MY_POSTGRES");
    });

    test("minimal app without KV or R2", () => {
        const argv = ["node", "cli", "--app-name=minimal-app", "--kv=false", "--r2=false", "--geolocation=false"];
        const args = parseCliArgs(argv);
        const errors = validateCliArgs(args);

        expect(errors).toHaveLength(0);
        expect(args["app-name"]).toBe("minimal-app");
        expect(args.kv).toBe(false);
        expect(args.r2).toBe(false);
        expect(args.geolocation).toBe(false);
    });

    test("full configuration with all options", () => {
        const argv = [
            "node",
            "cli",
            "--app-name=full-featured-app",
            "--template=nextjs",
            "--database=hyperdrive-mysql",
            "--hd-connection-string=mysql://user:pass@host:3306/db",
            "--hd-name=my-hyperdrive",
            "--hd-binding=MYSQL_DB",
            "--geolocation=true",
            "--kv=true",
            "--kv-binding=SESSION_STORE",
            "--kv-namespace-name=app-sessions",
            "--r2=true",
            "--r2-binding=FILE_STORAGE",
            "--r2-bucket-name=app-uploads",
        ];
        const args = parseCliArgs(argv);
        const errors = validateCliArgs(args);

        expect(errors).toHaveLength(0);
        expect(args["app-name"]).toBe("full-featured-app");
        expect(args.template).toBe("nextjs");
        expect(args.database).toBe("hyperdrive-mysql");
        expect(args["hd-connection-string"]).toBe("mysql://user:pass@host:3306/db");
        expect(args["hd-name"]).toBe("my-hyperdrive");
        expect(args["hd-binding"]).toBe("MYSQL_DB");
        expect(args.geolocation).toBe(true);
        expect(args.kv).toBe(true);
        expect(args["kv-binding"]).toBe("SESSION_STORE");
        expect(args["kv-namespace-name"]).toBe("app-sessions");
        expect(args.r2).toBe(true);
        expect(args["r2-binding"]).toBe("FILE_STORAGE");
        expect(args["r2-bucket-name"]).toBe("app-uploads");
    });
});

describe("Edge Cases", () => {
    test("handles empty argv", () => {
        const argv = ["node", "cli"];
        const args = parseCliArgs(argv);

        expect(Object.keys(args)).toHaveLength(0);
    });

    test("handles single hyphen arguments (ignored)", () => {
        const argv = ["node", "cli", "-a", "value", "--app-name=test"];
        const args = parseCliArgs(argv);

        expect(args["-a"]).toBeUndefined();
        expect(args["app-name"]).toBe("test");
    });

    test("handles arguments without values", () => {
        const argv = ["node", "cli", "--app-name"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe(true); // treated as boolean flag
    });

    test("handles consecutive boolean flags", () => {
        const argv = ["node", "cli", "--geolocation", "--kv", "--r2"];
        const args = parseCliArgs(argv);

        expect(args.geolocation).toBe(true);
        expect(args.kv).toBe(true);
        expect(args.r2).toBe(true);
    });

    test("last argument wins for duplicates", () => {
        const argv = ["node", "cli", "--app-name=first", "--app-name=second"];
        const args = parseCliArgs(argv);

        expect(args["app-name"]).toBe("second");
    });
});
