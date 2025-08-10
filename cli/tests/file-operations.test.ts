import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Mock the file operations that would be used in the CLI
function replaceInFile(filePath: string, searchValue: string, replaceValue: string): void {
    const content = readFileSync(filePath, "utf8");
    const updated = content.replace(new RegExp(searchValue, "g"), replaceValue);
    writeFileSync(filePath, updated);
}

function replaceBindingInAuthFile(filePath: string, oldBinding: string, newBinding: string): void {
    let content = readFileSync(filePath, "utf8");

    // Replace specific binding patterns
    if (oldBinding === "DATABASE") {
        content = content.replace(new RegExp(`env\\.${oldBinding}\\b`, "g"), `env.${newBinding}`);
    } else if (oldBinding === "KV") {
        content = content.replace(new RegExp(`env\\?\\.${oldBinding}\\b`, "g"), `env?.${newBinding}`);
    } else if (oldBinding === "R2_BUCKET") {
        content = content.replace(new RegExp(`env\\.${oldBinding}\\b`, "g"), `env.${newBinding}`);
    }

    writeFileSync(filePath, content);
}

function updateEnvTypes(filePath: string, bindings: Record<string, string>): void {
    let content = readFileSync(filePath, "utf8");

    // Replace DATABASE binding
    if (bindings.DATABASE) {
        content = content.replace(/DATABASE:\s*D1Database/, `${bindings.DATABASE}: D1Database`);
    }

    // Replace KV binding
    if (bindings.KV) {
        content = content.replace(/KV:\s*KVNamespace/, `${bindings.KV}: KVNamespace`);
    }

    // Replace R2 binding
    if (bindings.R2_BUCKET) {
        content = content.replace(/R2_BUCKET:\s*R2Bucket/, `${bindings.R2_BUCKET}: R2Bucket`);
    }

    // Add HYPERDRIVE if needed
    if (bindings.HYPERDRIVE) {
        if (!content.includes("HYPERDRIVE")) {
            content = content.replace(
                /interface\s+Env\s*\{/,
                `interface Env {\n    ${bindings.HYPERDRIVE}: Hyperdrive;`
            );
        }
    }

    writeFileSync(filePath, content);
}

const testDir = join(tmpdir(), "cli-test-files");

describe("File operations", () => {
    beforeEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true });
        }
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true });
        }
    });

    test("replaces binding names in auth file", () => {
        const authFile = join(testDir, "auth.ts");
        const authContent = `import { betterAuth } from "better-auth";
import { d1Adapter } from "better-auth/adapters/d1";

export const auth = betterAuth({
  database: d1Adapter({
    db: env.DATABASE,
  }),
  plugins: [
    cloudflareAuth({
      kv: env?.KV,
      r2: {
        bucket: env.R2_BUCKET,
      }
    })
  ]
});`;

        writeFileSync(authFile, authContent);

        replaceBindingInAuthFile(authFile, "DATABASE", "MY_DB");
        replaceBindingInAuthFile(authFile, "KV", "MY_KV");
        replaceBindingInAuthFile(authFile, "R2_BUCKET", "MY_R2");

        const updated = readFileSync(authFile, "utf8");
        expect(updated).toContain("env.MY_DB");
        expect(updated).toContain("env?.MY_KV");
        expect(updated).toContain("env.MY_R2");
    });

    test("updates environment type definitions", () => {
        const envFile = join(testDir, "env.d.ts");
        const envContent = `interface Env {
  DATABASE: D1Database;
  KV: KVNamespace;
  R2_BUCKET: R2Bucket;
}`;

        writeFileSync(envFile, envContent);

        updateEnvTypes(envFile, {
            DATABASE: "MY_DATABASE",
            KV: "SESSIONS",
            R2_BUCKET: "FILE_STORAGE",
        });

        const updated = readFileSync(envFile, "utf8");
        expect(updated).toContain("MY_DATABASE: D1Database");
        expect(updated).toContain("SESSIONS: KVNamespace");
        expect(updated).toContain("FILE_STORAGE: R2Bucket");
    });

    test("adds Hyperdrive to env types", () => {
        const envFile = join(testDir, "env.d.ts");
        const envContent = `interface Env {
  DATABASE: D1Database;
}`;

        writeFileSync(envFile, envContent);

        updateEnvTypes(envFile, {
            HYPERDRIVE: "MY_HYPERDRIVE",
        });

        const updated = readFileSync(envFile, "utf8");
        expect(updated).toContain("MY_HYPERDRIVE: Hyperdrive");
    });

    test("converts D1 to Postgres configuration", () => {
        const authFile = join(testDir, "auth.ts");
        const d1Content = `import { betterAuth } from "better-auth";
import { d1Adapter } from "better-auth/adapters/d1";

export const auth = betterAuth({
  database: d1Adapter({
    db: env.DATABASE,
  }),
});`;

        writeFileSync(authFile, d1Content);

        // Simulate converting to Postgres
        let content = readFileSync(authFile, "utf8");
        content = content.replace(
            'import { d1Adapter } from "better-auth/adapters/d1";',
            'import { postgresAdapter } from "better-auth/adapters/postgres";'
        );
        content = content.replace(/d1Adapter\(\{[\s\S]*?\}\)/, "postgresAdapter({ db: env.HYPERDRIVE })");
        writeFileSync(authFile, content);

        const updated = readFileSync(authFile, "utf8");
        expect(updated).toContain("postgresAdapter");
        expect(updated).toContain("env.HYPERDRIVE");
        expect(updated).not.toContain("d1Adapter");
    });

    test("updates drizzle config for different databases", () => {
        const configFile = join(testDir, "drizzle.config.ts");
        const d1Config = `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "d1-http",
});`;

        writeFileSync(configFile, d1Config);

        // Convert to PostgreSQL
        let content = readFileSync(configFile, "utf8");
        content = content.replace('"sqlite"', '"postgresql"');
        content = content.replace(/,\s*driver:\s*"d1-http"/, "");
        writeFileSync(configFile, content);

        const updated = readFileSync(configFile, "utf8");
        expect(updated).toContain('"postgresql"');
        expect(updated).not.toContain('"d1-http"');
    });
});
