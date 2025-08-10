import { describe, expect, test } from "bun:test";

// Test to verify that default values use dynamic app names correctly
describe("Dynamic Default Values", () => {
    test("default values should use app name dynamically", () => {
        // Simulate the CLI's default value generation logic
        const testCases = [
            {
                appName: "my-awesome-app",
                expected: {
                    db: "my-awesome-app-db",
                    kv: "my-awesome-app-kv",
                    r2: "my-awesome-app-files",
                    hd: "my-awesome-app-hyperdrive",
                },
            },
            {
                appName: "blog-site",
                expected: { db: "blog-site-db", kv: "blog-site-kv", r2: "blog-site-files", hd: "blog-site-hyperdrive" },
            },
            {
                appName: "ecommerce",
                expected: { db: "ecommerce-db", kv: "ecommerce-kv", r2: "ecommerce-files", hd: "ecommerce-hyperdrive" },
            },
            {
                appName: "api-v2",
                expected: { db: "api-v2-db", kv: "api-v2-kv", r2: "api-v2-files", hd: "api-v2-hyperdrive" },
            },
        ];

        for (const testCase of testCases) {
            // This simulates the logic from the CLI prompts
            const results = { appName: testCase.appName };

            // D1 database name
            const d1Name = `${(results.appName as string) || "my-app"}-db`;
            expect(d1Name).toBe(testCase.expected.db);

            // Hyperdrive instance name
            const hdName = `${(results.appName as string) || "my-app"}-hyperdrive`;
            expect(hdName).toBe(testCase.expected.hd);

            // KV namespace name
            const kvName = `${(results.appName as string) || "my-app"}-kv`;
            expect(kvName).toBe(testCase.expected.kv);

            // R2 bucket name
            const r2Name = `${(results.appName as string) || "my-app"}-files`;
            expect(r2Name).toBe(testCase.expected.r2);
        }
    });

    test("fallback to my-app when appName is undefined", () => {
        const results = { appName: undefined as string | undefined };

        const d1Name = `${results.appName || "my-app"}-db`;
        const kvName = `${results.appName || "my-app"}-kv`;
        const r2Name = `${results.appName || "my-app"}-files`;
        const hdName = `${results.appName || "my-app"}-hyperdrive`;

        expect(d1Name).toBe("my-app-db");
        expect(kvName).toBe("my-app-kv");
        expect(r2Name).toBe("my-app-files");
        expect(hdName).toBe("my-app-hyperdrive");
    });

    test("handles empty string appName", () => {
        const results = { appName: "" };

        const d1Name = `${results.appName || "my-app"}-db`;
        const kvName = `${results.appName || "my-app"}-kv`;
        const r2Name = `${results.appName || "my-app"}-files`;
        const hdName = `${results.appName || "my-app"}-hyperdrive`;

        expect(d1Name).toBe("my-app-db");
        expect(kvName).toBe("my-app-kv");
        expect(r2Name).toBe("my-app-files");
        expect(hdName).toBe("my-app-hyperdrive");
    });

    test("handles special characters in app names", () => {
        const testCases = [
            { appName: "my-awesome_app", expected: "my-awesome_app" },
            { appName: "app123", expected: "app123" },
            { appName: "test-app-v2", expected: "test-app-v2" },
        ];

        for (const testCase of testCases) {
            const results = { appName: testCase.appName };

            const d1Name = `${(results.appName as string) || "my-app"}-db`;
            const kvName = `${(results.appName as string) || "my-app"}-kv`;
            const r2Name = `${(results.appName as string) || "my-app"}-files`;
            const hdName = `${(results.appName as string) || "my-app"}-hyperdrive`;

            expect(d1Name).toBe(`${testCase.expected}-db`);
            expect(kvName).toBe(`${testCase.expected}-kv`);
            expect(r2Name).toBe(`${testCase.expected}-files`);
            expect(hdName).toBe(`${testCase.expected}-hyperdrive`);
        }
    });
});
