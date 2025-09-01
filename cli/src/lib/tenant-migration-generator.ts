import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Core Better Auth tables that should remain in the main database
 * These handle authentication, user identity, and multi-tenancy management
 */
const CORE_AUTH_TABLES = new Set([
    "users",
    "accounts",
    "sessions",
    "verifications",
    "tenants",
    "invitations",
    "organizations",
    "members",
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
    writeFileSync(tenantSchemaPath, await generateTenantSchemaFile(imports, tenantSchema));

    // Create tenant-specific drizzle config and generate migrations FIRST
    await setupTenantMigrations(projectPath);

    // Write the tenant raw SQL file AFTER migration files exist
    const tenantRawPath = join(projectPath, "src/db/tenant.raw.ts");
    writeFileSync(tenantRawPath, await generateTenantRawFile(imports, tenantSchema, projectPath));

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
 * Generates the tenant schema file content without raw SQL migration statements
 */
async function generateTenantSchemaFile(imports: string, tenantSchema: string[]): Promise<string> {
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
 * Generates the tenant raw SQL file content from actual migration files
 */
async function generateTenantRawFile(imports: string, tenantSchema: string[], projectPath: string): Promise<string> {
    const header = `// Raw SQL statements for creating tenant tables
// This is concatenated from actual migration files for just-in-time deployment
`;

    // Use actual migration files if they exist (follow Drizzle's pattern)
    const migrationSql = await getMigrationSqlFromFiles(projectPath);

    // Fallback to generated SQL if no migration files exist yet
    let rawSqlStatements = migrationSql || (await generateTenantSqlUsingDrizzle(projectPath, tenantSchema, imports));

    // Escape backticks for template literal (always needed for template literal syntax)
    rawSqlStatements = rawSqlStatements.replace(/`/g, "\\`");

    const rawSqlExport = `export const raw = \`${rawSqlStatements}\`;`;

    return [header, rawSqlExport].join("\n");
}

/**
 * Generate migration entries using actual Drizzle content-based hashes
 */
async function generateMigrationEntries(tenantMigrationsDir: string, migrationFiles: string[]): Promise<string> {
    const crypto = await import("crypto");

    try {
        const journalPath = join(tenantMigrationsDir, "meta", "_journal.json");
        if (!existsSync(journalPath)) {
            // Generate content-based hashes if no journal exists
            return migrationFiles
                .map((file, index) => {
                    const filePath = join(tenantMigrationsDir, file);
                    const content = readFileSync(filePath, "utf8");
                    const hash = crypto.createHash("sha256").update(content).digest("hex");
                    return `INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (${index + 1}, '${hash}', ${Date.now()});`;
                })
                .join("\n--> statement-breakpoint\n");
        }

        const journal = JSON.parse(readFileSync(journalPath, "utf8"));
        const entries = journal.entries || [];

        return migrationFiles
            .map((file, index) => {
                const filePath = join(tenantMigrationsDir, file);
                const content = readFileSync(filePath, "utf8");
                const contentHash = crypto.createHash("sha256").update(content).digest("hex");
                const timestamp = entries[index]?.when || Date.now();
                return `INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (${index + 1}, '${contentHash}', ${timestamp});`;
            })
            .join("\n--> statement-breakpoint\n");
    } catch (error) {
        console.warn("Could not generate migration hashes, falling back to filename hashes:", error);
        // Fallback to filename-based hashes
        return migrationFiles
            .map((file, index) => {
                const hash = file.replace(".sql", "");
                return `INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (${index + 1}, '${hash}', ${Date.now()});`;
            })
            .join("\n--> statement-breakpoint\n");
    }
}

/**
 * Reads and concatenates all tenant migration SQL files
 */
async function getMigrationSqlFromFiles(projectPath: string): Promise<string | null> {
    const tenantMigrationsDir = join(projectPath, "drizzle-tenant");

    if (!existsSync(tenantMigrationsDir)) {
        return null;
    }

    try {
        const migrationFiles = readdirSync(tenantMigrationsDir)
            .filter(file => file.endsWith(".sql"))
            .sort((a, b) => a.localeCompare(b));

        if (migrationFiles.length === 0) {
            return null;
        }

        // Read and concatenate all migration files, filtering out foreign key references to users table
        const allSql = migrationFiles
            .map(file => {
                const content = readFileSync(join(tenantMigrationsDir, file), "utf8");
                // Filter out foreign key references to users table since users table is in main DB
                const filteredLines = content
                    .split("\n")
                    .filter(line => !/FOREIGN KEY.*REFERENCES.*`users`/.exec(line));

                // Fix trailing commas that might be left after removing foreign keys
                const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);"); // Remove trailing comma before closing parenthesis

                return fixedContent;
            })
            .join("\n--> statement-breakpoint\n");

        // Add Drizzle's migration tracking table at the beginning
        const drizzleMigrationTable = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at numeric
);`;

        // Generate migration entries using actual Drizzle hashes from meta files
        const migrationEntries = await generateMigrationEntries(tenantMigrationsDir, migrationFiles);

        const combinedSql = `${drizzleMigrationTable}\n--> statement-breakpoint\n${allSql}\n--> statement-breakpoint\n${migrationEntries}`;

        // Don't escape here - let generateTenantRawFile handle escaping
        return combinedSql;
    } catch (error) {
        console.warn("Could not read tenant migration files:", error);
        return null;
    }
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

        // Skip foreign key references to users table (users table is in main DB, not tenant DB)
        if (actualRefTable !== "users") {
            foreignKey = `FOREIGN KEY (\\\`${actualColumnName}\\\`) REFERENCES \\\`${actualRefTable}\\\`(\\\`${refColumn}\\\`) ON UPDATE no action ON DELETE ${onDelete}`;
        }
    }

    return { column: columnSql, foreignKey };
}

/**
 * Sets up tenant-specific migrations by creating drizzle-tenant.config.ts and generating migrations
 */
async function setupTenantMigrations(projectPath: string): Promise<void> {
    // Create drizzle-tenant.config.ts
    const tenantConfigPath = join(projectPath, "drizzle-tenant.config.ts");
    const tenantConfigContent = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./src/db/tenant.schema.ts",
    out: "./drizzle-tenant",
    // Note: Tenant migrations are applied via CLI to individual tenant databases
    // This config is used only for generating migration files
    // Uses same env vars as multi-tenancy plugin for consistency
    ...(process.env.NODE_ENV === "production"
        ? {
              driver: "d1-http",
              dbCredentials: {
                  accountId: process.env.CLOUDFLARE_ACCT_ID,
                  databaseId: "placeholder", // Not used for generation
                  token: process.env.CLOUDFLARE_D1_API_TOKEN,
              },
          }
        : {}),
});
`;

    writeFileSync(tenantConfigPath, tenantConfigContent);

    // Create drizzle-tenant directory if it doesn't exist
    const tenantMigrationsDir = join(projectPath, "drizzle-tenant");
    if (!existsSync(tenantMigrationsDir)) {
        mkdirSync(tenantMigrationsDir, { recursive: true });
    }

    // Generate tenant migrations using drizzle-kit
    try {
        execSync("npx drizzle-kit generate --config=drizzle-tenant.config.ts", {
            cwd: projectPath,
            stdio: "pipe",
        });
    } catch (error) {
        // If generation fails, that's okay - the user can run it manually later
        console.warn(
            "Could not auto-generate tenant migrations. Run 'npx drizzle-kit generate --config=drizzle-tenant.config.ts' manually."
        );
    }
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

    // Create a direct import approach for multi-tenancy projects
    const newSchemaContent = `import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import * as tenantSchema from "./tenant.schema"; // Tenant tables (tenant databases)

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    ...tenantSchema,
} as const;`;

    writeFileSync(schemaPath, newSchemaContent);
}

/**
 * Creates placeholder tenant schema files to prevent import errors
 * This should be called before auth:update to ensure imports don't fail
 */
export function createPlaceholderTenantFiles(projectPath: string): void {
    const authSchemaPath = join(projectPath, "src/db/auth.schema.ts");
    const tenantSchemaPath = join(projectPath, "src/db/tenant.schema.ts");
    const tenantRawPath = join(projectPath, "src/db/tenant.raw.ts");

    // Create placeholder auth.schema.ts if it doesn't exist
    if (!existsSync(authSchemaPath)) {
        const placeholderAuthSchema = `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Core Better Auth tables for main database
