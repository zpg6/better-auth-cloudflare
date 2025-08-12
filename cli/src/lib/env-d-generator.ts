/**
 * Clean generator for env.d.ts files
 * Replaces fragile regex-based file modification with structured generation
 */

export interface EnvDConfig {
    template: "hono" | "nextjs";
    resources: {
        d1: boolean;
        kv: boolean;
        r2: boolean;
        hyperdrive: boolean;
    };
    bindings: {
        d1?: string;
        kv?: string;
        r2?: string;
        hyperdrive?: string;
    };
    database: "sqlite" | "postgres" | "mysql";
}

/**
 * Generate complete env.d.ts file content
 */
export function generateEnvDFile(config: EnvDConfig): string {
    const bindings: string[] = [];

    // Add database bindings
    if (config.resources.d1 && config.bindings.d1) {
        bindings.push(`    ${config.bindings.d1}: D1Database;`);
    }

    if (config.resources.hyperdrive && config.bindings.hyperdrive) {
        bindings.push(`    ${config.bindings.hyperdrive}: any;`);
    }

    // Add KV binding
    if (config.resources.kv && config.bindings.kv) {
        bindings.push(`    ${config.bindings.kv}: KVNamespace;`);
    }

    // Add R2 binding
    if (config.resources.r2 && config.bindings.r2) {
        bindings.push(`    ${config.bindings.r2}: R2Bucket;`);
    }

    // Always include at least one binding to prevent empty interface
    if (bindings.length === 0) {
        bindings.push("    // No Cloudflare bindings configured");
    }

    const bindingsContent = bindings.join("\n");

    if (config.template === "hono") {
        return `export interface CloudflareBindings {
${bindingsContent}
}

declare global {
    namespace NodeJS {
        interface ProcessEnv extends CloudflareBindings {
            // Additional environment variables can be added here
        }
    }
}
`;
    } else {
        // Next.js template
        return `export interface CloudflareBindings {
${bindingsContent}
}

declare global {
    namespace NodeJS {
        interface ProcessEnv extends CloudflareBindings {
            // Additional environment variables can be added here
        }
    }
}
`;
    }
}

/**
 * Helper function to validate generated env.d.ts content
 */
export function validateEnvDContent(content: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check basic structure
    if (!content.includes("export interface CloudflareBindings")) {
        errors.push("Missing CloudflareBindings interface export");
    }

    if (!content.includes("declare global")) {
        errors.push("Missing global declaration");
    }

    if (!content.includes("interface ProcessEnv extends CloudflareBindings")) {
        errors.push("Missing ProcessEnv interface extension");
    }

    // Check for syntax issues
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
        errors.push("Mismatched braces in generated content");
    }

    // Check for valid TypeScript syntax patterns
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith("//") && !line.startsWith("/*")) {
            // Check for common syntax errors
            if (line.includes(": ") && !line.endsWith(";") && !line.endsWith("{") && !line.endsWith("}")) {
                // This might be a binding line that should end with semicolon
                if (
                    line.includes(": D1Database") ||
                    line.includes(": KVNamespace") ||
                    line.includes(": R2Bucket") ||
                    line.includes(": any")
                ) {
                    errors.push(`Line ${i + 1} should end with semicolon: ${line}`);
                }
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
}
