import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

/**
 * Core Better Auth tables that should remain in the main database
 * These handle authentication, user identity, and multi-tenancy management
 */
const CORE_AUTH_TABLES = new Set([
    "users",
    "accounts",
    "sessions",
    "organizations",
    "members",
    "invitations",
    "verifications",
    "tenants",
]);

/**
 * Check if a table should be moved to tenant databases
 * Any table that is NOT in the core auth tables is considered tenant-scoped
 */
function isTenantTable(tableName: string): boolean {
    return !CORE_AUTH_TABLES.has(tableName);
}

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
export async function splitAuthSchema(projectPath: string): Promise<void> {
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
    writeFileSync(tenantSchemaPath, await generateTenantSchemaFile(imports, tenantSchema, projectPath));

    // Update the main schema.ts to import from both files
    updateMainSchemaFile(projectPath);
}

/**
 * Parses the auth schema content and separates core vs tenant tables
 * TODO: Make this more robust
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
        const tableMatch = /^export const (\w+) = sqliteTable\(/.exec(line);
        if (tableMatch) {
            // Finish previous table if exists
            if (currentTable && currentTableLines.length > 0) {
                const tableContent = currentTableLines.join("\n");
                if (CORE_AUTH_TABLES.has(currentTable)) {
                    coreSchema.push(tableContent);
                } else if (isTenantTable(currentTable)) {
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
                } else if (isTenantTable(currentTable)) {
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
 * Generates the tenant schema file content with raw SQL migration statements
 */
async function generateTenantSchemaFile(imports: string, tenantSchema: string[], projectPath: string): Promise<string> {
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

    // Generate raw SQL statements for tenant tables using drizzle-kit
    const rawSqlStatements = await generateTenantSqlUsingDrizzle(projectPath, tenantSchema, updatedImports);

    const rawSqlExport = `
// Raw SQL statements for creating tenant tables
// This is used for just-in-time migration when creating new tenant databases
export const raw = \`${rawSqlStatements}\`;`;

    return [updatedImports, "", header, ...tenantSchema, rawSqlExport].join("\n");
}

/**
 * Generates raw SQL statements using a simple, fast string parser
 * This is a KISS solution that directly parses Drizzle schema strings to SQL
 */
async function generateTenantSqlUsingDrizzle(
    projectPath: string,
    tenantSchema: string[],
    imports: string
): Promise<string> {
    const sqlStatements: string[] = [];

    for (const schemaString of tenantSchema) {
        const sql = parseSchemaStringToSql(schemaString);
        if (sql) {
            sqlStatements.push(sql);
        }
    }

    return sqlStatements.join("\n--> statement-breakpoint\n") || "-- No tenant tables found";
}

/**
 * Fast and reliable parser for Drizzle schema strings to SQL
 */
function parseSchemaStringToSql(schemaString: string): string | null {
    // Extract table name
    const tableMatch = /export const \w+ = sqliteTable\("([^"]+)"/.exec(schemaString);
    if (!tableMatch) return null;

    const tableName = tableMatch[1];

    // Extract the entire table definition more robustly
    const tableStartMatch = /sqliteTable\("[^"]+",\s*\{/.exec(schemaString);
    if (!tableStartMatch) return null;

    const startIndex = tableStartMatch.index! + tableStartMatch[0].length;
    let braceCount = 1;
    let endIndex = startIndex;

    // Find the matching closing brace
    for (let i = startIndex; i < schemaString.length && braceCount > 0; i++) {
        if (schemaString[i] === "{") braceCount++;
        if (schemaString[i] === "}") braceCount--;
        endIndex = i;
    }

    const tableBody = schemaString.substring(startIndex, endIndex);
    const lines = tableBody.split("\n");

    const columns: string[] = [];
    const foreignKeys: string[] = [];

    let currentColumn = "";
    let currentDefinition = "";
    let inColumnDef = false;
    let braceDepth = 0;

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip comments and empty lines
        if (trimmedLine.startsWith("//") || !trimmedLine) continue;

        // Count braces to handle nested objects
        for (const char of trimmedLine) {
            if (char === "{") braceDepth++;
            if (char === "}") braceDepth--;
        }

        // Check if this line starts a new column definition
        const columnStart = /^(\w+):\s*(.*)/.exec(trimmedLine);
        if (columnStart && braceDepth === 0) {
            // Process previous column if exists
            if (currentColumn && currentDefinition) {
                const result = parseColumnDefinition(currentColumn, currentDefinition);
                if (result) {
                    columns.push(result.column);
                    if (result.foreignKey) {
                        foreignKeys.push(result.foreignKey);
                    }
                }
            }

            currentColumn = columnStart[1];
            currentDefinition = columnStart[2];
            inColumnDef = true;

            // Check if this line completes the column definition
            if (currentDefinition.endsWith(",") || currentDefinition.endsWith("}")) {
                currentDefinition = currentDefinition.replace(/[,}]$/, "");
                const result = parseColumnDefinition(currentColumn, currentDefinition);
                if (result) {
                    columns.push(result.column);
                    if (result.foreignKey) {
                        foreignKeys.push(result.foreignKey);
                    }
                }
                currentColumn = "";
                currentDefinition = "";
                inColumnDef = false;
            }
        } else if (inColumnDef && braceDepth >= 0) {
            // Continue building the current column definition
            currentDefinition += " " + trimmedLine;

            // Check if column definition is complete
            if ((trimmedLine.endsWith(",") || trimmedLine.endsWith("}")) && braceDepth === 0) {
                currentDefinition = currentDefinition.replace(/[,}]$/, "");
                const result = parseColumnDefinition(currentColumn, currentDefinition);
                if (result) {
                    columns.push(result.column);
                    if (result.foreignKey) {
                        foreignKeys.push(result.foreignKey);
                    }
                }
                currentColumn = "";
                currentDefinition = "";
                inColumnDef = false;
            }
        }
    }

    // Process final column if exists
    if (currentColumn && currentDefinition) {
        const result = parseColumnDefinition(currentColumn, currentDefinition);
        if (result) {
            columns.push(result.column);
            if (result.foreignKey) {
                foreignKeys.push(result.foreignKey);
            }
        }
    }

    if (columns.length === 0) return null;

    // Build CREATE TABLE statement with proper escaping
    let createTableSql = `CREATE TABLE \\\`${tableName}\\\` (\n`;
    createTableSql += "  " + columns.join(",\n  ");

    if (foreignKeys.length > 0) {
        createTableSql += ",\n  " + foreignKeys.join(",\n  ");
    }

    createTableSql += "\n);";

    return createTableSql;
}

