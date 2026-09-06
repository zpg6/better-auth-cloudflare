import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectPackageManagerHint, normalizeProjectTemplate, type PackageManager } from "../src/lib/project-normalizer";

const temporaryDirectories: string[] = [];
const packageManagers: PackageManager[] = ["npm", "yarn", "pnpm", "bun"];
const lockfiles = ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true });
    }
});

for (const template of ["hono", "nextjs"] as const) {
    for (const packageManager of packageManagers) {
        test(`normalizes the ${template} template for ${packageManager}`, () => {
            const directory = mkdtempSync(join(tmpdir(), "bac-normalizer-"));
            temporaryDirectories.push(directory);
            mkdirSync(join(directory, "src"), { recursive: true });
            for (const lockfile of lockfiles) writeFileSync(join(directory, lockfile), "lock");
            writeFileSync(join(directory, "custom-worker.ts"), "export {};");
            if (template === "hono") {
                writeFileSync(
                    join(directory, "src/index.ts"),
                    'type Variables = {\n    auth: ReturnType<typeof createAuth>;\n};\nexport { BetterAuthDurableObject } from "better-auth-cloudflare/durable-object";\nconst auth = createAuth(c.env);\n'
                );
            }
            writeFileSync(
                join(directory, "package.json"),
                JSON.stringify({
                    name: "template",
                    packageManager: "pnpm@10.10.0",
                    scripts: {
                        "auth:generate":
                            "npx --yes auth@1.6.30 generate --config src/auth/index.ts --output src/db/auth.schema.ts -y",
                        "auth:update": "pnpm auth:generate && pnpm auth:format",
                        "clean-deploy": "pnpm clean && pnpm i && pnpm run deploy",
                        "db:check": "node ../../scripts/verify-sqlite-migrations.mjs",
                        "db:migrate:dev": "wrangler d1 migrations apply DATABASE --local",
                    },
                    dependencies: { "better-auth-cloudflare": "file:../../" },
                    pnpm: { overrides: { defu: "6.1.5" } },
                })
            );

            normalizeProjectTemplate(directory, {
                appName: `generated-${template}-${packageManager}`,
                database: "d1",
                d1Binding: "AUTH_DB",
                packageManager,
                packageManagerVersion: "9.8.7",
            });

            for (const lockfile of lockfiles) {
                expect(existsSync(join(directory, lockfile))).toBe(false);
            }

            expect(existsSync(join(directory, "custom-worker.ts"))).toBe(false);
            const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
            expect(pkg.scripts["auth:generate"]).toBe(
                "npx --yes auth@1.6.30 generate --config src/auth.config.ts --output src/db/auth.schema.ts -y"
            );
            expect(pkg.name).toBe(`generated-${template}-${packageManager}`);
            expect(pkg.packageManager).toBe(`${packageManager}@9.8.7`);
            expect(pkg.scripts["db:check"]).toBeUndefined();
            expect(pkg.scripts["db:migrate:dev"]).toContain("apply AUTH_DB");
            expect(Object.values(pkg.scripts).join(" ")).not.toContain(
                packageManager === "pnpm" ? "__never__" : "pnpm"
            );
            expect(pkg.dependencies["better-auth-cloudflare"]).toBe("latest");

            if (packageManager === "pnpm") {
                expect(pkg.pnpm.overrides).toEqual({ defu: "6.1.5" });
            } else if (packageManager === "yarn") {
                expect(pkg.pnpm).toBeUndefined();
                expect(pkg.resolutions).toEqual({ defu: "6.1.5" });
            } else {
                expect(pkg.pnpm).toBeUndefined();
                expect(pkg.overrides).toEqual({ defu: "6.1.5" });
            }

            if (template === "hono") {
                const entry = readFileSync(join(directory, "src/index.ts"), "utf8");
                expect(entry).not.toContain("BetterAuthDurableObject");
                expect(entry).toContain("auth: Awaited<ReturnType<typeof createAuth>>");
                expect(entry).toContain("const auth = await createAuth(c.env);");
            }
        });
    }
}

test("uses packageManager before stale lockfiles", () => {
    const directory = mkdtempSync(join(tmpdir(), "bac-normalizer-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "package.json"), JSON.stringify({ packageManager: "bun@1.2.22" }));
    writeFileSync(join(directory, "package-lock.json"), "{}");
    expect(detectPackageManagerHint(directory)).toBe("bun");
});

for (const [lockfile, expected] of [
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
] as const) {
    test(`detects ${expected} from ${lockfile}`, () => {
        const directory = mkdtempSync(join(tmpdir(), "bac-normalizer-"));
        temporaryDirectories.push(directory);
        writeFileSync(join(directory, lockfile), "lock");
        expect(detectPackageManagerHint(directory)).toBe(expected);
    });
}

test("rejects conflicting lockfiles without packageManager", () => {
    const directory = mkdtempSync(join(tmpdir(), "bac-normalizer-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "bun.lock"), "lock");
    writeFileSync(join(directory, "package-lock.json"), "{}");
    expect(() => detectPackageManagerHint(directory)).toThrow(/Conflicting package-manager lockfiles/);
});
