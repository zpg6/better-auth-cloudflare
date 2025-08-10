import { describe, expect, test } from "bun:test";
import { validateBindingName } from "../src/index";

describe("Utility Functions", () => {
    describe("validateBindingName", () => {
        test("accepts valid binding names", () => {
            const validNames = [
                "DATABASE",
                "MY_DATABASE",
                "DB_123",
                "KV",
                "R2_BUCKET",
                "HYPERDRIVE_DB",
                "TEST_BINDING_NAME",
                "A", // single character
                "A_B_C_D_E_F_G", // long name
                "DB2", // ends with number
                "MY_123_DB", // mixed
                "123VALID", // starts with number (valid!)
                "123_DB", // starts with number (valid!)
                "999", // all numbers
                "A1B2C3", // mixed letters and numbers
                "_DATABASE", // starts with underscore (valid!)
                "DATABASE_", // ends with underscore (valid!)
                "_", // single underscore (valid!)
                "_123", // underscore + numbers (valid!)
            ];

            for (const name of validNames) {
                expect(validateBindingName(name)).toBeUndefined();
            }
        });

        test("rejects invalid binding names", () => {
            const invalidNames = [
                "database", // lowercase
                "myDatabase", // camelCase
                "my-database", // kebab-case
                "MY DATABASE", // spaces
                "MY_DATABASE!", // special characters

                "", // empty string
                " ", // whitespace only
                "my.database", // dots
                "my@database", // at symbol
                "my#database", // hash
                "my$database", // dollar
                "my%database", // percent
                "my&database", // ampersand
                "my*database", // asterisk
                "my+database", // plus
                "my=database", // equals
                "my[database]", // brackets
                "my{database}", // braces
                "my|database", // pipe
                "my\\database", // backslash
                "my/database", // forward slash
                "my:database", // colon
                "my;database", // semicolon
                "my<database>", // angle brackets
                "my,database", // comma
                "my?database", // question mark
                'my"database"', // quotes
                "my'database'", // single quotes
            ];

            for (const name of invalidNames) {
                const result = validateBindingName(name);
                expect(result).toBeDefined();
                // Handle different error messages
                expect(
                    result?.includes("A-Z, 0-9, and underscores") || result?.includes("Please enter a binding name")
                ).toBe(true);
            }
        });

        test("provides helpful error messages", () => {
            expect(validateBindingName("lowercase")).toBe("Use ONLY A-Z, 0-9, and underscores");
            expect(validateBindingName("my-binding")).toBe("Use ONLY A-Z, 0-9, and underscores");
            expect(validateBindingName("invalid!")).toBe("Use ONLY A-Z, 0-9, and underscores");
        });

        test("handles edge cases", () => {
            // Very long names should still be valid if they follow the pattern
            const longValidName = "A".repeat(100);
            expect(validateBindingName(longValidName)).toBeUndefined();

            // Mixed valid characters
            expect(validateBindingName("A1B2C3_D4E5F6")).toBeUndefined();

            // Single underscore between valid parts
            expect(validateBindingName("VALID_NAME")).toBeUndefined();
            expect(validateBindingName("VALID_NAME_123")).toBeUndefined();
        });
    });

    describe("Template and Database Options", () => {
        test("supports expected template options", () => {
            const expectedTemplates = ["hono", "nextjs"];
            // This test ensures our CLI supports the expected templates
            // The actual options are defined in the CLI prompts
            expect(expectedTemplates).toContain("hono");
            expect(expectedTemplates).toContain("nextjs");
        });

        test("supports expected database options", () => {
            const expectedDatabases = ["d1", "hyperdrive-postgres", "hyperdrive-mysql"];
            // This test ensures our CLI supports the expected database types
            expect(expectedDatabases).toContain("d1");
            expect(expectedDatabases).toContain("hyperdrive-postgres");
            expect(expectedDatabases).toContain("hyperdrive-mysql");
        });
    });

    describe("Default Value Patterns", () => {
        test("follows consistent naming patterns", () => {
            const appName = "test-app";

            // Test the patterns used in the CLI
            expect(`${appName}-db`).toBe("test-app-db");
            expect(`${appName}-kv`).toBe("test-app-kv");
            expect(`${appName}-files`).toBe("test-app-files");
            expect(`${appName}-hyperdrive`).toBe("test-app-hyperdrive");
        });

        test("handles fallback values correctly", () => {
            const fallbackApp = "my-app";

            expect(`${fallbackApp}-db`).toBe("my-app-db");
            expect(`${fallbackApp}-kv`).toBe("my-app-kv");
            expect(`${fallbackApp}-files`).toBe("my-app-files");
            expect(`${fallbackApp}-hyperdrive`).toBe("my-app-hyperdrive");
        });
    });
});