/**
 * Parse a single column definition into SQL
 */
function parseColumnDefinition(columnName: string, definition: string): { column: string; foreignKey?: string } | null {
    // Extract the actual column name from the definition
    const nameMatch = /(?:text|integer)\("([^"]+)"/.exec(definition);
    const actualColumnName = nameMatch ? nameMatch[1] : columnName;

    let columnSql = `\\\`${actualColumnName}\\\``;

    // Determine column type and mode
    if (definition.includes("integer(")) {
        columnSql += " integer";
    } else if (definition.includes("text(")) {
        columnSql += " text";
    } else {
        columnSql += " text"; // Default fallback
    }

    // Add constraints in proper order
    if (definition.includes(".primaryKey()")) {
        columnSql += " PRIMARY KEY";
    }

    if (definition.includes(".notNull()")) {
        columnSql += " NOT NULL";
    }

    if (definition.includes(".unique()")) {
        columnSql += " UNIQUE";
    }

    // Handle default values - check for various patterns
    let defaultMatch = /\.default\("([^"]+)"\)/.exec(definition); // String defaults
    if (defaultMatch) {
        columnSql += ` DEFAULT '${defaultMatch[1]}'`;
    } else {
        defaultMatch = /\.default\(([^)]+)\)/.exec(definition); // Other defaults
        if (defaultMatch) {
            let defaultValue = defaultMatch[1];
            if (defaultValue === "true" || defaultValue === "false") {
                // Boolean default (SQLite uses integers)
                columnSql += ` DEFAULT ${defaultValue === "true" ? "1" : "0"}`;
            } else if (!isNaN(Number(defaultValue))) {
                // Numeric default
                columnSql += ` DEFAULT ${defaultValue}`;
            } else {
                // Other defaults (functions, etc.)
                columnSql += ` DEFAULT ${defaultValue}`;
            }
        }
    }

    // Handle $defaultFn - these are runtime defaults, not SQL defaults
    // We'll skip these as they're handled by the application layer

    // Handle foreign keys with proper CASCADE handling
    let foreignKey: string | undefined;
    const refMatch = /\.references\(\(\) => (\w+)\.(\w+)(?:, \{ onDelete: "([^"]+)" \})?\)/.exec(definition);
    if (refMatch) {
        const [, refTable, refColumn, onDelete = "no action"] = refMatch;
        // Map the reference table name properly (users vs Users)
        const actualRefTable = refTable === "Users" ? "users" : refTable;
        foreignKey = `FOREIGN KEY (\\\`${actualColumnName}\\\`) REFERENCES \\\`${actualRefTable}\\\`(\\\`${refColumn}\\\`) ON UPDATE no action ON DELETE ${onDelete}`;
    }

    return { column: columnSql, foreignKey };
}

/**
 * Updates the main schema.ts file to conditionally import tenant.schema.ts
 */
function updateMainSchemaFile(projectPath: string): void {
    const schemaPath = join(projectPath, "src/db/schema.ts");

    if (!existsSync(schemaPath)) {
        return;
    }

    let schemaContent = readFileSync(schemaPath, "utf8");

    // Check if it already has conditional tenant schema import
    if (schemaContent.includes("tenant.schema") && schemaContent.includes("existsSync")) {
        return;
    }

    // Create a conditional import approach
    const newSchemaContent = `import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import { existsSync } from "fs";
import { join } from "path";

// Conditionally import tenant schema if it exists
let tenantSchema = {};
try {
    if (existsSync(join(__dirname, "tenant.schema.ts")) || existsSync(join(__dirname, "tenant.schema.js"))) {
        tenantSchema = require("./tenant.schema");
    }
} catch (error) {
    // Tenant schema doesn't exist yet, use empty object
    tenantSchema = {};
}

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    ...tenantSchema,
} as const;`;

    writeFileSync(schemaPath, newSchemaContent);
}

/**
 * Restores the original single auth.schema.ts file (reverses the split)
 */
export function restoreOriginalSchema(projectPath: string): void {
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
