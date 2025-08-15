import { describe, test, expect } from "bun:test";
import { quickValidateProject } from "../src/lib/project-validator";
import { existsSync } from "fs";
import { join } from "path";

describe("Project Validation Integration", () => {
    test("can validate example Hono project", async () => {
        const honoExamplePath = join(process.cwd(), "../examples/hono");

        // Only run this test if the example project exists
        if (!existsSync(honoExamplePath)) {
            console.log("Skipping Hono example test - project not found");
            return;
        }

        const result = await quickValidateProject(honoExamplePath);

        // The example project should either:
        // 1. Pass validation if dependencies are installed
        // 2. Fail with dependency-related errors if not installed
        // Both are valid outcomes - we just want to ensure the validator runs
        expect(result).toBeDefined();
        expect(typeof result.isValid).toBe("boolean");
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);

        // If it fails, the errors should be meaningful
        if (!result.isValid) {
            expect(result.errors.length).toBeGreaterThan(0);
            // Should not be a validator crash, but actual TypeScript/dependency issues
            expect(
                result.errors.some(
                    error =>
                        error.includes("Cannot find module") ||
                        error.includes("error TS") ||
                        error.includes("compilation failed") ||
                        error.includes("not found")
                )
            ).toBe(true);
        }
    });

    test("can validate example Next.js project", async () => {
        const nextExamplePath = join(process.cwd(), "../examples/opennextjs");

        // Only run this test if the example project exists
        if (!existsSync(nextExamplePath)) {
            console.log("Skipping Next.js example test - project not found");
            return;
        }

        const result = await quickValidateProject(nextExamplePath);

        // Same expectations as above
        expect(result).toBeDefined();
        expect(typeof result.isValid).toBe("boolean");
        expect(Array.isArray(result.errors)).toBe(true);
        expect(Array.isArray(result.warnings)).toBe(true);

        if (!result.isValid) {
            expect(result.errors.length).toBeGreaterThan(0);
            expect(
                result.errors.some(
                    error =>
                        error.includes("Cannot find module") ||
                        error.includes("error TS") ||
                        error.includes("compilation failed") ||
                        error.includes("not found")
                )
            ).toBe(true);
        }
    });

    test("handles invalid project gracefully", async () => {
        const invalidPath = "/non/existent/path";

        const result = await quickValidateProject(invalidPath);

        expect(result.isValid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain("package.json");
    });
});
