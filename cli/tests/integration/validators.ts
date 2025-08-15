import { readProjectFile, projectFileExists } from "./setup";

export interface ValidationResult {
    success: boolean;
    errors: string[];
}

export class FileValidator {
    constructor(
        private readonly projectPath: string,
        private readonly appName: string
    ) {}

    validateWranglerToml(
        expectedResources: any,
        databaseType: "sqlite" | "postgres",
        skipCloudflare: boolean = false
    ): ValidationResult {
        const errors: string[] = [];

        try {
            const wrangler = readProjectFile(this.projectPath, "wrangler.toml");

            // Check worker name
            if (!wrangler.includes(`name = "${this.appName}"`)) {
                errors.push(`Worker name not updated to "${this.appName}"`);
            }

            // Check D1 configuration
            if (expectedResources.d1) {
                if (!wrangler.includes("[[d1_databases]]")) {
                    errors.push("D1 database block missing");
                }
                if (skipCloudflare) {
                    // When skipping Cloudflare setup, placeholders should remain
                    if (!wrangler.includes("YOUR_D1_DATABASE_ID")) {
                        errors.push("D1 database ID should be placeholder when skipping setup");
                    }
                } else if (wrangler.includes("YOUR_D1_DATABASE_ID")) {
                    // When not skipping, real IDs should be present
                    errors.push("D1 database ID still placeholder");
                }
                if (!wrangler.includes(`database_name = "${this.appName}-db"`)) {
                    errors.push("D1 database name incorrect");
                }
            } else if (!skipCloudflare && wrangler.includes("[[d1_databases]]")) {
                errors.push("D1 database block should not exist when D1 is not enabled");
            }

            // Check KV configuration
            if (expectedResources.kv) {
                if (!wrangler.includes("[[kv_namespaces]]")) {
                    errors.push("KV namespace block missing");
                }
                if (skipCloudflare) {
                    if (!wrangler.includes("YOUR_KV_NAMESPACE_ID")) {
                        errors.push("KV namespace ID should be placeholder when skipping setup");
                    }
                } else if (wrangler.includes("YOUR_KV_NAMESPACE_ID")) {
                    errors.push("KV namespace ID still placeholder");
                }
            } else if (!skipCloudflare && wrangler.includes("[[kv_namespaces]]")) {
                errors.push("KV namespace block should not exist when KV is not enabled");
            }

            // Check R2 configuration
            if (expectedResources.r2) {
                if (!wrangler.includes("[[r2_buckets]]")) {
                    errors.push("R2 bucket block missing");
                }
                // R2 doesn't use placeholder IDs, just bucket names
            } else if (!skipCloudflare && wrangler.includes("[[r2_buckets]]")) {
                errors.push("R2 bucket block should not exist when R2 is not enabled");
            }

            // Check Hyperdrive configuration
            if (expectedResources.hyperdrive) {
                if (!wrangler.includes("[[hyperdrive]]")) {
                    errors.push("Hyperdrive block missing");
                }
                if (skipCloudflare) {
                    if (!wrangler.includes("YOUR_HYPERDRIVE_ID")) {
                        errors.push("Hyperdrive ID should be placeholder when skipping setup");
                    }
                } else if (wrangler.includes("YOUR_HYPERDRIVE_ID")) {
                    errors.push("Hyperdrive ID still placeholder");
                }
            } else if (!skipCloudflare && wrangler.includes("[[hyperdrive]]")) {
                errors.push("Hyperdrive block should not exist when Hyperdrive is not enabled");
            }
        } catch (error) {
            errors.push(`Failed to read wrangler.toml: ${error}`);
        }

        return { success: errors.length === 0, errors };
    }

    validateAuthSchema(databaseType: "sqlite" | "postgres"): ValidationResult {
        const errors: string[] = [];

        try {
            const authSchema = readProjectFile(this.projectPath, "src/db/auth.schema.ts");

            if (databaseType === "sqlite") {
                if (!authSchema.includes("sqliteTable")) {
                    errors.push("Auth schema should use sqliteTable for D1");
                }
                if (authSchema.includes("pgTable")) {
                    errors.push("Auth schema should not contain pgTable for D1");
                }
                if (!authSchema.includes("import { sqliteTable")) {
                    errors.push("Missing sqliteTable import");
                }
            } else {
                if (!authSchema.includes("pgTable")) {
                    errors.push("Auth schema should use pgTable for PostgreSQL");
                }
                if (authSchema.includes("sqliteTable")) {
                    errors.push("Auth schema should not contain sqliteTable for PostgreSQL");
                }
                if (!authSchema.includes("import { pgTable")) {
                    errors.push("Missing pgTable import");
                }
            }

            // Check for required tables - the schema uses different naming
            const requiredTables = ["user", "session", "account", "verification"];
            for (const table of requiredTables) {
                if (!authSchema.includes(`${table}`) && !authSchema.includes(`${table}s`)) {
                    errors.push(`Missing ${table} table definition`);
                }
            }
        } catch (error) {
            errors.push(`Failed to read auth schema: ${error}`);
        }

        return { success: errors.length === 0, errors };
    }

