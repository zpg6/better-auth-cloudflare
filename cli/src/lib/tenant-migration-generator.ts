import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Core Better Auth tables that should remain in the main database
 * These handle authentication, user identity, and multi-tenancy management
 */
const CORE_AUTH_TABLES = new Set(["users", "accounts", "verifications", "tenants"]);

/**
 * Tenant-specific tables that should be moved to tenant databases
 * These contain tenant-scoped data like sessions, files, and organization data
 */
const TENANT_TABLES = new Set(["sessions", "userFiles", "organizations", "members", "invitations"]);

/**
 * Detects if multi-tenancy is enabled by checking auth configuration.
 * TODO: Make this detection more robust
 */
export function detectMultiTenancy(projectPath: string): boolean {
    const authPath = join(projectPath, "src/auth/index.ts");

    if (!existsSync(authPath)) {
        return false;
    }

    try {
        const authContent = readFileSync(authPath, "utf8");
        return (
            authContent.includes("multiTenancy") &&
            (authContent.includes('mode: "organization"') || authContent.includes('mode: "user"'))
        );
    } catch {
        return false;
    }
}

/**
 * Splits the generated auth.schema.ts into core and tenant schemas
 */
export function splitAuthSchema(projectPath: string): void {
    const authSchemaPath = join(projectPath, "src/db/auth.schema.ts");

    if (!existsSync(authSchemaPath)) {
        throw new Error("auth.schema.ts not found. Please run auth:update first.");
    }

    const authSchemaContent = readFileSync(authSchemaPath, "utf8");

    // Parse the schema content to extract table definitions
    const { coreSchema, tenantSchema, imports } = parseSchemaContent(authSchemaContent);

    // Write the core auth schema (main database)
    const coreSchemaPath = join(projectPath, "src/db/auth.schema.ts");
    writeFileSync(coreSchemaPath, generateCoreSchemaFile(imports, coreSchema));

    // Write the tenant schema (tenant databases)
    const tenantSchemaPath = join(projectPath, "src/db/tenant.schema.ts");
    writeFileSync(tenantSchemaPath, generateTenantSchemaFile(imports, tenantSchema));

    // Update the main schema.ts to import from both files
    updateMainSchemaFile(projectPath);
}

/**
 * Parses the auth schema content and separates core vs tenant tables
 */
function parseSchemaContent(content: string): {
    coreSchema: string[];
    tenantSchema: string[];
    imports: string;
} {
    const lines = content.split("\n");
    const imports: string[] = [];
    const coreSchema: string[] = [];
    const tenantSchema: string[] = [];

    let currentTable = "";
    let currentTableLines: string[] = [];
    let inTableDefinition = false;

    for (const line of lines) {
        // Collect imports
        if (line.startsWith("import ")) {
            imports.push(line);
            continue;
        }

        // Skip empty lines at the beginning
        if (!line.trim() && !inTableDefinition) {
            continue;
        }

        // Detect table export
        const tableMatch = line.match(/^export const (\w+) = sqliteTable\(/);
        if (tableMatch) {
            // Finish previous table if exists
            if (currentTable && currentTableLines.length > 0) {
                const tableContent = currentTableLines.join("\n");
                if (CORE_AUTH_TABLES.has(currentTable)) {
                    coreSchema.push(tableContent);
                } else if (TENANT_TABLES.has(currentTable)) {
                    tenantSchema.push(tableContent);
                }
            }

            // Start new table
            currentTable = tableMatch[1];
            currentTableLines = [line];
            inTableDefinition = true;
            continue;
        }

        // Continue collecting table lines
        if (inTableDefinition) {
            currentTableLines.push(line);

            // Check if table definition is complete (ends with });)
            if (line.trim() === "});") {
                const tableContent = currentTableLines.join("\n");
                if (CORE_AUTH_TABLES.has(currentTable)) {
                    coreSchema.push(tableContent);
                } else if (TENANT_TABLES.has(currentTable)) {
                    tenantSchema.push(tableContent);
                }

                currentTable = "";
                currentTableLines = [];
                inTableDefinition = false;
            }
        }
    }

    return {
        coreSchema,
        tenantSchema,
        imports: imports.join("\n"),
    };
}

/**
 * Generates the core auth schema file content
 */
function generateCoreSchemaFile(imports: string, coreSchema: string[]): string {
    const header = `// Core Better Auth tables for main database
// These tables handle authentication, user identity, and multi-tenancy management
`;

    return [imports, "", header, ...coreSchema].join("\n");
}

/**
 * Generates the tenant schema file content
 */
function generateTenantSchemaFile(imports: string, tenantSchema: string[]): string {
    const header = `// Tenant-specific Better Auth tables for tenant databases
// These tables contain tenant-scoped data like sessions, files, and organization data
`;

    // Update imports to handle references to core tables
    const updatedImports = imports.replace(
        /import { ([^}]+) } from "drizzle-orm\/sqlite-core";/,
        (match, importList) => {
            // Add reference import for core tables if needed
            const hasReferences = tenantSchema.some(
                schema =>
                    schema.includes(".references(") && (schema.includes("users.id") || schema.includes("accounts.id"))
            );

            if (hasReferences) {
                return `${match}\nimport { users } from "./auth.schema";`;
            }
            return match;
        }
    );

    return [updatedImports, "", header, ...tenantSchema].join("\n");
}