// These tables handle authentication, user identity, and multi-tenancy management
// This is a placeholder file - will be generated by the Better Auth CLI

// Minimal placeholder exports to prevent import errors
export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
});`;

        writeFileSync(authSchemaPath, placeholderAuthSchema);
    }

    // Create placeholder tenant.schema.ts if it doesn't exist
    if (!existsSync(tenantSchemaPath)) {
        const placeholderSchema = `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { users } from "./auth.schema";

// Tenant-specific Better Auth tables for tenant databases
// These tables contain tenant-scoped data like sessions, files, and organization data
// This is a placeholder file - will be generated by the migration CLI

// Placeholder exports to prevent import errors
export const userFiles = sqliteTable("user_files", {
    id: text("id").primaryKey(),
});

export const userBirthdays = sqliteTable("user_birthdays", {
    id: text("id").primaryKey(),
});

export const birthdayReminders = sqliteTable("birthday_reminders", {
    id: text("id").primaryKey(),
});

export const birthdayWishs = sqliteTable("birthday_wishs", {
    id: text("id").primaryKey(),
});

// Note: These are minimal placeholders. The actual schema will be generated
// by the Better Auth CLI and then split by the migration process.`;

        writeFileSync(tenantSchemaPath, placeholderSchema);
    }

    // Create placeholder tenant.raw.ts if it doesn't exist
    if (!existsSync(tenantRawPath)) {
        const placeholderRaw = `// Raw SQL statements for creating tenant tables
// This is used for just-in-time migration when creating new tenant databases
// This is a placeholder file - will be generated by the migration CLI

export const raw = \`-- Placeholder tenant schema - will be generated by migration CLI\`;`;

        writeFileSync(tenantRawPath, placeholderRaw);
    }
}

/**
 * Restores the original single auth.schema.ts file (reverses the split)
 */
export function restoreOriginalSchema(projectPath: string): void {
    const tenantSchemaPath = join(projectPath, "src/db/tenant.schema.ts");
    const schemaPath = join(projectPath, "src/db/schema.ts");

    // Remove tenant schema file if it exists
    if (existsSync(tenantSchemaPath)) {
        rmSync(tenantSchemaPath);
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