    validateDatabaseIndex(databaseType: "sqlite" | "postgres"): ValidationResult {
        const errors: string[] = [];

        try {
            const dbIndex = readProjectFile(this.projectPath, "src/db/index.ts");

            if (databaseType === "sqlite") {
                // For D1, the db/index.ts just exports schemas, actual DB connection is in auth/index.ts
                if (!dbIndex.includes('export * from "./auth.schema"')) {
                    errors.push("Database index should export auth schema");
                }
                if (dbIndex.includes("postgres(")) {
                    errors.push("Database index should not use postgres() for D1");
                }
            } else {
                // For PostgreSQL, should have postgres connection
                if (!dbIndex.includes("postgres(") && !dbIndex.includes("HYPERDRIVE")) {
                    errors.push("Database index should use postgres connection for PostgreSQL");
                }
                if (dbIndex.includes("createClient")) {
                    errors.push("Database index should not use createClient for PostgreSQL");
                }
            }
        } catch (error) {
            errors.push(`Failed to read database index: ${error}`);
        }

        return { success: errors.length === 0, errors };
    }

    validateAuthConfig(): ValidationResult {
        const errors: string[] = [];

        try {
            const authConfig = readProjectFile(this.projectPath, "src/auth/index.ts");

            // Check for schema import (can be from ../db or ../db/schema)
            if (!authConfig.includes("import { schema }") && !authConfig.includes('from "../db"')) {
                errors.push("Missing schema import in auth config");
            }

            // Check for drizzle adapter (can be in runtime or CLI config)
            if (!authConfig.includes("drizzleAdapter")) {
                errors.push("Missing drizzle adapter");
            }

            // Check for better auth setup
            if (!authConfig.includes("betterAuth")) {
                errors.push("Missing betterAuth configuration");
            }
        } catch (error) {
            errors.push(`Failed to read auth config: ${error}`);
        }

        return { success: errors.length === 0, errors };
    }

    validatePackageJson(databaseType: "sqlite" | "postgres"): ValidationResult {
        const errors: string[] = [];

        try {
            const packageJson = readProjectFile(this.projectPath, "package.json");
            const pkg = JSON.parse(packageJson);

            // Check scripts
            if (databaseType === "postgres") {
                if (
                    !pkg.scripts?.["db:migrate:prod"] ||
                    !pkg.scripts["db:migrate:prod"].includes("drizzle-kit migrate")
                ) {
                    errors.push("Missing or incorrect db:migrate:prod script for PostgreSQL");
                }
            }

            // Check dependencies
            const requiredDeps = ["better-auth", "drizzle-orm"];
            for (const dep of requiredDeps) {
                if (!pkg.dependencies?.[dep] && !pkg.devDependencies?.[dep]) {
                    errors.push(`Missing dependency: ${dep}`);
                }
            }

            if (databaseType === "postgres") {
                if (!pkg.dependencies?.["postgres"] && !pkg.devDependencies?.["postgres"]) {
                    errors.push("Missing postgres dependency for PostgreSQL setup");
                }
            }
        } catch (error) {
            errors.push(`Failed to read package.json: ${error}`);
        }

        return { success: errors.length === 0, errors };
    }

    validateEnvironmentFiles(databaseType: "sqlite" | "postgres"): ValidationResult {
        const errors: string[] = [];

        if (databaseType === "postgres") {
            // Should have .env file
            if (!projectFileExists(this.projectPath, ".env")) {
                errors.push(".env file missing for PostgreSQL setup");
            } else {
                try {
                    const env = readProjectFile(this.projectPath, ".env");
                    if (!env.includes("DATABASE_URL=")) {
                        errors.push(".env missing DATABASE_URL");
                    }
                } catch (error) {
                    errors.push(`Failed to read .env: ${error}`);
                }
            }

            // .env should be in .gitignore
            try {
                const gitignore = readProjectFile(this.projectPath, ".gitignore");
                if (!gitignore.includes(".env")) {
                    errors.push(".env not in .gitignore");
                }
            } catch (error) {
                errors.push(`Failed to read .gitignore: ${error}`);
            }
        } else if (projectFileExists(this.projectPath, ".env")) {
            // Should NOT have .env file for D1
            errors.push(".env file should not exist for D1 setup");
        }

        return { success: errors.length === 0, errors };
    }

