#!/usr/bin/env node
import { cancel, confirm, intro, outro, select, spinner } from "@clack/prompts";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import pc from "picocolors";
import { drizzle } from "@zpg6-test-pkgs/drizzle-orm/d1-http";
import { sql } from "@zpg6-test-pkgs/drizzle-orm";

// Simple type definition for Cloudflare D1 API configuration
interface CloudflareD1ApiConfig {
    apiToken: string;
    accountId: string;
    debugLogs?: boolean;
}

/**
 * Apply migrations to a tenant database using drizzle D1-HTTP
 */
async function applyTenantMigrations(
    config: CloudflareD1ApiConfig,
    databaseId: string,
    migrations: string[]
): Promise<void> {
    if (!migrations || migrations.length === 0) {
        return;
    }

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

        // Apply each migration to the tenant database
        for (const migration of migrations) {
            // Split SQL by statement breakpoints and execute each statement
            const statements = migration
                .split("--> statement-breakpoint")
                .map(s => s.trim())
                .filter(s => s.length > 0);

            if (config.debugLogs) {
                console.log(`📋 Executing ${statements.length} SQL statement(s) on tenant database`);
                for (const statement of statements) {
                    console.log(`  > ${statement}`);
                }
            }

            for (const statement of statements) {
                await db.run(sql.raw(statement));
            }
        }
    } catch (error) {
        throw new Error(
            `Failed to apply tenant migrations: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
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
    lastMigrationVersion?: string;
    migrationHistory?: string;
}

interface MigrationFile {
    filename: string;
    version: string;
    content: string;
}

/**
 * Get Cloudflare D1 API configuration from environment variables
 */
function getCloudflareConfig(debugLogs?: boolean): CloudflareD1ApiConfig {
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!apiToken || !accountId) {
        fatal(
            "Missing Cloudflare credentials. Please set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables."
        );
    }

    return { apiToken: apiToken!, accountId: accountId!, debugLogs };
}

/**
 * Load migration files from the drizzle migrations directory
 */
function loadMigrationFiles(projectRoot: string): MigrationFile[] {
    const migrationsDir = join(projectRoot, "drizzle");

    if (!existsSync(migrationsDir)) {
        fatal("No drizzle migrations directory found. Please run 'npm run db:generate' first.");
    }

    const files = readdirSync(migrationsDir)
        .filter(file => file.endsWith(".sql"))
        .sort(); // Sort to ensure proper order

    return files.map(filename => {
        const content = readFileSync(join(migrationsDir, filename), "utf8");
        // Extract version from filename (e.g., "0001_initial.sql" -> "0001")
        const version = filename.split("_")[0];

        return {
            filename,
            version,
            content,
        };
    });
}

/**
 * Get all tenant databases from the main database
 */
async function getTenantDatabases(auth: any, orgPrefix?: string): Promise<TenantDatabase[]> {
    try {
        const adapter = auth.options.database;

        // Build where clause
        const whereClause: any[] = [];

        if (orgPrefix) {
            // Filter by organization prefix
            whereClause.push({ field: "tenantType", value: "organization", operator: "eq" });
            // Add prefix filter for tenantId
            whereClause.push({ field: "tenantId", value: orgPrefix, operator: "startsWith" });
        }

        const tenants = await adapter.findMany({
            model: "tenant",
            where: whereClause.length > 0 ? whereClause : undefined,
        });

        return tenants.filter((tenant: any) => tenant.status === "active");
    } catch (error) {
        throw new Error(
            `Failed to fetch tenant databases: ${error instanceof Error ? error.message : "Unknown error"}`
        );
    }
}

/**
 * Determine which migrations need to be applied to a tenant
 */
function getMigrationsToApply(tenant: TenantDatabase, allMigrations: MigrationFile[]): MigrationFile[] {
    const lastVersion = tenant.lastMigrationVersion || "0000";

    return allMigrations.filter(migration => migration.version > lastVersion);
}

/**
 * Apply migrations to a single tenant database
 */
async function migrateTenant(
    tenant: TenantDatabase,
    migrations: MigrationFile[],
    cloudflareConfig: CloudflareD1ApiConfig,
    auth: any
): Promise<void> {
    if (migrations.length === 0) {
        console.log(pc.gray(`  ✓ ${tenant.tenantId} - Already up to date`));
        return;
    }

    console.log(pc.cyan(`  → ${tenant.tenantId} - Applying ${migrations.length} migration(s)`));

    try {
        // Apply each migration
        const migrationSqls = migrations.map(m => m.content);
        await applyTenantMigrations(cloudflareConfig, tenant.databaseId, migrationSqls);

        // Update migration tracking in main database
        const adapter = auth.options.database;
        const latestVersion = migrations[migrations.length - 1].version;

        // Parse existing migration history
        const existingHistory = tenant.migrationHistory ? JSON.parse(tenant.migrationHistory) : [];

        // Add new migrations to history
        const newHistory = [
            ...existingHistory,
            ...migrations.map(m => ({
                version: m.version,
                name: m.filename,
                appliedAt: new Date().toISOString(),
            })),
        ];

        await adapter.update({
            model: "tenant",
            where: [{ field: "id", value: tenant.id, operator: "eq" }],
            update: {
                lastMigrationVersion: latestVersion,
                migrationHistory: JSON.stringify(newHistory),
            },
        });

        console.log(pc.green(`  ✓ ${tenant.tenantId} - Successfully migrated to version ${latestVersion}`));
    } catch (error) {
        console.log(
            pc.red(
                `  ✗ ${tenant.tenantId} - Migration failed: ${error instanceof Error ? error.message : "Unknown error"}`
            )
        );
        throw error;
    }
}

/**
 * Command to migrate all tenant databases
 */
export async function migrateTenants(): Promise<void> {
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

    // Get Cloudflare configuration
    const cloudflareConfig = getCloudflareConfig();

    // Load migration files
    const migrationSpinner = spinner();
    migrationSpinner.start("Loading migration files...");

    let migrations: MigrationFile[] = [];
    try {
        migrations = loadMigrationFiles(projectRoot);
        migrationSpinner.stop(pc.green(`Found ${migrations.length} migration file(s)`));
    } catch (error) {
        migrationSpinner.stop(pc.red("Failed to load migration files"));
        fatal(`Migration loading failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (migrations.length === 0) {
        outro(pc.yellow("No migration files found. Run 'npm run db:generate' to create migrations."));
        return;
    }

    // Initialize auth to access the database
    const authSpinner = spinner();
    authSpinner.start("Initializing auth configuration...");

    let auth: any;
    try {
        // Import the auth configuration dynamically
        const authModule = await import(join(projectRoot, "src/auth/index.ts"));
        auth = authModule.auth || authModule.default;

        if (!auth) {
            throw new Error("No auth export found in src/auth/index.ts");
        }

        authSpinner.stop(pc.green("Auth configuration loaded"));
    } catch (error) {
        authSpinner.stop(pc.red("Failed to load auth configuration"));
        fatal(`Auth loading failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Ask for organization prefix filter
    const orgPrefix = (await select({
        message: "Which tenants should be migrated?",
        options: [
            { value: "", label: "All tenants" },
            { value: "custom", label: "Organizations with specific prefix" },
        ],
    })) as string;

    let prefixFilter: string | undefined;
    if (orgPrefix === "custom") {
        const customPrefix = (await select({
            message: "Enter organization prefix to filter by:",
            options: [
                { value: "org_", label: "org_ (default organization prefix)" },
                { value: "custom", label: "Enter custom prefix" },
            ],
        })) as string;

        if (customPrefix === "custom") {
            // In a real implementation, you'd use text() prompt here
            // For now, default to org_
            prefixFilter = "org_";
        } else {
            prefixFilter = customPrefix;
        }
    }

    // Get tenant databases
    const tenantSpinner = spinner();
    tenantSpinner.start("Fetching tenant databases...");

    let tenants: TenantDatabase[] = [];
    try {
        tenants = await getTenantDatabases(auth, prefixFilter);
        tenantSpinner.stop(pc.green(`Found ${tenants.length} active tenant database(s)`));
    } catch (error) {
        tenantSpinner.stop(pc.red("Failed to fetch tenant databases"));
        fatal(`Tenant fetching failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (tenants.length === 0) {
        outro(pc.yellow("No active tenant databases found."));
        return;
    }

    // Analyze what needs to be migrated
    const tenantsNeedingMigration = tenants
        .map(tenant => ({
            tenant,
            migrations: getMigrationsToApply(tenant, migrations),
        }))
        .filter(({ migrations }) => migrations.length > 0);

    if (tenantsNeedingMigration.length === 0) {
        outro(pc.green("All tenant databases are already up to date!"));
        return;
    }

    // Show migration plan
    console.log(pc.bold("\nMigration Plan:"));
    tenantsNeedingMigration.forEach(({ tenant, migrations }) => {
        console.log(pc.cyan(`  ${tenant.tenantId}: ${migrations.length} migration(s) to apply`));
        migrations.forEach(m => {
            console.log(pc.gray(`    - ${m.filename}`));
        });
    });

    // Confirm migration
    const shouldProceed = await confirm({
        message: `Apply migrations to ${tenantsNeedingMigration.length} tenant database(s)?`,
        initialValue: false,
    });

    if (!shouldProceed) {
        outro(pc.yellow("Migration cancelled."));
        return;
    }

    // Apply migrations
    console.log(pc.bold("\nApplying migrations:"));

    let successCount = 0;
    let errorCount = 0;

    for (const { tenant, migrations } of tenantsNeedingMigration) {
        try {
            await migrateTenant(tenant, migrations, cloudflareConfig, auth);
            successCount++;
        } catch (error) {
            errorCount++;
            // Continue with other tenants even if one fails
        }
    }

    // Summary
    if (errorCount === 0) {
        outro(pc.green(`✅ Successfully migrated ${successCount} tenant database(s)!`));
    } else {
        outro(
            pc.yellow(
                `⚠️ Migration completed with issues:\n` +
                    `  ✓ ${successCount} successful\n` +
                    `  ✗ ${errorCount} failed\n\n` +
                    `Check the logs above for error details.`
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
if (require.main === module) {
    migrateTenants().catch(err => {
        fatal(String(err?.message ?? err));
    });
}
