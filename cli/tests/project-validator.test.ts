import { describe, test, expect } from "bun:test";
import { quickValidateProject, validateProject } from "../src/lib/project-validator";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Project Validator", () => {
    describe("Basic Validation", () => {
        test("validates project with valid TypeScript", async () => {
            const tempDir = join(tmpdir(), `test-project-${Date.now()}`);

            try {
                // Create a basic valid TypeScript project
                mkdirSync(tempDir, { recursive: true });

                // Create package.json
                writeFileSync(
                    join(tempDir, "package.json"),
                    JSON.stringify(
                        {
                            name: "test-project",
                            type: "module",
                        },
                        null,
                        2
                    )
                );

                // Create tsconfig.json
                writeFileSync(
                    join(tempDir, "tsconfig.json"),
                    JSON.stringify(
                        {
                            compilerOptions: {
                                target: "ES2022",
                                module: "ESNext",
                                moduleResolution: "bundler",
                                noEmit: true,
                                strict: true,
                                skipLibCheck: true,
                            },
                        },
                        null,
                        2
                    )
                );

                // Create valid TypeScript file
                writeFileSync(
                    join(tempDir, "index.ts"),
                    `
                    export const greeting = "Hello, world!";
                    export function add(a: number, b: number): number {
                        return a + b;
                    }
                `
                );

                const result = await quickValidateProject(tempDir);

                // Debug output if test fails
                if (!result.isValid) {
                    console.log("Validation failed with errors:", result.errors);
                    console.log("Warnings:", result.warnings);
                }

                expect(result.isValid).toBe(true);
                expect(result.errors).toHaveLength(0);
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test("detects TypeScript syntax errors", async () => {
            const tempDir = join(tmpdir(), `test-project-${Date.now()}`);

            try {
                // Create a project with syntax errors
                mkdirSync(tempDir, { recursive: true });

                // Create package.json
                writeFileSync(
                    join(tempDir, "package.json"),
                    JSON.stringify(
                        {
                            name: "test-project",
                            type: "module",
                        },
                        null,
                        2
                    )
                );

                // Create tsconfig.json
                writeFileSync(
                    join(tempDir, "tsconfig.json"),
                    JSON.stringify(
                        {
                            compilerOptions: {
                                target: "ES2022",
                                module: "ESNext",
                                moduleResolution: "bundler",
                                noEmit: true,
                                strict: true,
                                skipLibCheck: true,
                            },
                        },
                        null,
                        2
                    )
                );

                // Create invalid TypeScript file
                writeFileSync(
                    join(tempDir, "index.ts"),
                    `
                    export const greeting = "Hello, world!
                    // Missing closing quote - syntax error
                `
                );

                const result = await quickValidateProject(tempDir);
                expect(result.isValid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test("handles missing package.json", async () => {
            const tempDir = join(tmpdir(), `test-project-${Date.now()}`);

            try {
                mkdirSync(tempDir, { recursive: true });

                const result = await quickValidateProject(tempDir);
                expect(result.isValid).toBe(false);
                expect(result.errors).toContain("No package.json found in project directory");
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });

        test("handles missing tsconfig.json", async () => {
            const tempDir = join(tmpdir(), `test-project-${Date.now()}`);

            try {
                mkdirSync(tempDir, { recursive: true });

                // Create package.json but no tsconfig.json
                writeFileSync(
                    join(tempDir, "package.json"),
                    JSON.stringify(
                        {
                            name: "test-project",
                        },
                        null,
                        2
                    )
                );

                const result = await quickValidateProject(tempDir);
                expect(result.isValid).toBe(false);
                expect(result.errors).toContain("No tsconfig.json found in project directory");
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        });
    });

    describe("Error Handling", () => {
        test("handles non-existent project directory", async () => {
            const nonExistentDir = join(tmpdir(), `non-existent-${Date.now()}`);

            const result = await quickValidateProject(nonExistentDir);
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test("handles timeout gracefully", async () => {
            const tempDir = join(tmpdir(), `test-project-${Date.now()}`);

            try {
                mkdirSync(tempDir, { recursive: true });

                // Create a basic project that should validate quickly
                writeFileSync(
                    join(tempDir, "package.json"),
                    JSON.stringify(
                        {
                            name: "test-project",
                        },
                        null,
                        2
                    )
                );

                writeFileSync(
                    join(tempDir, "tsconfig.json"),
                    JSON.stringify(
                        {
                            compilerOptions: {
                                target: "ES2022",
                                module: "ESNext",
                                moduleResolution: "bundler",
                                noEmit: true,
                            },
                        },
                        null,
                        2
                    )
                );

                writeFileSync(join(tempDir, "index.ts"), 'export const test = "hello";');

                const result = await quickValidateProject(tempDir);
                // Should complete within reasonable time and not timeout
                expect(result).toBeDefined();
                expect(typeof result.isValid).toBe("boolean");
            } finally {
                rmSync(tempDir, { recursive: true, force: true });
            }
        }, 65000); // 65 second timeout for this test
    });
});
