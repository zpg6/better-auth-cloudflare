#!/usr/bin/env node
import { cancel, confirm, intro, outro, spinner } from "@clack/prompts";
import { drizzle, migrate } from "@zpg6-test-pkgs/drizzle-orm/d1-http";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import pc from "picocolors";

// Simple type definition for Cloudflare D1 API configuration
interface CloudflareD1ApiConfig {
    apiToken: string;
    accountId: string;
    debugLogs?: boolean;
}

// Configuration for main database access
interface MainDatabaseConfig {
    apiToken: string;
    accountId: string;
    databaseId: string;
    debugLogs?: boolean;
}

/**
 * Apply migrations to a tenant database using drizzle D1-HTTP migrator
 */
async function applyTenantMigrations(
    config: CloudflareD1ApiConfig,
    databaseId: string,
    migrationsFolder: string,
    retryCount: number = 2
): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            // Create D1-HTTP connection
            const db = drizzle(
                {
                    accountId: config.accountId,
                    databaseId: databaseId,
                    token: config.apiToken,
                },
                {
                    logger: config.debugLogs,
                }
            );

            if (config.debugLogs) {
                console.log(`📋 Running migrations from ${migrationsFolder} (attempt ${attempt}/${retryCount})`);
            }

            // Use the built-in migrator - this will handle user prompts automatically
            await migrate(db, { migrationsFolder });

            // If we get here, the migration was successful
            return;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Check if this is a non-fatal error that should trigger retry
            const isRetryable = isRetryableError(lastError);

            if (attempt < retryCount && isRetryable) {
                if (config.debugLogs) {
                    console.log(`⚠️ Migration attempt ${attempt} failed with retryable error, retrying...`);
                }
                // Wait a bit before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
            } else if (!isRetryable) {
                // Don't retry for non-retryable errors
                break;
            }
        }
    }

    throw new Error(
        `Failed to apply tenant migrations after ${retryCount} attempts: ${lastError?.message || "Unknown error"}`
    );
}

/**
 * Determine if an error is retryable (network issues, temporary failures)
 */
function isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
        message.includes("network") ||
        message.includes("timeout") ||
        message.includes("rate limit") ||
        message.includes("temporary") ||
        message.includes("503") ||
        message.includes("502") ||
        message.includes("429")
    );
}

// Get package version from package.json
function getPackageVersion(): string {
    try {
        const packagePath = join(__dirname, "..", "..", "package.json");
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
        return packageJson.version as string;
    } catch {
        return "unknown";
    }
}

function fatal(message: string) {
    outro(pc.red(message));
    console.log(pc.gray("\nNeed help?"));
    console.log(pc.cyan("  Get help: npx @better-auth-cloudflare/cli --help"));
    console.log(pc.cyan("  Report issues: https://github.com/zpg6/better-auth-cloudflare/issues"));
    process.exit(1);
}

interface TenantDatabase {
    id: string;
    tenantId: string;
    tenantType: string;
    databaseName: string;
    databaseId: string;
    status: string;
    lastMigrationCheck?: string;
}

interface MigrationFile {
    filename: string;
    version: string;
    content: string;
}

/**
 * Get Cloudflare D1 API configuration from environment variables
 * Uses the same variables as the multitenancy plugin configuration
 */
function getCloudflareConfig(debugLogs?: boolean): CloudflareD1ApiConfig {
    const apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCT_ID;

    if (!apiToken || !accountId) {
        fatal(
            "Missing Cloudflare multitenancy credentials.\n" +
                "Please set the following environment variables:\n" +
                "  CLOUDFLARE_D1_API_TOKEN - API token with D1:edit permissions for tenant account\n" +
                "  CLOUDFLARE_ACCT_ID - Account ID where tenant databases are managed\n\n" +
                "These should match your multitenancy plugin configuration and may be\n" +
                "different from your main CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."
        );
    }

    return { apiToken: apiToken!, accountId: accountId!, debugLogs };
}

