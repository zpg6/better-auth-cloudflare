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
    const typeImports: string[] = [];
    const bindings: string[] = [];

    // Add database bindings
    if (config.resources.d1 && config.bindings.d1) {
        typeImports.push("D1Database");
        bindings.push(`    ${config.bindings.d1}: D1Database;`);
    }

    if (config.resources.hyperdrive && config.bindings.hyperdrive) {
        typeImports.push("Hyperdrive");
        bindings.push(`    ${config.bindings.hyperdrive}: Hyperdrive;`);
    }

    // Add KV binding
    if (config.resources.kv && config.bindings.kv) {
        typeImports.push("KVNamespace");
        bindings.push(`    ${config.bindings.kv}: KVNamespace<string>;`);
    }

    // Add R2 binding
    if (config.resources.r2 && config.bindings.r2) {
        typeImports.push("R2Bucket");
        bindings.push(`    ${config.bindings.r2}: R2Bucket;`);
    }

    // Always include at least one binding to prevent empty interface
    if (bindings.length === 0) {
        bindings.push("    // No Cloudflare bindings configured");
    }

    const importLine =
        typeImports.length > 0 ? `import type { ${typeImports.join(", ")} } from "@cloudflare/workers-types";\n\n` : "";

    const bindingsContent = bindings.join("\n");

    if (config.template === "hono") {
        return `${importLine}export interface CloudflareBindings {
${bindingsContent}
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL: string;
}
`;
    } else {
        // Next.js (OpenNextJS) template — uses CloudflareEnv + global declaration
        return `${importLine}declare global {
    interface CloudflareEnv {
${bindingsContent}
        BETTER_AUTH_SECRET: string;
        BETTER_AUTH_URL: string;
        BETTER_AUTH_TRUSTED_ORIGINS: string;
    }
}

export {};
`;
    }
}

/**
 * Helper function to validate generated env.d.ts content
 */
export function validateEnvDContent(
    content: string,
    template: "hono" | "nextjs"
): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (template === "hono") {
        if (!content.includes("export interface CloudflareBindings")) {
            errors.push("Missing CloudflareBindings interface export");
        }
    } else {
        if (!content.includes("interface CloudflareEnv")) {
            errors.push("Missing CloudflareEnv interface");
        }
        if (!content.includes("declare global")) {
            errors.push("Missing global declaration");
        }
        if (!content.includes("export {}")) {
            errors.push("Missing module export marker");
        }
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
        if (line && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("import")) {
            if (line.includes(": ") && !line.endsWith(";") && !line.endsWith("{") && !line.endsWith("}")) {
                if (
                    line.includes(": D1Database") ||
                    line.includes(": KVNamespace") ||
                    line.includes(": R2Bucket") ||
                    line.includes(": Hyperdrive") ||
                    line.includes(": string")
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
