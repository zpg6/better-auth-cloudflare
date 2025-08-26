#!/usr/bin/env node
import { cancel, intro, outro, spinner } from "@clack/prompts";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import pc from "picocolors";
import { detectMultiTenancy, splitAuthSchema } from "../lib/tenant-migration-generator.js";

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

/**
 * Command to generate tenant-specific migrations for multi-tenancy setups
 */
export async function generateTenantMigrations(): Promise<void> {
    const version = getPackageVersion();
    intro(`${pc.bold("Better Auth Cloudflare")} ${pc.gray("v" + version + " · generate-tenant-migrations")}`);

    // Check if we're in a project directory by looking for wrangler.toml
    const wranglerPath = join(process.cwd(), "wrangler.toml");
    if (!existsSync(wranglerPath)) {
        fatal("No wrangler.toml found. Please run this command from a Cloudflare Workers project directory.");
    }

    // Check if auth schema exists
    const authSchemaPath = join(process.cwd(), "src/db/auth.schema.ts");
    if (!existsSync(authSchemaPath)) {
        fatal("auth.schema.ts not found. Please run 'npm run auth:update' first to generate the auth schema.");
    }

    // Check if multi-tenancy is enabled
    if (!detectMultiTenancy(process.cwd())) {
        fatal("Multi-tenancy not detected in your auth configuration. This command is only for multi-tenant setups.");
    }

    const splitSpinner = spinner();
    splitSpinner.start("Splitting auth schema for multi-tenancy...");

    try {
        await splitAuthSchema(process.cwd());
        splitSpinner.stop(pc.green("Schema successfully split!"));

        outro(
            pc.green("✅ Tenant migration setup complete!\n\n") +
                pc.bold("Files created:\n") +
                pc.cyan("  • src/db/auth.schema.ts") +
                pc.gray(" - Core auth tables (main database)\n") +
                pc.cyan("  • src/db/tenant.schema.ts") +
                pc.gray(" - Tenant-specific tables (tenant databases)\n\n") +
                pc.bold("Next steps:\n") +
                pc.gray("  1. Run ") +
                pc.cyan("npm run db:generate") +
                pc.gray(" to create migrations\n") +
                pc.gray("  2. Apply core migrations to main DB: ") +
                pc.cyan("npm run db:migrate:dev") +
                pc.gray("\n") +
                pc.gray("  3. Tenant migrations will be applied automatically when tenant DBs are created")
        );
    } catch (error) {
        splitSpinner.stop(pc.red("Failed to split auth schema."));
        fatal(`Schema splitting failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// Handle cancellation
process.on("SIGINT", () => {
    cancel("Operation cancelled.");
    process.exit(0);
});

// Run if called directly
if (require.main === module) {
    generateTenantMigrations().catch(err => {
        fatal(String(err?.message ?? err));
    });
}