/**
 * Get main database configuration from environment variables
 * These can be the same as tenant config or separate for different accounts
 */
function getMainDatabaseConfig(debugLogs?: boolean): MainDatabaseConfig {
    // Try main database specific env vars first, fall back to tenant vars for same-account setups
    const apiToken = process.env.CLOUDFLARE_MAIN_D1_API_TOKEN || process.env.CLOUDFLARE_D1_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_MAIN_ACCT_ID || process.env.CLOUDFLARE_ACCT_ID;
    const databaseId = process.env.CLOUDFLARE_MAIN_DATABASE_ID || process.env.CLOUDFLARE_DATABASE_ID;

    if (!apiToken || !accountId || !databaseId) {
        fatal(
            "Missing main database credentials.\n" +
                "Please set the following environment variables:\n" +
                "  CLOUDFLARE_MAIN_D1_API_TOKEN (or CLOUDFLARE_D1_API_TOKEN) - API token for main database\n" +
                "  CLOUDFLARE_MAIN_ACCT_ID (or CLOUDFLARE_ACCT_ID) - Account ID for main database\n" +
                "  CLOUDFLARE_MAIN_DATABASE_ID (or CLOUDFLARE_DATABASE_ID) - Main database ID\n\n" +
                "Use MAIN_ prefixed vars if main and tenant databases are in different accounts."
        );
    }

    return { apiToken: apiToken!, accountId: accountId!, databaseId: databaseId!, debugLogs };
}

/**
 * Check if tenant migrations directory exists
 */
function checkTenantMigrationsExist(projectRoot: string): boolean {
    const migrationsDir = join(projectRoot, "drizzle-tenant");
    return existsSync(migrationsDir) && readdirSync(migrationsDir).some(file => file.endsWith(".sql"));
}

/**
 * Get all tenant databases from the main database using direct D1-HTTP client
 */