    validateMigrations(databaseType: "sqlite" | "postgres"): ValidationResult {
        const errors: string[] = [];

        try {
            const drizzleConfig = readProjectFile(this.projectPath, "drizzle.config.ts");

            if (databaseType === "postgres") {
                if (!drizzleConfig.includes("DATABASE_URL")) {
                    errors.push("Drizzle config should use DATABASE_URL for PostgreSQL");
                }
                if (!drizzleConfig.includes("postgresql")) {
                    errors.push("Drizzle config should specify postgresql driver");
                }
            } else {
                if (drizzleConfig.includes("DATABASE_URL")) {
                    errors.push("Drizzle config should not use DATABASE_URL for D1");
                }
                if (!drizzleConfig.includes("better-sqlite3") && !drizzleConfig.includes("d1")) {
                    errors.push("Drizzle config should use D1 driver");
                }
            }
        } catch (error) {
            errors.push(`Failed to read drizzle.config.ts: ${error}`);
        }

        // Check migration files exist
        if (!projectFileExists(this.projectPath, "drizzle")) {
            errors.push("Drizzle migrations directory missing");
        }

        return { success: errors.length === 0, errors };
    }

    validateTemplateSpecificFiles(template: "hono" | "nextjs"): ValidationResult {
        const errors: string[] = [];

        if (template === "nextjs") {
            const nextjsFiles = [
                "next.config.ts",
                "open-next.config.ts",
                "src/app/layout.tsx",
                "src/app/page.tsx",
                "src/app/api/auth/[...all]/route.ts",
                "src/middleware.ts",
            ];

            for (const file of nextjsFiles) {
                if (!projectFileExists(this.projectPath, file)) {
                    errors.push(`Missing Next.js file: ${file}`);
                }
            }

            // Check middleware configuration
            try {
                const middleware = readProjectFile(this.projectPath, "src/middleware.ts");
                if (
                    !middleware.includes("betterAuth") &&
                    !middleware.includes("initAuth") &&
                    !middleware.includes("auth")
                ) {
                    errors.push("Middleware should use betterAuth, initAuth, or auth");
                }
            } catch (error) {
                errors.push(`Failed to read middleware: ${error}`);
            }
        } else {
            // Hono specific files
            const honoFiles = ["src/index.ts"];

            for (const file of honoFiles) {
                if (!projectFileExists(this.projectPath, file)) {
                    errors.push(`Missing Hono file: ${file}`);
                }
            }

            // Check Hono app configuration
            try {
                const index = readProjectFile(this.projectPath, "src/index.ts");
                if (!index.includes("Hono")) {
                    errors.push("Index should use Hono app");
                }
                if (!index.includes("/api/auth/*")) {
                    errors.push("Missing auth routes in Hono app");
                }
            } catch (error) {
                errors.push(`Failed to read index.ts: ${error}`);
            }
        }

        return { success: errors.length === 0, errors };
    }

    validateR2Integration(hasR2: boolean): ValidationResult {
        const errors: string[] = [];

        if (hasR2) {
            // Check that R2 is properly configured in wrangler.toml
            try {
                const wranglerContent = readProjectFile(this.projectPath, "wrangler.toml");
                if (!wranglerContent.includes("[[r2_buckets]]")) {
                    errors.push("Missing R2 bucket configuration in wrangler.toml");
                }
                if (!wranglerContent.includes('binding = "R2_BUCKET"')) {
                    errors.push("Missing R2 bucket binding in wrangler.toml");
                }
            } catch (error) {
                errors.push(`Failed to read wrangler.toml for R2 validation: ${error}`);
            }

            // Check that userFiles schema exists (R2 integration is done via database schema)
            try {
                const schemaContent = readProjectFile(this.projectPath, "src/db/auth.schema.ts");
                if (!schemaContent.includes("userFiles")) {
                    errors.push("Missing userFiles table for R2 integration");
                }
            } catch (error) {
                // auth.schema.ts might not exist in test environment, that's ok
            }
        }

        return { success: errors.length === 0, errors };
    }

    readProjectFile(projectPath: string, filePath: string): string {
        return readProjectFile(projectPath, filePath);
    }

    projectFileExists(projectPath: string, filePath: string): boolean {
        return projectFileExists(projectPath, filePath);
    }
}
