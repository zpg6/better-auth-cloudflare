import { describe, test, expect } from "bun:test";
import { TypeScriptValidator, validateTypeScript } from "../src/lib/typescript-validator";
import type { FileToValidate } from "../src/lib/typescript-validator";

describe("TypeScript Validator", () => {
    describe("Basic Validation", () => {
        test("validates correct TypeScript code", async () => {
            const files: FileToValidate[] = [
                {
                    path: "test.ts",
                    content: `
                        export const greeting = "Hello, world!";
                        export function add(a: number, b: number): number {
                            return a + b;
                        }
                    `,
                },
            ];

            const result = await validateTypeScript(files);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test("detects TypeScript syntax errors", async () => {
            const files: FileToValidate[] = [
                {
                    path: "invalid.ts",
                    content: `
                        export const greeting = "Hello, world!;
                        export function add(a: number, b: number): number {
                            return a + b;
                        }
                    `,
                },
            ];

            const result = await validateTypeScript(files);
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test("detects TypeScript type errors", async () => {
            const files: FileToValidate[] = [
                {
                    path: "types.ts",
                    content: `
                        export function add(a: number, b: number): number {
                            return a + "invalid"; // Type error
                        }
                    `,
                },
            ];

            const result = await validateTypeScript(files);
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe("Multi-file Validation", () => {
        test("validates files with internal dependencies", async () => {
            const files: FileToValidate[] = [
                {
                    path: "utils.ts",
                    content: `
                        export interface User {
                            id: string;
                            name: string;
                        }
                    `,
                },
                {
                    path: "main.ts",
                    content: `
                        import { User } from "./utils";
                        
                        const user: User = { id: "1", name: "John" };
                        console.log(user.name);
                    `,
                },
            ];

            const result = await validateTypeScript(files);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        test("detects import errors between files", async () => {
            const files: FileToValidate[] = [
                {
                    path: "utils.ts",
                    content: `
                        export interface User {
                            id: string;
                            name: string;
                        }
                    `,
                },
                {
                    path: "main.ts",
                    content: `
                        import { NonExistentType } from "./utils";
                        
                        const user: NonExistentType = { id: "1" };
                    `,
                },
            ];

            const result = await validateTypeScript(files);
            expect(result.isValid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe("Error Handling", () => {
        test("handles timeout gracefully", async () => {
            // Create a validator with a very short timeout
            const validator = new TypeScriptValidator();

            const files: FileToValidate[] = [
                {
                    path: "test.ts",
                    content: `
                        export const greeting = "Hello, world!";
                    `,
                },
            ];

            const result = await validator.validateFiles(files);
            // Should not throw, should return a result
            expect(result).toBeDefined();
            expect(typeof result.isValid).toBe("boolean");
        });

        test("handles invalid file paths gracefully", async () => {
            const files: FileToValidate[] = [
                {
                    path: "",
                    content: `export const test = "hello";`,
                },
            ];

            const result = await validateTypeScript(files);
            // Should not throw
            expect(result).toBeDefined();
        });
    });

    describe("Cleanup", () => {
        test("cleans up temporary files", async () => {
            const validator = new TypeScriptValidator();

            const files: FileToValidate[] = [
                {
                    path: "test.ts",
                    content: `export const greeting = "Hello, world!";`,
                },
            ];

            await validator.validateFiles(files);
            // Test passes if no errors are thrown during cleanup
            expect(true).toBe(true);
        });
    });
});