async function getTenantDatabases(mainDbConfig: MainDatabaseConfig): Promise<TenantDatabase[]> {
    try {
        // Create direct D1-HTTP connection to main database
        const mainDb = drizzle(
            {
                accountId: mainDbConfig.accountId,
                databaseId: mainDbConfig.databaseId,
                token: mainDbConfig.apiToken,
            },
            {
                logger: mainDbConfig.debugLogs,
            }
        );

        // Query tenants table directly using raw SQL
        const rawTenants = await mainDb.all(`SELECT * FROM tenants WHERE status = 'active'`);

        if (mainDbConfig.debugLogs) {
            console.log("🔍 Raw tenant query result:", JSON.stringify(rawTenants, null, 2));
        }

        // Map snake_case columns to camelCase for our interface
        const tenants = (rawTenants as any[]).map(tenant => ({
            id: tenant.id,
            tenantId: tenant.tenant_id,
            tenantType: tenant.tenant_type,
            databaseName: tenant.database_name,
            databaseId: tenant.database_id,
            status: tenant.status,
            lastMigrationCheck: tenant.last_migration_version, // Use the actual column name
        }));

        return tenants as TenantDatabase[];
    } catch (error) {
        throw new Error(
            `Failed to fetch tenant databases: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}

/**
 * Apply migrations to a single tenant database using Drizzle's built-in migrator
 */
async function migrateTenant(
    tenant: TenantDatabase,
    cloudflareConfig: CloudflareD1ApiConfig,
    mainDbConfig: MainDatabaseConfig,
    migrationsFolder: string
): Promise<{ success: boolean; error?: string }> {
    console.log(pc.cyan(`  → ${tenant.tenantId} - Checking for migrations`));

    // Update status to indicate migration in progress
    const statusUpdateSuccess = await updateTenantStatus(tenant, mainDbConfig, "migrating");

    try {
        // Apply migrations using built-in migrator with retry logic (up to 2 retries)
        await applyTenantMigrations(cloudflareConfig, tenant.databaseId, migrationsFolder, 2);

        // Update status to success in main database
        const finalUpdateSuccess = await updateTenantStatus(tenant, mainDbConfig, "active", {
            lastMigratedAt: new Date().toISOString(),
        });

        if (!statusUpdateSuccess || !finalUpdateSuccess) {
            console.log(pc.yellow(`  ⚠️ ${tenant.tenantId} - Migrations applied but status update failed`));
            return { success: false, error: "Status update failed" };
        }

        console.log(pc.green(`  ✓ ${tenant.tenantId} - Migrations applied successfully`));
        return { success: true };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.log(pc.red(`  ✗ ${tenant.tenantId} - Migration failed: ${errorMessage}`));

        // Update status to indicate failure
        await updateTenantStatus(tenant, mainDbConfig, "migration_failed", {
            lastMigratedAt: new Date().toISOString(),
        });

        return { success: false, error: errorMessage };
    }
}

/**
 * Update tenant status in main database
 */
async function updateTenantStatus(
    tenant: TenantDatabase,
    mainDbConfig: MainDatabaseConfig,
    status: string,
    additionalFields?: Record<string, any>
): Promise<boolean> {
    try {
        // Create direct D1-HTTP connection to main database
        const mainDb = drizzle(
            {
                accountId: mainDbConfig.accountId,
                databaseId: mainDbConfig.databaseId,
                token: mainDbConfig.apiToken,
            },
            {
                logger: mainDbConfig.debugLogs,
            }
        );

        // Build SET clause dynamically with snake_case column names
        const setFields = [`status = '${status}'`];

        if (additionalFields) {
            for (const [key, value] of Object.entries(additionalFields)) {
                // Convert camelCase to snake_case for database columns
                const dbColumn = key.replace(/([A-Z])/g, "_$1").toLowerCase();

                if (typeof value === "string") {
                    setFields.push(`${dbColumn} = '${value.replace(/'/g, "''")}'`); // Escape single quotes
                } else if (typeof value === "number") {
                    setFields.push(`${dbColumn} = ${value}`);
                } else if (value === null) {
                    setFields.push(`${dbColumn} = NULL`);
                }
            }
        }

        // Update tenant status using raw SQL
        const updateQuery = `UPDATE tenants SET ${setFields.join(", ")} WHERE id = '${tenant.id}'`;

        if (mainDbConfig.debugLogs) {
            console.log(`🔧 Status update query: ${updateQuery}`);
        }

        const result = await mainDb.run(updateQuery);

        if (mainDbConfig.debugLogs) {
            console.log(`🔧 Update result:`, JSON.stringify(result, null, 2));
        }

        return true;
    } catch (error) {
        console.warn(
            pc.yellow(
                `⚠️ Failed to update tenant ${tenant.tenantId} status: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
        return false;
    }
}

interface MigrateTenantsArgs {
    verbose?: boolean;
    autoConfirm?: boolean;
    dryRun?: boolean;
}

/**
 * Parse CLI arguments for migrate-tenants command
 */
export function parseMigrateTenantsArgs(argv: string[]): MigrateTenantsArgs {
    const args: MigrateTenantsArgs = {};

    for (const arg of argv) {
        if (arg === "--verbose" || arg === "-v") {
            args.verbose = true;
        } else if (arg === "--auto-confirm" || arg === "-y") {
            args.autoConfirm = true;
        } else if (arg === "--dry-run") {
            args.dryRun = true;
        }
    }

    return args;
}

/**
 * Command to migrate all tenant databases
 */
export async function migrateTenants(cliArgs?: MigrateTenantsArgs): Promise<void> {
    const version = getPackageVersion();
    intro(`${pc.bold("Better Auth Cloudflare")} ${pc.gray("v" + version + " · migrate:tenants")}`);

    // Check if we're in a project directory
    const projectRoot = process.cwd();
    const wranglerPath = join(projectRoot, "wrangler.toml");
    if (!existsSync(wranglerPath)) {
        fatal("No wrangler.toml found. Please run this command from a Cloudflare Workers project directory.");
    }

    // Check if auth configuration exists
    const authPath = join(projectRoot, "src/auth/index.ts");
    if (!existsSync(authPath)) {
        fatal("Auth configuration not found at src/auth/index.ts");
    }

    // Get Cloudflare configuration for tenant operations
    const cloudflareConfig = getCloudflareConfig(cliArgs?.verbose);

    // Get main database configuration
    const mainDbConfig = getMainDatabaseConfig(cliArgs?.verbose);

    // Check if tenant migrations exist
    if (!checkTenantMigrationsExist(projectRoot)) {
        outro(pc.yellow("No tenant migration files found. Run the migrate command first to set up tenant migrations."));
        return;
    }

    // Get tenant databases from main database
    const tenantSpinner = spinner();
    tenantSpinner.start("Fetching tenant databases...");

    let tenants: TenantDatabase[] = [];
    try {
        tenants = await getTenantDatabases(mainDbConfig);
        tenantSpinner.stop(pc.green(`Found ${tenants.length} tenant database(s)`));
    } catch (error) {
        tenantSpinner.stop(pc.red("Failed to fetch tenant databases"));
        fatal(`Tenant fetching failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (tenants.length === 0) {
        outro(pc.yellow("No active tenant databases found."));
        return;
    }

    // Show migration plan (Drizzle will determine what needs to be applied)
    console.log(pc.bold("\nMigration Plan:"));
    console.log(pc.gray(`Will check and apply any pending migrations to ${tenants.length} tenant database(s):`));
    tenants.forEach(tenant => {
        console.log(pc.cyan(`  ${tenant.tenantId} (${tenant.databaseName})`));
    });

    // Handle dry-run mode
    if (cliArgs?.dryRun) {
        console.log(pc.blue("\n🔍 DRY RUN MODE - No changes will be applied"));
        outro(pc.green(`✅ Dry run completed. ${tenants.length} tenant database(s) would be checked for migrations.`));
        return;
    }

    // Confirm migration
    let shouldProceed = cliArgs?.autoConfirm || false;

    if (!shouldProceed) {
        const confirmation = await confirm({
            message: `Check and apply migrations to ${tenants.length} tenant database(s)?`,
            initialValue: false,
        });

        if (typeof confirmation === "symbol") {
            // User cancelled with Ctrl+C
            outro(pc.yellow("Migration cancelled."));
            return;
        }

        shouldProceed = confirmation;
    } else {
        console.log(pc.green(`Auto-confirming migration check for ${tenants.length} tenant database(s)...`));
    }

    if (!shouldProceed) {
        outro(pc.yellow("Migration cancelled."));
        return;
    }

    // Apply migrations database by database
    console.log(pc.bold("\nApplying migrations:"));

    let successCount = 0;
    let errorCount = 0;
    const migrationsFolder = join(projectRoot, "drizzle-tenant");

    for (const tenant of tenants) {
        const result = await migrateTenant(tenant, cloudflareConfig, mainDbConfig, migrationsFolder);

        if (result.success) {
            successCount++;
        } else {
            errorCount++;

            if (cliArgs?.verbose && result.error) {
                console.log(pc.gray(`    Error details: ${result.error}`));
            }
        }

        // Continue with other tenants even if one fails
    }

    // Minimal final report
    if (errorCount === 0) {
        outro(pc.green(`✅ ${successCount} of ${successCount} tenant databases migrated successfully`));
    } else {
        outro(
            pc.yellow(
                `⚠️ ${successCount} of ${tenants.length} tenant databases migrated successfully (${errorCount} failed)`
            )
        );
    }
}

// Handle cancellation
process.on("SIGINT", () => {
    cancel("Operation cancelled.");
    process.exit(0);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    migrateTenants().catch(err => {
        fatal(String(err?.message ?? err));
    });
}
