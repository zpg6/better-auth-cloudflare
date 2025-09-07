import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { detectMultiTenancy, splitAuthSchema, restoreOriginalSchema } from "../src/lib/tenant-migration-generator";

const testProjectPath = join(__dirname, "test-project");

describe("Tenant Migration Generator", () => {
    beforeEach(() => {
        // Create test project structure
        if (existsSync(testProjectPath)) {
            rmSync(testProjectPath, { recursive: true, force: true });
        }
        mkdirSync(testProjectPath, { recursive: true });
        mkdirSync(join(testProjectPath, "src", "auth"), { recursive: true });
        mkdirSync(join(testProjectPath, "src", "db"), { recursive: true });
    });

    afterEach(() => {
        // Clean up test project
        if (existsSync(testProjectPath)) {
            rmSync(testProjectPath, { recursive: true, force: true });
        }
    });

    describe("detectMultiTenancy", () => {
        it("should detect multi-tenancy when enabled in auth config", () => {
            const authContent = `
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

export const auth = betterAuth(
    withCloudflare({
        d1: {
            multiTenancy: {
                mode: "organization",
                cloudflareD1Api: { /* ... */ }
            }
        }
    }, {})
);
`;
            writeFileSync(join(testProjectPath, "src", "auth", "index.ts"), authContent);

            expect(detectMultiTenancy(testProjectPath)).toBe(true);
        });

        it("should not detect multi-tenancy when disabled", () => {
            const authContent = `
import { betterAuth } from "better-auth";
import { withCloudflare } from "better-auth-cloudflare";

export const auth = betterAuth(
    withCloudflare({
        d1: {
            db: mockDb
        }
    }, {})
);
`;
            writeFileSync(join(testProjectPath, "src", "auth", "index.ts"), authContent);

            expect(detectMultiTenancy(testProjectPath)).toBe(false);
        });

        it("should return false when auth file doesn't exist", () => {
            expect(detectMultiTenancy(testProjectPath)).toBe(false);
        });
    });

    describe("splitAuthSchema", () => {
        const mockAuthSchema = `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
});

export const sessions = sqliteTable("sessions", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    token: text("token").notNull(),
});

export const accounts = sqliteTable("accounts", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    providerId: text("provider_id").notNull(),
});

export const verifications = sqliteTable("verifications", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
});

export const tenants = sqliteTable("tenants", {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    databaseName: text("database_name").notNull(),
});

export const organizations = sqliteTable("organizations", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
});

export const members = sqliteTable("members", {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    userId: text("user_id").notNull(),
});`;

        const mockSchemaFile = `import * as authSchema from "./auth.schema";

export const schema = {
    ...authSchema,
} as const;`;

        beforeEach(() => {
            writeFileSync(join(testProjectPath, "src", "db", "auth.schema.ts"), mockAuthSchema);
            writeFileSync(join(testProjectPath, "src", "db", "schema.ts"), mockSchemaFile);
        });

        it("should split auth schema into core and tenant files", async () => {
            await splitAuthSchema(testProjectPath);

            // Check that all three files exist
            expect(existsSync(join(testProjectPath, "src", "db", "auth.schema.ts"))).toBe(true);
            expect(existsSync(join(testProjectPath, "src", "db", "tenant.schema.ts"))).toBe(true);
            expect(existsSync(join(testProjectPath, "src", "db", "tenant.raw.ts"))).toBe(true);

            // Check core schema contains only core tables
            const coreSchema = readFileSync(join(testProjectPath, "src", "db", "auth.schema.ts"), "utf8");
            expect(coreSchema).toContain("export const users");
            expect(coreSchema).toContain("export const accounts");
            expect(coreSchema).toContain("export const verifications");
            expect(coreSchema).toContain("export const tenants");
            expect(coreSchema).not.toContain("export const sessions");
            expect(coreSchema).not.toContain("export const organizations");
            expect(coreSchema).not.toContain("export const members");

            // Check tenant schema contains only tenant tables
            const tenantSchema = readFileSync(join(testProjectPath, "src", "db", "tenant.schema.ts"), "utf8");
            expect(tenantSchema).toContain("export const sessions");
            expect(tenantSchema).toContain("export const organizations");
            expect(tenantSchema).toContain("export const members");
            expect(tenantSchema).not.toContain("export const users");
            expect(tenantSchema).not.toContain("export const accounts");
            expect(tenantSchema).not.toContain("export const verifications");
            expect(tenantSchema).not.toContain("export const tenants");

            // Check that tenant schema imports users from auth.schema
            expect(tenantSchema).toContain('import { users } from "./auth.schema"');

            // Check tenant raw SQL file exists and has correct structure
            const tenantRaw = readFileSync(join(testProjectPath, "src", "db", "tenant.raw.ts"), "utf8");
            expect(tenantRaw).toContain("export const raw = `");
            expect(tenantRaw).toContain("Raw SQL statements for creating tenant tables");

            // Check main schema file is updated
            const mainSchema = readFileSync(join(testProjectPath, "src", "db", "schema.ts"), "utf8");
            expect(mainSchema).toContain('import * as tenantSchema from "./tenant.schema"');
            expect(mainSchema).toContain("...tenantSchema");
        });

        it("should throw error if auth.schema.ts doesn't exist", () => {
            rmSync(join(testProjectPath, "src", "db", "auth.schema.ts"));

            expect(() => splitAuthSchema(testProjectPath)).toThrow("auth.schema.ts not found");
        });
    });

    describe("restoreOriginalSchema", () => {
        beforeEach(() => {
            // Create split schema files
            writeFileSync(join(testProjectPath, "src", "db", "auth.schema.ts"), "// core schema");
            writeFileSync(join(testProjectPath, "src", "db", "tenant.schema.ts"), "// tenant schema");
            writeFileSync(
                join(testProjectPath, "src", "db", "schema.ts"),
                `import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import * as tenantSchema from "./tenant.schema"; // Tenant tables (tenant databases)

export const schema = {
    ...authSchema,
    ...tenantSchema,
};`
            );
        });

        it("should restore original schema structure", () => {
            restoreOriginalSchema(testProjectPath);

            // Check tenant schema file is removed
            expect(existsSync(join(testProjectPath, "src", "db", "tenant.schema.ts"))).toBe(false);

            // Check main schema file is restored
            const mainSchema = readFileSync(join(testProjectPath, "src", "db", "schema.ts"), "utf8");
            expect(mainSchema).not.toContain('import * as tenantSchema from "./tenant.schema"');
            expect(mainSchema).not.toContain("...tenantSchema");
            expect(mainSchema).toContain('import * as authSchema from "./auth.schema"');
        });
    });

    describe("Foreign Key Filtering", () => {
        const testMigrationsDir = join(testProjectPath, "drizzle-tenant");

        beforeEach(() => {
            mkdirSync(testMigrationsDir, { recursive: true });
        });

        it("should filter out foreign key references to users table", () => {
            const sqlWithUsersForeignKey = `CREATE TABLE \`user_files\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`filename\` text NOT NULL,
	\`content_type\` text NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithUsersForeignKey);

            // Simulate the filtering logic from getMigrationSqlFromFiles
            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).not.toContain("FOREIGN KEY");
            expect(fixedContent).not.toContain("REFERENCES `users`");
            expect(fixedContent).toContain("CREATE TABLE `user_files`");
            expect(fixedContent).toContain("`content_type` text NOT NULL\n);");
        });

        it("should preserve foreign keys to non-users tables", () => {
            const sqlWithOtherForeignKey = `CREATE TABLE \`posts\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`organization_id\` text NOT NULL,
	\`title\` text NOT NULL,
	FOREIGN KEY (\`organization_id\`) REFERENCES \`organizations\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithOtherForeignKey);

            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).toContain("FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)");
            expect(fixedContent).toContain("ON DELETE cascade");
        });

        it("should handle multiple foreign keys with mixed references", () => {
            const sqlWithMixedForeignKeys = `CREATE TABLE \`user_posts\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`organization_id\` text NOT NULL,
	\`title\` text NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`organization_id\`) REFERENCES \`organizations\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithMixedForeignKeys);

            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).not.toContain("REFERENCES `users`");
            expect(fixedContent).toContain("FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`)");
            expect(fixedContent).not.toContain("cascade,"); // Should not have trailing comma
        });

        it("should handle trailing comma when users foreign key is last", () => {
            const sqlWithTrailingComma = `CREATE TABLE \`user_sessions\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`token\` text NOT NULL,
	\`expires_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithTrailingComma);

            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).not.toContain("FOREIGN KEY");
            expect(fixedContent).toContain("`expires_at` integer NOT NULL\n);");
            expect(fixedContent).not.toContain(",\n);"); // No trailing comma
        });

        it("should handle different whitespace patterns", () => {
            const sqlWithVariousWhitespace = `CREATE TABLE \`test_table\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`data\` text,
    FOREIGN KEY ( \`user_id\` ) REFERENCES \`users\` ( \`id\` ) ON UPDATE no action ON DELETE cascade
);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithVariousWhitespace);

            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).not.toContain("FOREIGN KEY");
            expect(fixedContent).not.toContain("REFERENCES `users`");
        });

        it("should handle empty migration files gracefully", () => {
            writeFileSync(join(testMigrationsDir, "0001_empty.sql"), "");

            const content = readFileSync(join(testMigrationsDir, "0001_empty.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).toBe("");
        });

        it("should preserve other SQL statements unchanged", () => {
            const sqlWithVariousStatements = `CREATE TABLE \`organizations\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX \`idx_org_name\` ON \`organizations\` (\`name\`);
--> statement-breakpoint
DROP TABLE \`old_table\`;
--> statement-breakpoint
INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (1, 'hash123', 1234567890);`;

            writeFileSync(join(testMigrationsDir, "0001_test.sql"), sqlWithVariousStatements);

            const content = readFileSync(join(testMigrationsDir, "0001_test.sql"), "utf8");
            const filteredLines = content.split("\n").filter(line => !/FOREIGN KEY.*REFERENCES.*\`users\`/.exec(line));

            const fixedContent = filteredLines.join("\n").replace(/,\s*\n\s*\);/g, "\n);");

            expect(fixedContent).toContain("CREATE TABLE `organizations`");
            expect(fixedContent).toContain("CREATE INDEX `idx_org_name`");
            expect(fixedContent).toContain("DROP TABLE `old_table`");
            expect(fixedContent).toContain('INSERT INTO "__drizzle_migrations"');
        });
    });
});
