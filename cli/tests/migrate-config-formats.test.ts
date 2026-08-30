import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, delimiter, join } from "path";
import { spawnSync } from "child_process";

const cliPath = join(import.meta.dir, "..", "src", "index.ts");

describe("migrate config formats", () => {
    let testDirectory: string;
    let commandLog: string;
    let binDirectory: string;

    beforeEach(() => {
        testDirectory = mkdtempSync(join(tmpdir(), "better-auth-cloudflare-migrate-"));
        commandLog = join(testDirectory, "commands.log");
        binDirectory = join(testDirectory, "bin");
        mkdirSync(binDirectory);

        writeExecutable(
            join(binDirectory, "npm"),
            `const { appendFileSync } = require("fs");
const args = process.argv.slice(2);
if (args[0] === "--version") {
    process.stdout.write("10.0.0");
    process.exit(0);
}
if (args[0] === "view") process.exit(1);
if (args[0] === "run") {
    appendFileSync(process.env.CLI_COMMAND_LOG, args[1] + "\\t" + process.cwd() + "\\n");
    process.exit(0);
}
process.exit(1);
`
        );

        writeExecutable(
            join(binDirectory, "npx"),
            `const args = process.argv.slice(2);
if (args[0] !== "wrangler") process.exit(1);
if (args[1] === "d1" && args[2] === "list") {
    process.stdout.write(JSON.stringify([{ name: "test-db" }]));
    process.exit(0);
}
if (args[1] === "hyperdrive" && args[2] === "get") process.exit(1);
process.exit(1);
`
        );
    });

    afterEach(() => {
        rmSync(testDirectory, { recursive: true, force: true });
    });

    test("runs the skip workflow with TOML, JSON, and JSONC", () => {
        const configs = [
            ["wrangler.toml", '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "test-db"'],
            ["wrangler.json", '{ /* comment */ "d1_databases": [{ "binding": "DB", "database_name": "test-db" }] }'],
            ["wrangler.jsonc", '{ // comment\n "d1_databases": [{ "binding": "DB", "database_name": "test-db" }],\n}'],
        ] as const;

        for (const [filename, content] of configs) {
            clearProjectFiles();
            writeFileSync(join(testDirectory, filename), content);

            const result = runMigrate(testDirectory, "skip");
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Migration completed successfully");
            expect(readCommands()).toEqual(["auth:update", "db:generate"]);
        }
    });

    test("`migrate` finds a config in a parent directory", () => {
        const nested = join(testDirectory, "src", "routes");
        mkdirSync(nested, { recursive: true });
        writeFileSync(
            join(testDirectory, "wrangler.jsonc"),
            '{ "d1_databases": [{ "binding": "DB", "database_name": "test-db" }] }'
        );

        const result = runMigrate(nested, "skip");
        expect(result.status).toBe(0);
        expect(readCommands()).toEqual(["auth:update", "db:generate"]);
        const projectDirectory = realpathSync(testDirectory);
        expect(readCommandDirectories()).toEqual([projectDirectory, projectDirectory]);
    });

    test("rejects an invalid higher-priority config without falling back", () => {
        writeFileSync(join(testDirectory, "wrangler.json"), "{");
        writeFileSync(
            join(testDirectory, "wrangler.toml"),
            '[[d1_databases]]\nbinding = "DB"\ndatabase_name = "test-db"'
        );

        const result = runMigrate(testDirectory, "skip");
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Failed to parse Wrangler config");
        expect(readCommands()).toEqual([]);
    });

    test("rejects an unsupported --config argument", () => {
        writeFileSync(
            join(testDirectory, "wrangler.json"),
            '{ "d1_databases": [{ "binding": "DB", "database_name": "test-db" }] }'
        );

        const result = runMigrate(testDirectory, "skip", ["--config=custom.json"]);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Unsupported migrate argument: --config");
        expect(readCommands()).toEqual([]);
    });

    test("fails when the config has no database bindings", () => {
        writeFileSync(join(testDirectory, "wrangler.jsonc"), '{ "name": "test" }');

        const result = runMigrate(testDirectory, "skip");
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("No database configurations found");
        expect(readCommands()).toEqual([]);
    });

    test("runs db:migrate:dev for a D1 config", () => {
        writeFileSync(
            join(testDirectory, "wrangler.json"),
            '{ "d1_databases": [{ "binding": "DB", "database_name": "test-db" }] }'
        );

        const result = runMigrate(testDirectory, "dev");
        expect(result.status).toBe(0);
        expect(readCommands()).toEqual(["auth:update", "db:generate", "db:migrate:dev"]);
    });

    test("fails when no config exists", () => {
        const result = runMigrate(testDirectory, "skip");
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("No Wrangler config found");
        expect(readCommands()).toEqual([]);
    });

    test("prints migration guidance for a Hyperdrive config", () => {
        writeFileSync(
            join(testDirectory, "wrangler.jsonc"),
            '{ "hyperdrive": [{ "binding": "HD", "id": "hyperdrive-id" }] }'
        );

        const result = runMigrate(testDirectory, "dev");
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("none exist in your account");
        expect(readCommands()).toEqual(["auth:update", "db:generate"]);
    });

    function clearProjectFiles(): void {
        for (const filename of ["wrangler.toml", "wrangler.json", "wrangler.jsonc", "commands.log"]) {
            rmSync(join(testDirectory, filename), { force: true });
        }
    }

    function readCommands(): string[] {
        return readCommandLog().map(line => line.split("\t", 1)[0]);
    }

    function readCommandDirectories(): string[] {
        return readCommandLog().map(line => line.split("\t", 2)[1]);
    }

    function readCommandLog(): string[] {
        try {
            return readFileSync(commandLog, "utf8").trim().split("\n").filter(Boolean);
        } catch {
            return [];
        }
    }

    function runMigrate(cwd: string, target: "dev" | "skip", extraArgs: string[] = []) {
        return spawnSync(process.execPath, [cliPath, "migrate", `--migrate-target=${target}`, ...extraArgs], {
            cwd,
            encoding: "utf8",
            timeout: 10_000,
            env: {
                ...process.env,
                PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
                CLI_COMMAND_LOG: commandLog,
            },
        });
    }
});

function writeExecutable(path: string, content: string): void {
    writeFileSync(`${path}.js`, content);
    if (process.platform === "win32") {
        writeFileSync(`${path}.cmd`, `@"${process.execPath}" "%~dp0${basename(path)}.js" %*\r\n`);
        return;
    }

    writeFileSync(path, `#!/usr/bin/env node\n${content}`);
    chmodSync(path, 0o755);
}