/**
 * Updates the main schema.ts file to import from both auth.schema.ts and tenant.schema.ts
 */
function updateMainSchemaFile(projectPath: string): void {
    const schemaPath = join(projectPath, "src/db/schema.ts");

    if (!existsSync(schemaPath)) {
        return;
    }

    let schemaContent = readFileSync(schemaPath, "utf8");

    // Check if it already imports tenant schema
    if (schemaContent.includes("tenant.schema")) {
        return;
    }

    // Add tenant schema import after auth schema import
    schemaContent = schemaContent.replace(
        /import \* as authSchema from ["']\.\/auth\.schema["'];.*$/m,
        `import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import * as tenantSchema from "./tenant.schema"; // Tenant tables (tenant databases)`
    );

    // Update the schema export to include tenant schema
    schemaContent = schemaContent.replace(
        /export const schema = \{[\s\S]*?\} as const;/,
        `export const schema = {
    ...authSchema,
    ...tenantSchema,
} as const;`
    );

    writeFileSync(schemaPath, schemaContent);
}

/**
 * Restores the original single auth.schema.ts file (reverses the split)
 */
export function restoreOriginalSchema(projectPath: string): void {
    const authSchemaPath = join(projectPath, "src/db/auth.schema.ts");
    const tenantSchemaPath = join(projectPath, "src/db/tenant.schema.ts");
    const schemaPath = join(projectPath, "src/db/schema.ts");

    // Remove tenant schema file if it exists
    if (existsSync(tenantSchemaPath)) {
        const fs = require("fs");
        fs.unlinkSync(tenantSchemaPath);
    }

    // Restore original schema.ts import
    if (existsSync(schemaPath)) {
        let schemaContent = readFileSync(schemaPath, "utf8");

        // Remove tenant schema import
        schemaContent = schemaContent.replace(
            /import \* as authSchema from ["']\.\/auth\.schema["']; \/\/ Core auth tables \(main database\)\nimport \* as tenantSchema from ["']\.\/tenant\.schema["']; \/\/ Tenant tables \(tenant databases\)/,
            'import * as authSchema from "./auth.schema"; // This will be generated in a later step'
        );

        // Restore original schema export
        schemaContent = schemaContent.replace(
            /export const schema = \{\s*\.\.\.authSchema,\s*\.\.\.tenantSchema,\s*\};/,
            "export const schema = {\n    ...authSchema,\n};"
        );

        writeFileSync(schemaPath, schemaContent);
    }
}
