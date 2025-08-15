import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export interface ProjectValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Validates TypeScript compilation for an entire project
 * This runs tsc --noEmit in the project directory to check all TypeScript files
 */
export async function validateProject(projectPath: string): Promise<ProjectValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
        // Check if this is a valid project directory
        const packageJsonPath = join(projectPath, "package.json");
        const tsConfigPath = join(projectPath, "tsconfig.json");

        if (!existsSync(packageJsonPath)) {
            return {
                isValid: false,
                errors: ["No package.json found in project directory"],
                warnings: [],
            };
        }

        if (!existsSync(tsConfigPath)) {
            return {
                isValid: false,
                errors: ["No tsconfig.json found in project directory"],
                warnings: [],
            };
        }

        // Try to use TypeScript compiler - first try with npx --yes, then fallback to direct tsc
        let result = spawnSync("npx", ["--yes", "typescript@latest", "tsc", "--noEmit"], {
            cwd: projectPath,
            encoding: "utf8",
            stdio: "pipe",
            timeout: 60000, // 60 second timeout for full project compilation
        });

        // If npx fails, try direct tsc command
        if (result.status !== 0) {
            result = spawnSync("tsc", ["--noEmit"], {
                cwd: projectPath,
                encoding: "utf8",
                stdio: "pipe",
                timeout: 60000, // 60 second timeout for full project compilation
            });
        }

        // If command failed to start
        if (result.error) {
            return {
                isValid: false,
                errors: [`TypeScript validation failed: ${result.error.message}`],
                warnings: [],
            };
        }

        // Process both stdout and stderr for TypeScript errors
        const outputs = [result.stdout, result.stderr].filter(Boolean);

        for (const output of outputs) {
            const lines = output.split("\n").filter(line => line.trim());

            for (const line of lines) {
                // Look for TypeScript errors
                if (line.includes("error TS") || line.includes("): error")) {
                    errors.push(line);
                } else if (line.includes("warning") && !line.includes("npm")) {
                    warnings.push(line);
                }
            }
        }

        // If TypeScript compiler failed but we don't have specific errors, add generic info
        if (result.status !== 0 && errors.length === 0) {
            errors.push(`TypeScript compilation failed with exit code ${result.status}`);

            // Include both stdout and stderr for debugging
            if (result.stdout && result.stdout.trim()) {
                const cleanStdout = result.stdout.trim();
                if (!cleanStdout.includes("npm WARN")) {
                    errors.push(`stdout: ${cleanStdout}`);
                }
            }

            if (result.stderr && result.stderr.trim()) {
                const cleanStderr = result.stderr.trim();
                if (!cleanStderr.includes("npm WARN")) {
                    errors.push(`stderr: ${cleanStderr}`);
                }
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
            errors: [`Project validation error: ${error instanceof Error ? error.message : String(error)}`],
            warnings: [],
        };
    }
}

/**
 * Validates TypeScript compilation after installing dependencies
 * This is useful for checking if generated files work with the actual project setup
 */
export async function validateProjectWithDeps(projectPath: string): Promise<ProjectValidationResult> {
    try {
        // First install dependencies to ensure we have all required packages
        const installResult = spawnSync("npm", ["install"], {
            cwd: projectPath,
            encoding: "utf8",
            stdio: "pipe",
            timeout: 120000, // 2 minute timeout for npm install
        });

        if (installResult.status !== 0) {
            return {
                isValid: false,
                errors: [`Failed to install dependencies: ${installResult.stderr || "Unknown error"}`],
                warnings: [],
            };
        }

        // Now validate the project
        return validateProject(projectPath);
    } catch (error) {
        return {
            isValid: false,
            errors: [`Dependency installation error: ${error instanceof Error ? error.message : String(error)}`],
            warnings: [],
        };
    }
}

/**
 * Quick validation that only checks TypeScript compilation without installing deps
 * Useful for checking if generated files have basic syntax/type errors
 */
export async function quickValidateProject(projectPath: string): Promise<ProjectValidationResult> {
    return validateProject(projectPath);
}
