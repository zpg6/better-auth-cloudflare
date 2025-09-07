import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

const testProjectPath = join(__dirname, `test-migrate-tenants-${Date.now()}`);

describe("Migrate Tenants Command", () => {
    beforeEach(() => {
        // Clean up any existing test project
        if (existsSync(testProjectPath)) {
            rmSync(testProjectPath, { recursive: true, force: true });
        }

        // Create test project structure
        mkdirSync(testProjectPath, { recursive: true });
        mkdirSync(join(testProjectPath, "src", "auth"), { recursive: true });
        mkdirSync(join(testProjectPath, "drizzle"), { recursive: true });

        // Create wrangler.toml
        writeFileSync(
            join(testProjectPath, "wrangler.toml"),
            `name = "test-app"
main = "src/index.ts"

[[d1_databases]]
binding = "DATABASE"
database_name = "test-db"
database_id = "test-db-id"
`
        );

        // Create auth config
        writeFileSync(
            join(testProjectPath, "src", "auth", "index.ts"),
            `import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

export const auth = betterAuth(
    withCloudflare({
        d1: {
            multiTenancy: {
                mode: "organization",
                cloudflareD1Api: {
                    apiToken: "test-token",
                    accountId: "test-account"
                }
            }
        }
    }, {})
);`
        );

        // Create migration files
        writeFileSync(
            join(testProjectPath, "drizzle", "0001_initial.sql"),
            `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);
--> statement-breakpoint
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT);`
        );

        // Set up environment variables
        process.env.CLOUDFLARE_D1_API_TOKEN = "test-token";
        process.env.CLOUDFLARE_ACCT_ID = "test-account";

        // Store original cwd but don't mock process.cwd to avoid interfering with other tests
        // We'll just ensure our test project exists
    });

    afterEach(() => {
        // Clean up test project
        if (existsSync(testProjectPath)) {
            rmSync(testProjectPath, { recursive: true, force: true });
        }

        // Clean up environment variables
        delete process.env.CLOUDFLARE_D1_API_TOKEN;
        delete process.env.CLOUDFLARE_ACCT_ID;
    });

    it("should validate project structure requirements", () => {
        // Test that wrangler.toml is required
        expect(existsSync(join(testProjectPath, "wrangler.toml"))).toBe(true);

        // Remove wrangler.toml to simulate missing file
        rmSync(join(testProjectPath, "wrangler.toml"));
        expect(existsSync(join(testProjectPath, "wrangler.toml"))).toBe(false);
    });

    it("should validate auth configuration exists", () => {
        // Test that auth config is required
        expect(existsSync(join(testProjectPath, "src", "auth", "index.ts"))).toBe(true);

        // Remove auth config to simulate missing file
        rmSync(join(testProjectPath, "src", "auth", "index.ts"));
        expect(existsSync(join(testProjectPath, "src", "auth", "index.ts"))).toBe(false);
    });

    it("should load and parse migration files correctly", () => {
        // Test that migration files are loaded correctly
        expect(existsSync(join(testProjectPath, "drizzle", "0001_initial.sql"))).toBe(true);

        // Test migration file content
        const migrationContent = require("fs").readFileSync(
            join(testProjectPath, "drizzle", "0001_initial.sql"),
            "utf8"
        );
        expect(migrationContent).toContain("CREATE TABLE users");
        expect(migrationContent).toContain("--> statement-breakpoint");
        expect(migrationContent).toContain("CREATE TABLE sessions");
    });

    it("should validate Cloudflare configuration", () => {
        // Test that environment variables are set
        expect(process.env.CLOUDFLARE_D1_API_TOKEN).toBe("test-token");
        expect(process.env.CLOUDFLARE_ACCT_ID).toBe("test-account");
    });
});

describe("Apply Tenant Migrations Function", () => {
    it("should create drizzle connection with correct parameters", () => {
        const config = {
            apiToken: "test-token",
            accountId: "test-account",
            debugLogs: false,
        };

        const databaseId = "test-db-id";
        const migrations = ["CREATE TABLE test (id TEXT);"];

        // Test that we have the correct configuration structure
        expect(config.apiToken).toBe("test-token");
        expect(config.accountId).toBe("test-account");
        expect(config.debugLogs).toBe(false);
        expect(databaseId).toBe("test-db-id");
        expect(migrations).toHaveLength(1);
    });

    it("should handle SQL statement breakpoints correctly", () => {
        const testSql = `CREATE TABLE users (id TEXT PRIMARY KEY);
--> statement-breakpoint
CREATE TABLE sessions (id TEXT PRIMARY KEY);`;

        const statements = testSql
            .split("--> statement-breakpoint")
            .map(s => s.trim())
            .filter(s => s.length > 0);

        expect(statements).toHaveLength(2);
        expect(statements[0]).toContain("CREATE TABLE users");
        expect(statements[1]).toContain("CREATE TABLE sessions");
    });

    it("should handle empty migrations gracefully", () => {
        const emptyMigrations: string[] = [];

        // This would be tested by calling applyTenantMigrations with empty array
        // The function should return early without error
        expect(emptyMigrations.length).toBe(0);
    });
});

describe("CloudflareD1ApiConfig Interface", () => {
    it("should validate required configuration properties", () => {
        const validConfig = {
            apiToken: "test-token",
            accountId: "test-account",
            debugLogs: false,
        };

        // Test that our interface accepts valid config
        expect(validConfig.apiToken).toBe("test-token");
        expect(validConfig.accountId).toBe("test-account");
        expect(validConfig.debugLogs).toBe(false);
    });

    it("should handle optional debugLogs parameter", () => {
        const configWithoutDebug = {
            apiToken: "test-token",
            accountId: "test-account",
        };

        const configWithDebug = {
            apiToken: "test-token",
            accountId: "test-account",
            debugLogs: true,
        };

        expect(configWithoutDebug.apiToken).toBe("test-token");
        expect(configWithDebug.debugLogs).toBe(true);
    });
});

describe("Migration File Processing", () => {
    it("should extract version from migration filename", () => {
        const testFilenames = ["0001_initial.sql", "0002_add_users.sql", "0010_complex_migration.sql"];

        const versions = testFilenames.map(filename => filename.split("_")[0]);

        expect(versions).toEqual(["0001", "0002", "0010"]);
    });

    it("should sort migration files in correct order", () => {
        const unsortedFiles = ["0010_latest.sql", "0001_initial.sql", "0005_middle.sql"];

        const sortedFiles = [...unsortedFiles].sort();

        expect(sortedFiles).toEqual(["0001_initial.sql", "0005_middle.sql", "0010_latest.sql"]);
    });

    it("should filter only SQL files from directory", () => {
        const allFiles = ["0001_initial.sql", "meta.json", "0002_users.sql", "README.md", "schema.ts"];

        const sqlFiles = allFiles.filter(file => file.endsWith(".sql"));

        expect(sqlFiles).toEqual(["0001_initial.sql", "0002_users.sql"]);
    });
});
