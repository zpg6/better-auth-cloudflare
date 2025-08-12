import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export interface FileToValidate {
    path: string;
    content: string;
}

/**
 * Validates TypeScript files by creating a temporary project and running tsc
 */
export class TypeScriptValidator {
    private tempDir: string;

    constructor() {
        this.tempDir = join(tmpdir(), `ts-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    }

    /**
     * Validates multiple TypeScript files together
     * This is important because files may have dependencies between them
     */
    async validateFiles(files: FileToValidate[]): Promise<ValidationResult> {
        try {
            // Create temporary directory
            mkdirSync(this.tempDir, { recursive: true });

            // Write all files to temp directory
            for (const file of files) {
                const fullPath = join(this.tempDir, file.path);
                const dir = join(fullPath, "..");
                mkdirSync(dir, { recursive: true });
                writeFileSync(fullPath, file.content, "utf8");
            }

            // Create a basic tsconfig.json for validation - catch syntax errors and import issues
            const tsConfig = {
                compilerOptions: {
                    target: "ES2022",
                    lib: ["ES2022", "DOM"], // Include DOM for console, etc.
                    module: "ESNext",
                    moduleResolution: "bundler",
                    allowImportingTsExtensions: true,
                    noEmit: true,
                    skipLibCheck: true, // Skip checking external library types
                    allowSyntheticDefaultImports: true,
                    esModuleInterop: true,
                    forceConsistentCasingInFileNames: true,
                    resolveJsonModule: true,
                    isolatedModules: true,
                    verbatimModuleSyntax: false,
                    // Basic validation - catch obvious errors
                    noImplicitAny: false,
                    strict: false,
                },
                include: ["**/*.ts", "**/*.tsx"],
                exclude: ["node_modules", "dist"],
            };

            writeFileSync(join(this.tempDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2), "utf8");

            // No need for package.json - if imports fail, that's a validation error we want to catch

            // Try to use TypeScript compiler - use local installation from CLI project
            // Run from CLI project directory but specify the temp directory's tsconfig
            const cliProjectDir = join(__dirname, "..", "..");
            let result = spawnSync("npx", ["tsc", "--project", this.tempDir, "--noEmit"], {
                cwd: cliProjectDir,
                encoding: "utf8",
                stdio: "pipe",
                timeout: 30000, // 30 second timeout
            });

            // If npx fails, try direct tsc command (global installation)
            if (result.status !== 0 && result.error) {
                result = spawnSync("tsc", ["--project", this.tempDir, "--noEmit"], {
                    cwd: cliProjectDir,
                    encoding: "utf8",
                    stdio: "pipe",
                    timeout: 30000, // 30 second timeout
                });
            }

            const errors: string[] = [];
            const warnings: string[] = [];

            if (result.error) {
                errors.push(`TypeScript validation failed: ${result.error.message}`);
                return { isValid: false, errors, warnings };
            }

            // Process both stdout and stderr for TypeScript errors
            const outputs = [result.stdout, result.stderr].filter(Boolean);

            for (const output of outputs) {
                const lines = output.split("\n").filter(line => line.trim());

                for (const line of lines) {
                    // Filter out npm warnings and focus on TypeScript errors
                    if (line.includes("error TS") || line.includes("): error")) {
                        // Clean up the error message to remove temp path references
                        const cleanError = line.replace(new RegExp(this.tempDir, "g"), ".");
                        errors.push(cleanError);
                    } else if (line.includes("warning") && !line.includes("npm")) {
                        const cleanWarning = line.replace(new RegExp(this.tempDir, "g"), ".");
                        warnings.push(cleanWarning);
                    }
                }
            }

            // If TypeScript compiler failed but we don't have specific errors, add a generic error
            if (result.status !== 0 && errors.length === 0) {
                errors.push(`TypeScript compilation failed with exit code ${result.status}`);
                if (result.stderr) {
                    errors.push(`stderr: ${result.stderr}`);
                }
                if (result.stdout) {
                    errors.push(`stdout: ${result.stdout}`);
                }
            }

            const isValid = result.status === 0 && errors.length === 0;

            return {
                isValid,
                errors,
                warnings,
            };
        } catch (error) {
            return {
                isValid: false,
                errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
                warnings: [],
            };
        } finally {
            // Clean up temp directory
            this.cleanup();
        }
    }

    /**
     * Validates a single TypeScript file
     */
    async validateFile(path: string, content: string): Promise<ValidationResult> {
        return this.validateFiles([{ path, content }]);
    }

    /**
     * Clean up temporary directory
     */
    private cleanup(): void {
        try {
            if (existsSync(this.tempDir)) {
                rmSync(this.tempDir, { recursive: true, force: true });
            }
        } catch (error) {
            // Ignore cleanup errors
            console.warn(`Warning: Could not clean up temp directory ${this.tempDir}`);
        }
    }
}

/**
 * Convenience function for quick validation
 */
export async function validateTypeScript(files: FileToValidate[]): Promise<ValidationResult> {
    const validator = new TypeScriptValidator();
    return validator.validateFiles(files);
}

/**
 * Validates generated auth file - if imports fail, that's a validation error
 */
export async function validateAuthFile(content: string, template: "hono" | "nextjs"): Promise<ValidationResult> {
    return validateTypeScript([{ path: "src/auth/index.ts", content }]);
}

/**
 * Validates generated database file - if imports fail, that's a validation error
 */
export async function validateDbFile(content: string, template: "hono" | "nextjs"): Promise<ValidationResult> {
    return validateTypeScript([{ path: "src/db/index.ts", content }]);
}
