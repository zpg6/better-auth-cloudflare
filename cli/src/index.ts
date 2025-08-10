#!/usr/bin/env node

import { cancel, confirm, group, intro, outro, select, spinner, text } from "@clack/prompts";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import pc from "picocolors";
import { parseWranglerToml, type DatabaseConfig } from "./lib/helpers.js";

// Get package version from package.json
function getPackageVersion(): string {
    try {
        const packagePath = join(__dirname, "..", "package.json");
        const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as JSONObject;
        return packageJson.version as string;
    } catch {
        return "unknown";
    }
}

// Check for updates and suggest upgrade
async function checkForUpdates(): Promise<void> {
    try {
        const currentVersion = getPackageVersion();
        if (currentVersion === "unknown") return;

        // Use npm view to get the latest version
        const result = bunSpawnSync("npm", ["view", "@better-auth-cloudflare/cli", "version"]);
        if (result.code !== 0) return;

        const latestVersion = result.stdout.trim();
        if (!latestVersion || latestVersion === currentVersion) return;

        // Simple version comparison (assumes semantic versioning)
        const currentParts = currentVersion.split(".").map(n => parseInt(n, 10));
        const latestParts = latestVersion.split(".").map(n => parseInt(n, 10));

        let isNewer = false;
        for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
            const current = currentParts[i] || 0;
            const latest = latestParts[i] || 0;
            if (latest > current) {
                isNewer = true;
                break;
            } else if (latest < current) {
                break;
            }
        }

        if (isNewer) {
            console.log(pc.yellow(`\n🔄 Update available: ${currentVersion} → ${latestVersion}`));
            console.log(pc.cyan(`   Run: npm install -g @better-auth-cloudflare/cli@latest`));
            console.log(pc.cyan(`   Or:  npx @better-auth-cloudflare/cli@latest\n`));
        }
    } catch {
        // Silently fail - don't interrupt the user experience
    }
}

// Print version information
function printVersion(): void {
    const version = getPackageVersion();
    console.log(`@better-auth-cloudflare/cli v${version}`);
}

type DbKind = "d1" | "hyperdrive-postgres" | "hyperdrive-mysql";

interface GenerateAnswers {
    appName: string;
    template: "hono" | "nextjs";
    database: DbKind;
    // D1
    d1Name?: string;
    d1Binding?: string;
    // Hyperdrive
    hdBinding?: string;
    hdName?: string;
    hdConnectionString?: string;
    // Features
    geolocation: boolean;
    kv: boolean;
    kvBinding?: string;
    kvNamespaceName?: string;
    r2: boolean;
    r2Binding?: string;
    r2BucketName?: string;
    // Cloudflare account configuration
    accountId?: string;
    skipCloudflareSetup?: boolean;
    // Migration options
    applyMigrations?: "dev" | "prod" | "skip";
}

interface CliArgs {
    [key: string]: string | boolean | undefined;
}

// JSON typing helpers (avoid any/unknown)
export type JSONValue = string | number | boolean | null | JSONArray | JSONObject;
export interface JSONObject {
    [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

function bunSpawnSync(command: string, args: string[], cwd?: string, env?: Record<string, string>) {
    try {
        if (typeof Bun !== "undefined" && typeof Bun.spawnSync === "function") {
            const res = Bun.spawnSync({
                cmd: [command, ...args],
                cwd,
                stdout: "pipe",
                stderr: "pipe",
                env: env ? { ...process.env, ...env } : process.env,
            });
            const decode = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : "");
            return { code: res.exitCode ?? 0, stdout: decode(res.stdout), stderr: decode(res.stderr) };
        }
    } catch {}
    // Fallback to Node's child_process
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const result = spawnSync(command, args, {
        stdio: "pipe",
        cwd,
        encoding: "utf8",
        env: env ? { ...process.env, ...env } : process.env,
    });
    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function commandAvailable(command: string): boolean {
    const res = bunSpawnSync(command, ["--version"]);
    return (res.code ?? 1) === 0;
}

function fatal(message: string, details?: string) {
    if (details && details.trim()) process.stdout.write(details);
    outro(pc.red(message));
    process.exit(1);
}

function assertOk(result: { code: number; stdout?: string; stderr?: string }, failMessage: string) {
    if (result.code !== 0) fatal(failMessage, result.stderr || result.stdout || "");
}

function detectPackageManager(cwd: string): PackageManager {
    if (existsSync(join(cwd, "bun.lockb")) && commandAvailable("bun")) return "bun";
    if (existsSync(join(cwd, "pnpm-lock.yaml")) && commandAvailable("pnpm")) return "pnpm";
    if (existsSync(join(cwd, "yarn.lock")) && commandAvailable("yarn")) return "yarn";
    if (commandAvailable("bun")) return "bun";
    if (commandAvailable("pnpm")) return "pnpm";
    if (commandAvailable("yarn")) return "yarn";
    return "npm";
}

function runScript(pm: PackageManager, script: string, cwd: string) {
    const args = pm === "bun" ? ["run", script] : pm === "yarn" ? [script] : ["run", script];
    return bunSpawnSync(pm, args, cwd);
}

function runInstall(pm: PackageManager, cwd: string) {
    const args = pm === "yarn" ? [] : ["install"];
    return bunSpawnSync(pm, args, cwd);
}

function runWranglerCommand(args: string[], cwd: string, accountId?: string) {
    const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
    return bunSpawnSync("npx", ["wrangler", ...args], cwd, env);
}

function parseAvailableAccounts(stderr: string): Array<{ name: string; id: string }> {
    const accounts: Array<{ name: string; id: string }> = [];
    const lines = stderr.split("\n");

    for (const line of lines) {
        // Parse lines like: `Account Name`: `account-id`
        const match = line.match(/^\s*`([^`]+)`:\s*`([^`]+)`$/);
        if (match) {
            accounts.push({ name: match[1], id: match[2] });
        }
    }

    return accounts;
}

async function handleAccountSelection(stderr: string, isNonInteractive: boolean): Promise<string | undefined> {
    const accounts = parseAvailableAccounts(stderr);

    if (accounts.length === 0) {
        return undefined;
    }

    if (isNonInteractive) {
        // In non-interactive mode, show available accounts and exit with instructions
        outro(pc.red("Multiple Cloudflare accounts found. Please specify which account to use."));
        console.log(pc.bold("\nAvailable accounts:"));
        for (const account of accounts) {
            console.log(`  ${pc.cyan(account.name)}: ${pc.gray(account.id)}`);
        }
        console.log(pc.bold("\nTo use a specific account, add the --account-id argument:"));
        console.log(pc.cyan(`  --account-id=${accounts[0].id}`));
        console.log(pc.bold("\nOr skip Cloudflare setup entirely:"));
        console.log(pc.cyan("  --skip-cloudflare-setup=true"));
        process.exit(1);
    } else {
        // In interactive mode, let user select
        const { select } = await import("@clack/prompts");
        const selectedAccountId = (await (select as any)({
            message: "Multiple Cloudflare accounts found. Which account would you like to use?",
            options: accounts.map(account => ({
                value: account.id,
                label: `${account.name} (${account.id})`,
            })),
        })) as string;

        return selectedAccountId;
    }
}

async function ensureWranglerAuth(isNonInteractive: boolean): Promise<string | undefined> {
    // Check if user is already authenticated
    const whoamiResult = bunSpawnSync("npx", ["wrangler", "whoami"]);

    if (whoamiResult.code === 0) {
        // Already authenticated, return undefined (no specific account needed)
        return undefined;
    }

    if (isNonInteractive) {
        // In non-interactive mode, show login instructions and exit
        outro(pc.red("Wrangler authentication required for Cloudflare setup."));
        console.log(pc.bold("\nTo authenticate, run:"));
        console.log(pc.cyan("  npx wrangler login"));
        console.log(pc.bold("\nOr skip Cloudflare setup:"));
        console.log(pc.cyan("  --skip-cloudflare-setup=true"));
        process.exit(1);
    } else {
        // In interactive mode, prompt to login
        const shouldLoginResult = await confirm({
            message: "Wrangler authentication required. Login now?",
            initialValue: true,
        });
        const shouldLogin = shouldLoginResult === true;

        if (shouldLogin) {
            const s = spinner();
            s.start("Opening browser for Wrangler login...");

            const loginResult = bunSpawnSync("npx", ["wrangler", "login"]);

            if (loginResult.code === 0) {
                s.stop(pc.green("Successfully logged in to Wrangler."));
                return undefined;
            } else {
                s.stop(pc.red("Failed to login to Wrangler."));
                fatal("Wrangler login failed. Please try running 'npx wrangler login' manually.");
            }
        } else {
            outro(
                pc.yellow(
                    "Skipping Cloudflare setup. You can run 'npx wrangler login' and setup resources manually later."
                )
            );
            return "skip-setup";
        }
    }
}

function ensureCleanAppDir(appDir: string) {
    if (existsSync(appDir)) {
        throw new Error(`Directory ${appDir} already exists. Choose a different name or remove it.`);
    }
}

function replaceAll(content: string, replacements: Record<string, string>) {
    let out = content;
    for (const [key, value] of Object.entries(replacements)) {
        out = out.split(key).join(value);
    }
    return out;
}

export function updateJSON(filePath: string, mutator: (json: JSONObject) => JSONObject) {
    const json = JSON.parse(readFileSync(filePath, "utf8")) as JSONObject;
    const next = mutator(json);
    writeFileSync(filePath, JSON.stringify(next, null, 2));
}

export function extractFirstBlock(toml: string, header: string) {
    const re = new RegExp(`(\\[\\[${header}\\]\\][\\s\\S]*?)(?=\\n\\[\\[|$)`);
    const match = re.exec(toml);
    if (!match) return null;
    return { block: match[1], start: match.index, end: match.index + match[1].length };
}

export function updateD1Block(toml: string, binding: string, dbName: string) {
    const found = extractFirstBlock(toml, "d1_databases");
    if (!found) return toml;
    let block = found.block;
    if (/binding\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/binding\s*=\s*"[^"]+"/, `binding = "${binding}"`);
    } else {
        block = block.replace(/\[\[d1_databases\]\]/, `[[d1_databases]]\nbinding = "${binding}"`);
    }
    if (/database_name\s*=\s*"[^"]+"/.test(block)) {
        block = block.replace(/database_name\s*=\s*"[^"]+"/, `database_name = "${dbName}"`);
    }
    return toml.slice(0, found.start) + block + toml.slice(found.end);
}

export function appendOrReplaceKvNamespaceBlock(toml: string, binding: string, id?: string) {
    const kvBlockRegex = /\[\[kv_namespaces\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(kvBlockRegex) || [];
    const newBlock = ["[[kv_namespaces]]", `binding = "${binding}"`, id ? `id = "${id}"` : ""]
        .filter(Boolean)
        .join("\n");

    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export function appendOrReplaceR2Block(toml: string, binding: string, bucketName: string) {
    const r2BlockRegex = /\[\[r2_buckets\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(r2BlockRegex) || [];
    const newBlock = ["[[r2_buckets]]", `binding = "${binding}"`, `bucket_name = "${bucketName}"`].join("\n");
    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export function appendOrReplaceHyperdriveBlock(toml: string, binding: string, id: string) {
    const blockRegex = /\[\[hyperdrive\]\][\s\S]*?(?=(\n\[\[|$))/g;
    const blocks = toml.match(blockRegex) || [];
    const newBlock = ["[[hyperdrive]]", `binding = "${binding}"`, `id = "${id}"`].join("\n");
    const existingIndex = blocks.findIndex(b => b.includes(`binding = "${binding}"`));
    if (existingIndex >= 0) {
        const existing = blocks[existingIndex];
        return toml.replace(existing, newBlock);
    }
    return toml.trimEnd() + "\n\n" + newBlock + "\n";
}

export function clearAllR2Blocks(toml: string) {
    return toml.replace(/\[\[r2_buckets\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
}

export function clearAllKvBlocks(toml: string) {
    return toml.replace(/\[\[kv_namespaces\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
}

function tryUpdateFile(filePath: string, mutate: (content: string) => string) {
    if (!existsSync(filePath)) return;
    const src = readFileSync(filePath, "utf8");
    const next = mutate(src);
    if (next !== src) writeFileSync(filePath, next);
}

export function validateBindingName(name: string): string | undefined {
    if (!name || name.trim().length === 0) return "Please enter a binding name";
    if (!/^[A-Z0-9_]+$/.test(name)) return "Use ONLY A-Z, 0-9, and underscores";
    return undefined;
}

function parseCliArgs(argv: string[]): CliArgs {
    const args: CliArgs = {};

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];

        // Handle --key=value format
        if (arg.startsWith("--") && arg.includes("=")) {
            const [key, ...valueParts] = arg.slice(2).split("=");
            const value = valueParts.join("="); // Handle values that contain "="

            // Convert boolean strings
            if (value === "true") {
                args[key] = true;
            } else if (value === "false") {
                args[key] = false;
            } else {
                args[key] = value;
            }
        }
        // Handle --key value format
        else if (arg.startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
            const key = arg.slice(2);
            const value = argv[i + 1];

            // Convert boolean strings
            if (value === "true") {
                args[key] = true;
            } else if (value === "false") {
                args[key] = false;
            } else {
                args[key] = value;
            }
            i += 1; // Skip the next argument as it's the value
        }
        // Handle boolean flags like --geolocation (defaults to true)
        else if (arg.startsWith("--")) {
            const key = arg.slice(2);
            args[key] = true;
        }
    }

    return args;
}

function validateCliArgs(args: CliArgs): string[] {
    const errors: string[] = [];

    // Validate app name
    if (args["app-name"] && typeof args["app-name"] === "string") {
        const name = args["app-name"];
        if (!name.trim()) {
            errors.push("app-name cannot be empty");
        } else if (!/^[a-z0-9-]+$/.test(name)) {
            errors.push("app-name must contain only lowercase letters, numbers, and hyphens");
        }
    }

    // Validate template
    if (args.template && !["hono", "nextjs"].includes(args.template as string)) {
        errors.push("template must be 'hono' or 'nextjs'");
    }

    // Validate database
    if (args.database && !["d1", "hyperdrive-postgres", "hyperdrive-mysql"].includes(args.database as string)) {
        errors.push("database must be 'd1', 'hyperdrive-postgres', or 'hyperdrive-mysql'");
    }

    // Validate binding names
    const bindingFields = ["d1-binding", "hd-binding", "kv-binding", "r2-binding"];
    for (const field of bindingFields) {
        if (args[field] !== undefined && typeof args[field] === "string") {
            const error = validateBindingName(String(args[field]));
            if (error) {
                errors.push(`${field}: ${error}`);
            }
        }
    }

    // Validate connection string format if provided
    if (args["hd-connection-string"] && typeof args["hd-connection-string"] === "string") {
        const connStr = args["hd-connection-string"];
        if (
            !connStr.startsWith("postgres://") &&
            !connStr.startsWith("postgresql://") &&
            !connStr.startsWith("mysql://")
        ) {
            errors.push(
                "hd-connection-string must be a valid database URL starting with postgres://, postgresql://, or mysql://"
            );
        }
    }

    // Validate apply-migrations option
    if (args["apply-migrations"] && !["dev", "prod", "skip"].includes(args["apply-migrations"] as string)) {
        errors.push("apply-migrations must be 'dev', 'prod', or 'skip'");
    }

    return errors;
}

function cliArgsToAnswers(args: CliArgs): Partial<GenerateAnswers> {
    const answers: Partial<GenerateAnswers> = {};

    if (args["app-name"]) answers.appName = args["app-name"] as string;
    if (args.template) answers.template = args.template as "hono" | "nextjs";
    if (args.database) answers.database = args.database as DbKind;

    // D1 fields
    if (args["d1-name"]) answers.d1Name = args["d1-name"] as string;
    if (args["d1-binding"]) answers.d1Binding = args["d1-binding"] as string;

    // Hyperdrive fields
    if (args["hd-binding"]) answers.hdBinding = args["hd-binding"] as string;
    if (args["hd-name"]) answers.hdName = args["hd-name"] as string;
    if (args["hd-connection-string"]) answers.hdConnectionString = args["hd-connection-string"] as string;

    // Features
    if (args.geolocation !== undefined) answers.geolocation = Boolean(args.geolocation);
    if (args.kv !== undefined) answers.kv = Boolean(args.kv);
    if (args["kv-binding"]) answers.kvBinding = args["kv-binding"] as string;
    if (args["kv-namespace-name"]) answers.kvNamespaceName = args["kv-namespace-name"] as string;
    if (args.r2 !== undefined) answers.r2 = Boolean(args.r2);
    if (args["r2-binding"]) answers.r2Binding = args["r2-binding"] as string;
    if (args["r2-bucket-name"]) answers.r2BucketName = args["r2-bucket-name"] as string;

    // Cloudflare account configuration
    if (args["account-id"]) answers.accountId = args["account-id"] as string;
    if (args["skip-cloudflare-setup"] !== undefined)
        answers.skipCloudflareSetup = Boolean(args["skip-cloudflare-setup"]);

    // Migration options
    if (args["apply-migrations"] && ["dev", "prod", "skip"].includes(args["apply-migrations"] as string)) {
        answers.applyMigrations = args["apply-migrations"] as "dev" | "prod" | "skip";
    }

    return answers;
}

async function migrate(cliArgs?: CliArgs) {
    const version = getPackageVersion();
    intro(`${pc.bold("Better Auth Cloudflare")} ${pc.gray("v" + version + " · migrate")}`);

    // Check for updates in the background
    checkForUpdates();

    // Check if we're in a project directory by looking for wrangler.toml
    const wranglerPath = join(process.cwd(), "wrangler.toml");
    if (!existsSync(wranglerPath)) {
        fatal("No wrangler.toml found. Please run this command from a Cloudflare Workers project directory.");
    }

    // Read and parse wrangler.toml to detect database configurations
    let wranglerContent: string;
    try {
        wranglerContent = readFileSync(wranglerPath, "utf8");
    } catch (e) {
        fatal("Failed to read wrangler.toml");
        return;
    }

    const { databases, hasMultipleDatabases } = parseWranglerToml(wranglerContent);

    if (databases.length === 0) {
        fatal("No database configurations found in wrangler.toml. Please configure a D1 or Hyperdrive database.");
    }

    const pm = detectPackageManager(process.cwd());
    const isNonInteractive = Boolean(cliArgs && Object.keys(cliArgs).length > 0);

    // Run auth:update
    const authSpinner = spinner();
    authSpinner.start("Running auth:update...");
    const authRes = runScript(pm, "auth:update", process.cwd());
    if (authRes.code === 0) {
        authSpinner.stop(pc.green("Auth schema updated."));
    } else {
        authSpinner.stop(pc.red("Failed to update auth schema."));
        assertOk(authRes, "Auth schema update failed.");
    }

    // Run db:generate
    const dbSpinner = spinner();
    dbSpinner.start("Running db:generate...");
    const dbRes = runScript(pm, "db:generate", process.cwd());
    if (dbRes.code === 0) {
        dbSpinner.stop(pc.green("Database migrations generated."));
    } else {
        dbSpinner.stop(pc.red("Failed to generate database migrations."));
        assertOk(dbRes, "Database migration generation failed.");
    }

    // Handle D1 database migrations
    const d1Databases = databases.filter(db => db.type === "d1");

    if (d1Databases.length === 0) {
        // No D1 databases found
        const hyperdriveCount = databases.filter(db => db.type === "hyperdrive").length;
        outro(
            pc.yellow(
                `Found ${hyperdriveCount} Hyperdrive database${hyperdriveCount === 1 ? "" : "s"}. Please apply migrations to your database using your preferred workflow.`
            )
        );
        return;
    }

    // Determine which D1 database to migrate
    let selectedDatabase = d1Databases[0];

    if (hasMultipleDatabases && d1Databases.length > 1) {
        if (isNonInteractive) {
            // In non-interactive mode, use the first D1 database found
            outro(
                pc.yellow(
                    `Multiple D1 databases found. Using first one: ${selectedDatabase.binding} (${selectedDatabase.name ?? "unnamed"})`
                )
            );
        } else {
            // Interactive mode - let user choose
            const choice = (await (select as any)({
                message: "Multiple D1 databases found. Which one would you like to migrate?",
                options: d1Databases.map(db => ({
                    value: db,
                    label: `${db.binding}${db.name ? ` (${db.name})` : ""}`,
                })),
                initialValue: selectedDatabase,
            })) as DatabaseConfig;
            selectedDatabase = choice;
        }
    }

    // Ask about migration target
    let migrateChoice: "dev" | "remote" | "skip" = "skip";

    if (isNonInteractive) {
        if (cliArgs && cliArgs["migrate-target"]) {
            const target = cliArgs["migrate-target"] as string;
            if (["dev", "remote", "skip"].includes(target)) {
                migrateChoice = target as "dev" | "remote" | "skip";
            } else {
                fatal("migrate-target must be 'dev', 'remote', or 'skip'");
            }
        }
    } else {
        const databaseLabel = selectedDatabase.name
            ? `${selectedDatabase.binding} (${selectedDatabase.name})`
            : selectedDatabase.binding;
        migrateChoice = (await (select as any)({
            message: `Apply D1 migrations for ${databaseLabel}?`,
            options: [
                { value: "dev", label: "Yes, apply locally (dev)" },
                { value: "remote", label: "Yes, apply to remote (prod)" },
                { value: "skip", label: "No, skip migration" },
            ],
            initialValue: "skip",
        })) as "dev" | "remote" | "skip";
    }

    if (migrateChoice === "dev") {
        const migSpinner = spinner();
        migSpinner.start("Applying migrations locally...");
        const migRes = runScript(pm, "db:migrate:dev", process.cwd());
        if (migRes.code === 0) {
            migSpinner.stop(pc.green("Migrations applied locally."));
        } else {
            migSpinner.stop(pc.red("Failed to apply local migrations."));
            assertOk(migRes, "Local migration failed.");
        }
    } else if (migrateChoice === "remote") {
        const migSpinner = spinner();
        migSpinner.start("Applying migrations to remote...");
        const migRes = runScript(pm, "db:migrate:prod", process.cwd());
        if (migRes.code === 0) {
            migSpinner.stop(pc.green("Migrations applied to remote."));
        } else {
            migSpinner.stop(pc.red("Failed to apply remote migrations."));
            assertOk(migRes, "Remote migration failed.");
        }
    }

    outro(pc.green("Migration completed successfully!"));
}

async function generate(cliArgs?: CliArgs) {
    const version = getPackageVersion();
    intro(`${pc.bold("Better Auth Cloudflare")} ${pc.gray("v" + version + " · generator")}`);

    // Check for updates in the background
    checkForUpdates();

    let answers: GenerateAnswers;

    if (cliArgs && Object.keys(cliArgs).length > 0) {
        // Non-interactive mode - use CLI arguments
        const validationErrors = validateCliArgs(cliArgs);
        if (validationErrors.length > 0) {
            fatal("Invalid arguments:\n" + validationErrors.map(e => `  - ${e}`).join("\n"));
        }

        const partialAnswers = cliArgsToAnswers(cliArgs);

        // Fill in required fields with defaults if not provided
        answers = {
            appName: partialAnswers.appName || "my-app",
            template: partialAnswers.template || "hono",
            database: partialAnswers.database || "d1",
            geolocation: partialAnswers.geolocation !== undefined ? partialAnswers.geolocation : true,
            kv: partialAnswers.kv !== undefined ? partialAnswers.kv : true,
            r2: partialAnswers.r2 !== undefined ? partialAnswers.r2 : false,
            // D1 defaults
            d1Name:
                partialAnswers.d1Name ||
                (partialAnswers.database === "d1" ? `${partialAnswers.appName || "my-app"}-db` : undefined),
            d1Binding: partialAnswers.d1Binding || (partialAnswers.database === "d1" ? "DATABASE" : undefined),
            // Hyperdrive defaults
            hdBinding: partialAnswers.hdBinding || (partialAnswers.database !== "d1" ? "HYPERDRIVE" : undefined),
            hdName:
                partialAnswers.hdName ||
                (partialAnswers.database !== "d1" ? `${partialAnswers.appName || "my-app"}-hyperdrive` : undefined),
            hdConnectionString: partialAnswers.hdConnectionString,
            // KV defaults
            kvBinding: partialAnswers.kvBinding || (partialAnswers.kv !== false ? "KV" : undefined),
            kvNamespaceName:
                partialAnswers.kvNamespaceName ||
                (partialAnswers.kv !== false ? `${partialAnswers.appName || "my-app"}-kv` : undefined),
            // R2 defaults
            r2Binding: partialAnswers.r2Binding || (partialAnswers.r2 ? "R2_BUCKET" : undefined),
            r2BucketName:
                partialAnswers.r2BucketName ||
                (partialAnswers.r2 ? `${partialAnswers.appName || "my-app"}-files` : undefined),
            // Cloudflare account configuration
            accountId: partialAnswers.accountId,
            skipCloudflareSetup:
                partialAnswers.skipCloudflareSetup !== undefined ? partialAnswers.skipCloudflareSetup : false,
            // Migration options
            applyMigrations: partialAnswers.applyMigrations || "skip",
        };

        // Additional validation for required fields in non-interactive mode
        if (answers.database !== "d1" && !answers.hdConnectionString) {
            fatal("hd-connection-string is required when using hyperdrive databases");
        }
    } else {
        // Interactive mode - use prompts
        answers = await group<GenerateAnswers>(
            {
                appName: () =>
                    text({
                        message: "Project name",
                        placeholder: "my-app",
                        validate: (v: string) => (!v || v.trim().length === 0 ? "Please enter a name" : undefined),
                    }) as Promise<string>,
                template: () => {
                    return (select as any)({
                        message: "Choose a template",
                        options: [
                            { value: "hono", label: "Hono (Workers)" },
                            { value: "nextjs", label: "OpenNext.js (Workers)" },
                        ],
                        initialValue: "hono",
                    }) as Promise<"hono" | "nextjs">;
                },
                database: () => {
                    return (select as any)({
                        message: "Database",
                        options: [
                            { value: "d1", label: "Cloudflare D1 (SQLite)" },
                            { value: "hyperdrive-postgres", label: "Hyperdrive (Postgres)" },
                            { value: "hyperdrive-mysql", label: "Hyperdrive (MySQL)" },
                        ],
                        initialValue: "d1",
                    }) as Promise<DbKind>;
                },
                d1Name: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.database === "d1"
                        ? (text({
                              message: "D1 database name",
                              placeholder: `${(results.appName as string) || "my-app"}-db`,
                              defaultValue: `${(results.appName as string) || "my-app"}-db`,
                          }) as Promise<string>)
                        : undefined,
                d1Binding: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.database === "d1"
                        ? (text({
                              message: "D1 binding name",
                              placeholder: "DATABASE",
                              defaultValue: "DATABASE",
                              validate: validateBindingName,
                          }) as Promise<string>)
                        : undefined,
                hdBinding: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.database !== "d1"
                        ? (text({
                              message: "Hyperdrive binding name",
                              placeholder: "HYPERDRIVE",
                              defaultValue: "HYPERDRIVE",
                              validate: validateBindingName,
                          }) as Promise<string>)
                        : undefined,
                hdName: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.database !== "d1"
                        ? (text({
                              message: "Hyperdrive instance name",
                              placeholder: `${(results.appName as string) || "my-app"}-hyperdrive`,
                              defaultValue: `${(results.appName as string) || "my-app"}-hyperdrive`,
                          }) as Promise<string>)
                        : undefined,
                hdConnectionString: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.database !== "d1"
                        ? (text({
                              message: "Origin database connection string",
                              placeholder: "postgres://user:pass@host:5432/db OR mysql://user:pass@host:3306/db",
                          }) as Promise<string>)
                        : undefined,
                geolocation: () =>
                    confirm({ message: "Enable geolocation tracking?", initialValue: true }) as Promise<boolean>,
                kv: () => confirm({ message: "Use KV as secondary storage?", initialValue: true }) as Promise<boolean>,
                kvBinding: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.kv
                        ? (text({
                              message: "KV binding name",
                              placeholder: "KV",
                              defaultValue: "KV",
                              validate: validateBindingName,
                          }) as Promise<string>)
                        : undefined,
                kvNamespaceName: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.kv
                        ? (text({
                              message: "KV namespace (Cloudflare) name",
                              placeholder: `${(results.appName as string) || "my-app"}-kv`,
                              defaultValue: `${(results.appName as string) || "my-app"}-kv`,
                          }) as Promise<string>)
                        : undefined,
                r2: () => confirm({ message: "Enable R2 file storage?", initialValue: false }) as Promise<boolean>,
                r2Binding: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.r2
                        ? (text({
                              message: "R2 binding name",
                              placeholder: "R2_BUCKET",
                              defaultValue: "R2_BUCKET",
                              validate: validateBindingName,
                          }) as Promise<string>)
                        : undefined,
                r2BucketName: ({ results }: { results: Partial<GenerateAnswers> }) =>
                    results.r2
                        ? (text({
                              message: "R2 bucket name",
                              placeholder: `${(results.appName as string) || "my-app"}-files`,
                              defaultValue: `${(results.appName as string) || "my-app"}-files`,
                          }) as Promise<string>)
                        : undefined,
            },
            {
                onCancel: () => {
                    cancel("Operation cancelled.");
                    process.exit(0);
                },
            }
        );
    }

    const s = spinner();

    const tmp = mkdtempSync(join(tmpdir(), "bacf-"));
    s.start("Cloning templates...");
    {
        const res = bunSpawnSync("git", [
            "clone",
            "--depth",
            "1",
            "https://github.com/zpg6/better-auth-cloudflare.git",
            tmp,
        ]);
        if (res.code === 0) s.stop("Templates ready.");
        else {
            s.stop("Failed to fetch templates.");
            assertOk(res, "Failed to clone repository. Please ensure git is installed.");
        }
    }

    const templateDir = answers.template === "hono" ? join(tmp, "examples/hono") : join(tmp, "examples/opennextjs");

    const targetDir = resolve(process.cwd(), answers.appName);
    try {
        ensureCleanAppDir(targetDir);
    } catch (err) {
        fatal((err as Error).message);
    }

    const copying = spinner();
    copying.start("Copying project files...");
    try {
        cpSync(templateDir, targetDir, { recursive: true });
    } catch (e) {
        copying.stop("Copy failed.");
        fatal("Failed to copy template files.");
    }
    copying.stop("Project files copied.");

    // Centralize project constants for future tooling

    // Update package.json name and dependencies and scripts to use chosen bindings
    const pkgPath = join(targetDir, "package.json");
    if (existsSync(pkgPath)) {
        try {
            updateJSON(pkgPath, j => {
                const deps = ((j.dependencies as JSONObject) || {}) as JSONObject;
                if (typeof deps["better-auth-cloudflare"] === "string") {
                    deps["better-auth-cloudflare"] = "latest";
                }
                if (answers.database === "hyperdrive-postgres") {
                    deps["postgres"] = deps["postgres"] || "^3.4.5";
                }
                if (answers.database === "hyperdrive-mysql") {
                    deps["mysql2"] = deps["mysql2"] || "^3.9.7";
                }
                const scripts = (j.scripts as JSONObject) || {};
                for (const key of Object.keys(scripts)) {
                    const val = String(scripts[key] as string);
                    if (answers.database === "d1" && answers.d1Binding) {
                        scripts[key] = val.replace(/wrangler\s+d1\s+migrations\s+apply\s+\w+/g, m =>
                            m.replace(/apply\s+\w+/, `apply ${answers.d1Binding}`)
                        ) as unknown as JSONValue;
                    }
                }
                return { ...j, name: answers.appName, dependencies: deps, scripts } as JSONObject;
            });
        } catch (e) {
            fatal("Failed to update package.json.");
        }
    }

    // Update wrangler.toml bindings and names
    const wranglerPath = join(targetDir, "wrangler.toml");
    if (existsSync(wranglerPath)) {
        try {
            let wrangler = readFileSync(wranglerPath, "utf8");

            if (answers.database === "d1" && answers.d1Name && answers.d1Binding) {
                wrangler = updateD1Block(wrangler, answers.d1Binding, answers.d1Name);
            }

            // Clear template KV blocks and add user's configuration
            if (answers.kv && answers.kvBinding) {
                wrangler = clearAllKvBlocks(wrangler);
                wrangler = appendOrReplaceKvNamespaceBlock(wrangler, answers.kvBinding);
            } else {
                // If user doesn't want KV, remove all KV blocks from template
                wrangler = clearAllKvBlocks(wrangler);
            }

            // Clear template R2 blocks and add user's configuration
            if (answers.r2 && answers.r2BucketName) {
                const r2Binding = answers.r2Binding || "R2_BUCKET";
                wrangler = clearAllR2Blocks(wrangler);
                wrangler = appendOrReplaceR2Block(wrangler, r2Binding, answers.r2BucketName);
            } else {
                // If user doesn't want R2, remove all R2 blocks from template
                wrangler = clearAllR2Blocks(wrangler);
            }

            writeFileSync(wranglerPath, wrangler);
        } catch (e) {
            fatal("Failed to update wrangler.toml.");
        }
    }

    // Tweak example source based on options
    const isHono = answers.template === "hono";
    const isNext = answers.template === "nextjs";

    try {
        if (isHono) {
            const authPath = join(targetDir, "src/auth/index.ts");
            tryUpdateFile(authPath, code => {
                let updated = code;
                if (answers.database === "d1" && answers.d1Binding) {
                    updated = updated.replace(/env\.DATABASE\b/g, `env.${answers.d1Binding}`);
                    updated = updated.replace(
                        /geolocationTracking:\s*true/g,
                        `geolocationTracking: ${String(answers.geolocation)}`
                    );
                } else if (answers.database === "hyperdrive-postgres" && answers.hdBinding) {
                    updated = updated.replace(/import\s+\{\s*drizzle\s*\}\s*from\s*"drizzle-orm\/d1";?/g, "");
                    if (!/from\s+"drizzle-orm\/postgres-js"/.test(updated)) {
                        updated =
                            `import { drizzle } from "drizzle-orm/postgres-js";\nimport postgres from "postgres";\n` +
                            updated;
                    }
                    updated = updated.replace(
                        /const\s+db\s*=\s*env\s*\?\s*drizzle\([^\)]*\)\s*:\s*\(\{\}\s+as\s+any\)\s*;/,
                        `const db = env ? drizzle(postgres(env.${answers.hdBinding}.connectionString), { schema, logger: true }) : ({} as any);`
                    );
                    updated = updated.replace(/d1:\s*env[^}]+}\s*,?/m, `postgres: { db },`);
                    updated = updated.replace(
                        /geolocationTracking:\s*true/g,
                        `geolocationTracking: ${String(answers.geolocation)}`
                    );
                } else if (answers.database === "hyperdrive-mysql" && answers.hdBinding) {
                    updated = updated.replace(/import\s+\{\s*drizzle\s*\}\s*from\s*"drizzle-orm\/d1";?/g, "");
                    if (!/from\s+"drizzle-orm\/mysql2"/.test(updated)) {
                        updated =
                            `import { drizzle } from "drizzle-orm/mysql2";\nimport mysql from "mysql2/promise";\n` +
                            updated;
                    }
                    updated = updated.replace(
                        /const\s+db\s*=\s*env\s*\?\s*drizzle\([^\)]*\)\s*:\s*\(\{\}\s+as\s+any\)\s*;/,
                        `const db = env ? drizzle(mysql.createPool(env.${answers.hdBinding}.connectionString), { schema }) : ({} as any);`
                    );
                    updated = updated.replace(/d1:\s*env[^}]+}\s*,?/m, `mysql: { db },`);
                    updated = updated.replace(
                        /geolocationTracking:\s*true/g,
                        `geolocationTracking: ${String(answers.geolocation)}`
                    );
                }
                if (answers.kv && answers.kvBinding) {
                    updated = updated.replace(/kv:\s*env\?\.KV/g, `kv: env?.${answers.kvBinding}`);
                } else {
                    updated = updated.replace(/kv:\s*env\?\.[A-Z_]+,?/g, "");
                }
                if (answers.r2 && answers.r2Binding) {
                    updated = updated.replace(/env\.R2_BUCKET\b/g, `env.${answers.r2Binding}`);
                }
                return updated;
            });

            const envPath = join(targetDir, "src/env.d.ts");
            tryUpdateFile(envPath, code => {
                let next = code;
                if (answers.database === "d1" && answers.d1Binding) {
                    next = next.replace(/DATABASE:\s*D1Database;/g, `${answers.d1Binding}: D1Database;`);
                }
                if (answers.database !== "d1" && answers.hdBinding) {
                    if (new RegExp(`${answers.hdBinding}:`).test(next) === false) {
                        next = next.replace(
                            /\}\n\n?declare\s+global[\s\S]*/m,
                            `${answers.hdBinding}: any;\n}\n\ndeclare global {\n    namespace NodeJS {\n        interface ProcessEnv extends CloudflareBindings {\n        }\n    }\n}`
                        );
                    }
                }
                if (answers.kv && answers.kvBinding) {
                    next = next.replace(/KV:\s*KVNamespace[^;]*;/g, `${answers.kvBinding}: KVNamespace;`);
                }
                if (answers.r2 && answers.r2Binding) {
                    if (/R2_BUCKET:\s*R2Bucket;/.test(next)) {
                        next = next.replace(/R2_BUCKET:\s*R2Bucket;/g, `${answers.r2Binding}: R2Bucket;`);
                    }
                }
                return next;
            });

            const drizzleCfg = join(targetDir, "drizzle.config.ts");
            tryUpdateFile(drizzleCfg, code => {
                if (answers.database === "hyperdrive-postgres") {
                    return code
                        .replace(/dialect:\s*"sqlite"/g, 'dialect: "postgresql"')
                        .replace(/driver:\s*"d1-http"[\s\S]*?\},/g, "");
                }
                if (answers.database === "hyperdrive-mysql") {
                    return code
                        .replace(/dialect:\s*"sqlite"/g, 'dialect: "mysql2"')
                        .replace(/driver:\s*"d1-http"[\s\S]*?\},/g, "");
                }
                return code;
            });
        }

        if (isNext) {
            const dbIndex = join(targetDir, "src/db/index.ts");
            tryUpdateFile(dbIndex, code => {
                if (answers.database === "d1" && answers.d1Binding) {
                    return code.replace(/env\.DATABASE\b/g, `env.${answers.d1Binding}`);
                }
                if (answers.database === "hyperdrive-postgres" && answers.hdBinding) {
                    let updated = code;
                    updated = updated.replace(
                        /import\s+\{\s*drizzle\s*\}\s*from\s*"drizzle-orm\/d1";?/g,
                        'import { drizzle } from "drizzle-orm/postgres-js";'
                    );
                    if (!/from\s+"postgres"/.test(updated)) {
                        updated = `import postgres from "postgres";\n` + updated;
                    }
                    updated = updated.replace(
                        /return\s+drizzle\(env\.[^)]+\)\s*,?\s*\{[\s\S]*?\}\);/m,
                        `return drizzle(postgres(env.${answers.hdBinding}.connectionString), {\n        schema,\n        logger: true,\n    });`
                    );
                    return updated;
                }
                if (answers.database === "hyperdrive-mysql" && answers.hdBinding) {
                    let updated = code;
                    updated = updated.replace(
                        /import\s+\{\s*drizzle\s*\}\s*from\s*"drizzle-orm\/d1";?/g,
                        'import { drizzle } from "drizzle-orm/mysql2";'
                    );
                    if (!/from\s+"mysql2\/promise"/.test(updated)) {
                        updated = `import mysql from "mysql2/promise";\n` + updated;
                    }
                    updated = updated.replace(
                        /return\s+drizzle\(env\.[^)]+\)\s*,?\s*\{[\s\S]*?\}\);/m,
                        `const pool = await mysql.createPool(env.${answers.hdBinding}.connectionString);\n    return drizzle(pool, {\n        schema,\n    });`
                    );
                    return updated;
                }
                return code;
            });

            const nextAuth = join(targetDir, "src/auth/index.ts");
            tryUpdateFile(nextAuth, code => {
                let updated = code;
                if (answers.database === "hyperdrive-postgres") {
                    updated = updated.replace(
                        /d1:\s*\{[\s\S]*?\},/m,
                        `postgres: {\n                    db: dbInstance,\n                },`
                    );
                }
                if (answers.database === "hyperdrive-mysql") {
                    updated = updated.replace(
                        /d1:\s*\{[\s\S]*?\},/m,
                        `mysql: {\n                    db: dbInstance,\n                },`
                    );
                }
                if (answers.kv && answers.kvBinding) {
                    updated = updated.replace(/process\.env\.KV\b/g, `process.env.${answers.kvBinding}`);
                } else {
                    updated = updated.replace(/\n\s*kv:\s*process\.env\.[A-Z_]+[^\n]*,?/g, "\n");
                }
                if (answers.r2 && answers.r2Binding) {
                    updated = updated.replace(
                        /getCloudflareContext\(\)\.env\.R2_BUCKET\b/g,
                        `getCloudflareContext().env.${answers.r2Binding}`
                    );
                }
                return updated;
            });

            const envPath = join(targetDir, "env.d.ts");
            tryUpdateFile(envPath, code => {
                let next = code;
                if (answers.database === "d1" && answers.d1Binding) {
                    next = next.replace(/DATABASE:\s*D1Database;/g, `${answers.d1Binding}: D1Database;`);
                }
                if (answers.database !== "d1" && answers.hdBinding) {
                    if (/HYPERDRIVE:/.test(next)) {
                        next = next.replace(/HYPERDRIVE:\s*.+;/g, `${answers.hdBinding}: any;`);
                    } else {
                        next = next.replace(/\}\s*$/m, `    ${answers.hdBinding}: any;\n}`);
                    }
                }
                if (answers.kv && answers.kvBinding) {
                    next = next.replace(/KV:\s*KVNamespace<[^>]+>;/g, `${answers.kvBinding}: KVNamespace<string>;`);
                }
                if (answers.r2 && answers.r2Binding) {
                    next = next.replace(/R2_BUCKET:\s*R2Bucket;/g, `${answers.r2Binding}: R2Bucket;`);
                }
                return next;
            });

            const drizzleCfg = join(targetDir, "drizzle.config.ts");
            tryUpdateFile(drizzleCfg, code => {
                if (answers.database === "hyperdrive-postgres") {
                    return code
                        .replace(/dialect:\s*"sqlite"/g, 'dialect: "postgresql"')
                        .replace(/driver:\s*"d1-http"[\s\S]*?\},/g, "");
                }
                if (answers.database === "hyperdrive-mysql") {
                    return code
                        .replace(/dialect:\s*"sqlite"/g, 'dialect: "mysql2"')
                        .replace(/driver:\s*"d1-http"[\s\S]*?\},/g, "");
                }
                return code;
            });
        }
    } catch (e) {
        fatal("Failed to update template source files.");
    }

    // Append subtle footer
    try {
        const readmePath = join(targetDir, "README.md");
        const footer = `\n\n—\nPowered by better-auth-cloudflare`;
        if (existsSync(readmePath)) {
            const current = readFileSync(readmePath, "utf8");
            if (!current.includes("Powered by better-auth-cloudflare")) {
                writeFileSync(readmePath, current.trimEnd() + footer);
            }
        }
    } catch (e) {
        fatal("Failed to update README.");
    }

    // Handle Cloudflare setup
    const isNonInteractive = Boolean(cliArgs && Object.keys(cliArgs).length > 0);
    let setup: boolean;

    if (isNonInteractive) {
        // Non-interactive mode
        setup = !answers.skipCloudflareSetup;
        if (answers.skipCloudflareSetup) {
            outro(pc.yellow("Skipping Cloudflare setup as requested."));
        }
    } else {
        // Interactive mode
        const confirmResult = await confirm({ message: "Run Cloudflare setup commands now?" });
        setup = confirmResult === true;
        if (!setup) {
            outro(pc.yellow("You can run wrangler setup later."));
        }
    }

    if (setup) {
        // Ensure user is authenticated and handle account selection
        const authResult = await ensureWranglerAuth(isNonInteractive);
        if (authResult === "skip-setup") {
            setup = false;
        }
    }

    if (setup) {
        const cwd = targetDir;

        if (answers.database === "d1" && answers.d1Name) {
            const creating = spinner();
            creating.start(`Creating D1 Database \`${answers.d1Name}\`...`);
            const res = runWranglerCommand(["d1", "create", answers.d1Name], cwd, answers.accountId);

            if (res.code === 0) {
                creating.stop(pc.green(`\`${answers.d1Name}\` created.`));
            } else if (
                res.stderr.includes("More than one account available but unable to select one in non-interactive mode")
            ) {
                creating.stop(pc.red("Failed to create D1 database."));
                const selectedAccountId = await handleAccountSelection(res.stderr, isNonInteractive);
                if (selectedAccountId) {
                    // Retry with selected account
                    creating.start(`Creating D1 Database \`${answers.d1Name}\`...`);
                    const retryRes = runWranglerCommand(["d1", "create", answers.d1Name], cwd, selectedAccountId);
                    if (retryRes.code === 0) {
                        creating.stop(pc.green(`\`${answers.d1Name}\` created.`));
                        answers.accountId = selectedAccountId; // Save for subsequent commands
                    } else {
                        creating.stop(pc.red("Failed to create D1 database."));
                        assertOk(retryRes, "D1 creation failed.");
                    }
                }
            } else {
                creating.stop(pc.red("Failed to create D1 database."));
                assertOk(res, "D1 creation failed.");
            }
        }

        if (answers.database !== "d1" && answers.hdName && answers.hdConnectionString && answers.hdBinding) {
            const creating = spinner();
            creating.start(`Creating Hyperdrive \`${answers.hdName}\`...`);
            const res = runWranglerCommand(
                ["hyperdrive", "create", answers.hdName, `--connection-string=${answers.hdConnectionString}`],
                cwd,
                answers.accountId
            );
            if (res.code === 0) {
                const match = /id:\s*([a-f0-9-]+)/i.exec(res.stdout);
                const id = match ? match[1] : undefined;
                if (id && existsSync(wranglerPath)) {
                    let wrangler = readFileSync(wranglerPath, "utf8");
                    wrangler = appendOrReplaceHyperdriveBlock(wrangler, answers.hdBinding, id);
                    writeFileSync(wranglerPath, wrangler);
                }
                creating.stop(pc.green(`Hyperdrive created${id ? " (id: " + id + ")" : ""}.`));
            } else {
                creating.stop(pc.red("Failed to create Hyperdrive."));
                assertOk(res, "Hyperdrive creation failed.");
            }
        }

        if (answers.kv && answers.kvNamespaceName && answers.kvBinding) {
            const creating = spinner();
            creating.start(`Creating KV Namespace \`${answers.kvNamespaceName}\`...`);
            const res = runWranglerCommand(["kv:namespace", "create", answers.kvNamespaceName], cwd, answers.accountId);
            if (res.code === 0) {
                const match = /id:\s*([a-f0-9-]+)/i.exec(res.stdout);
                const id = match ? match[1] : undefined;
                if (existsSync(wranglerPath)) {
                    let wrangler = readFileSync(wranglerPath, "utf8");
                    wrangler = appendOrReplaceKvNamespaceBlock(wrangler, answers.kvBinding, id);
                    writeFileSync(wranglerPath, wrangler);
                }
                creating.stop(pc.green(`KV namespace created${id ? " (id: " + id + ")" : ""}.`));
            } else {
                creating.stop(pc.red("Failed to create KV namespace."));
                assertOk(res, "KV namespace creation failed.");
            }
        }

        if (answers.r2 && answers.r2BucketName) {
            const creating = spinner();
            const r2Binding = answers.r2Binding || "R2_BUCKET";
            creating.start(`Creating R2 Bucket \`${answers.r2BucketName}\`...`);
            const res = runWranglerCommand(["r2", "bucket", "create", answers.r2BucketName], cwd, answers.accountId);
            if (res.code === 0) {
                if (existsSync(wranglerPath)) {
                    let wrangler = readFileSync(wranglerPath, "utf8");
                    wrangler = appendOrReplaceR2Block(wrangler, r2Binding, answers.r2BucketName);
                    writeFileSync(wranglerPath, wrangler);
                }
                creating.stop(pc.green(`\`${answers.r2BucketName}\` created.`));
            } else {
                creating.stop(pc.red("Failed to create R2 bucket."));
                assertOk(res, "R2 bucket creation failed.");
            }
        }
    }

    // Install deps before running scripts
    const pm = detectPackageManager(targetDir);
    let doInstall: boolean;

    if (isNonInteractive) {
        // In non-interactive mode, always install dependencies
        doInstall = true;
    } else {
        // In interactive mode, ask user
        const installResult = await confirm({ message: "Install dependencies now?", initialValue: true });
        doInstall = installResult === true;
    }

    if (doInstall) {
        const inst = spinner();
        inst.start("Installing dependencies...");
        const res = runInstall(pm, targetDir);
        if (res.code === 0) inst.stop(pc.green("Dependencies installed."));
        else {
            inst.stop(pc.red("Failed to install dependencies."));
            assertOk(res, "Dependency installation failed.");
        }
    }

    // Schema generation & migrations
    const genAuth = spinner();
    genAuth.start("Generating auth schema...");
    {
        const authRes = runScript(pm, "auth:update", targetDir);
        if (authRes.code === 0) genAuth.stop(pc.green("Auth schema updated."));
        else {
            genAuth.stop(pc.red("Failed to generate auth schema."));
            assertOk(authRes, "Auth schema generation failed.");
        }
    }

    const genDb = spinner();
    genDb.start("Generating Drizzle migrations...");
    {
        const dbGenRes = runScript(pm, "db:generate", targetDir);
        if (dbGenRes.code === 0) genDb.stop(pc.green("Drizzle migrations generated."));
        else {
            genDb.stop(pc.red("Failed to generate migrations."));
            assertOk(dbGenRes, "Migration generation failed.");
        }
    }

    if (answers.database === "d1" && !answers.skipCloudflareSetup) {
        let migrateChoice: "dev" | "prod" | "skip";

        if (isNonInteractive) {
            // In non-interactive mode, use the CLI argument or default to skip
            migrateChoice = answers.applyMigrations || "skip";
        } else {
            // In interactive mode, ask user
            migrateChoice = (await (select as any)({
                message: "Apply D1 migrations now?",
                options: [
                    { value: "dev", label: "Yes, apply locally (wrangler d1 --local)" },
                    { value: "prod", label: "Yes, apply to remote (wrangler d1 --remote)" },
                    { value: "skip", label: "No, I'll do it later" },
                ],
                initialValue: "skip",
            })) as "dev" | "prod" | "skip";
        }

        if (migrateChoice === "dev") {
            const mig = spinner();
            mig.start("Applying migrations locally...");
            const res = runScript(pm, "db:migrate:dev", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied locally."));
            else {
                mig.stop(pc.red("Failed to apply local migrations."));
                assertOk(res, "Local migration failed.");
            }
        } else if (migrateChoice === "prod") {
            const mig = spinner();
            mig.start("Applying migrations remotely...");
            const res = runScript(pm, "db:migrate:prod", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied remotely."));
            else {
                mig.stop(pc.red("Failed to apply remote migrations."));
                assertOk(res, "Remote migration failed.");
            }
        }
    }

    // Final instructions
    const pmDev = pm === "yarn" ? "yarn dev" : pm === "npm" ? "npm run dev" : `${pm} run dev`;
    const runScriptHelp = (name: string) =>
        pm === "yarn" ? `yarn ${name}` : pm === "npm" ? `npm run ${name}` : `${pm} run ${name}`;

    const lines: string[] = [];
    lines.push(`${pc.green("✔")} ${pc.bold("Project created!")}`);
    lines.push(`  ${pc.cyan("cd")} ${answers.appName}`);
    lines.push(`  ${pc.cyan(pmDev)}  ${pc.gray("# Start dev server")}`);
    lines.push("");
    lines.push(pc.bold("Common scripts:"));
    lines.push(`  ${runScriptHelp("auth:update")}   ${pc.gray("# Generate Better Auth schema")}`);
    lines.push(`  ${runScriptHelp("db:generate")}   ${pc.gray("# Create Drizzle migrations")}`);
    if (answers.database === "d1") {
        lines.push(`  ${runScriptHelp("db:migrate:dev")} ${pc.gray("# Apply migrations locally (D1)")}`);
        lines.push(`  ${runScriptHelp("db:migrate:prod")} ${pc.gray("# Apply migrations to remote (D1)")}`);
    } else {
        lines.push(
            pc.gray(
                "Apply migrations to your Postgres/MySQL database using your preferred workflow (Drizzle Kit push/migrate)."
            )
        );
    }
    lines.push(`  ${runScriptHelp("db:studio:dev")} ${pc.gray("# Open Drizzle Studio (local)")}`);
    lines.push(`  ${runScriptHelp("db:studio:prod")} ${pc.gray("# Open Drizzle Studio (remote)")}`);
    lines.push("");
    lines.push(pc.gray("Refer to the example README for more details and deployment commands."));

    outro(lines.join("\n"));
}

function printHelp() {
    const version = getPackageVersion();
    // Check for updates in the background
    checkForUpdates();

    const help =
        `\n${pc.bold("@better-auth-cloudflare/cli")} ${pc.gray("v" + version)}\n\n` +
        `Usage:\n` +
        `  npx @better-auth-cloudflare/cli                         Run interactive generator\n` +
        `  npx @better-auth-cloudflare/cli generate                Run interactive generator\n` +
        `  npx @better-auth-cloudflare/cli migrate                 Run migration workflow\n` +
        `  npx @better-auth-cloudflare/cli version                 Show version information\n` +
        `  npx @better-auth-cloudflare/cli --version               Show version information\n` +
        `  npx @better-auth-cloudflare/cli -v                      Show version information\n` +
        `  npx @better-auth-cloudflare/cli --app-name=my-app ...   Run with arguments\n` +
        `  bunx @better-auth-cloudflare/cli --app-name=my-app ...  Run with arguments\n` +
        `\n` +
        `Arguments:\n` +
        `  --app-name=<name>              Project name (default: my-app)\n` +
        `  --template=<template>          hono | nextjs (default: hono)\n` +
        `  --database=<db>                d1 | hyperdrive-postgres | hyperdrive-mysql (default: d1)\n` +
        `  --geolocation=<bool>           Enable geolocation tracking (default: true)\n` +
        `  --kv=<bool>                    Use KV as secondary storage for Better Auth (default: true)\n` +
        `  --r2=<bool>                    Enable R2 to extend Better Auth with user file storage (default: false)\n` +
        `\n` +
        `Database-specific arguments:\n` +
        `  --d1-name=<name>               D1 database name (default: <app-name>-db)\n` +
        `  --d1-binding=<binding>         D1 binding name (default: DATABASE)\n` +
        `  --hd-name=<name>               Hyperdrive instance name (default: <app-name>-hyperdrive)\n` +
        `  --hd-binding=<binding>         Hyperdrive binding name (default: HYPERDRIVE)\n` +
        `  --hd-connection-string=<url>   Database connection string (required for hyperdrive)\n` +
        `\n` +
        `Storage arguments:\n` +
        `  --kv-binding=<binding>         KV binding name (default: KV)\n` +
        `  --kv-namespace-name=<name>     KV namespace name (default: <app-name>-kv)\n` +
        `  --r2-binding=<binding>         R2 binding name (default: R2_BUCKET)\n` +
        `  --r2-bucket-name=<name>        R2 bucket name (default: <app-name>-files)\n` +
        `\n` +
        `Cloudflare account arguments:\n` +
        `  --account-id=<id>              Cloudflare account ID (only required if you have multiple accounts)\n` +
        `  --skip-cloudflare-setup=<bool> Skip Cloudflare resource creation (default: false)\n` +
        `  --apply-migrations=<choice>    Apply D1 migrations: dev | prod | skip (default: skip)\n` +
        `\n` +
        `Migrate command arguments:\n` +
        `  --migrate-target=<target>      For migrate command: dev | remote | skip (default: skip)\n` +
        `\n` +
        `Examples:\n` +
        `  # Create a Hono app with D1 database\n` +
        `  npx @better-auth-cloudflare/cli --app-name=my-hono-app --template=hono --database=d1\n` +
        `\n` +
        `  # Create a Next.js app with PostgreSQL via Hyperdrive\n` +
        `  npx @better-auth-cloudflare/cli --app-name=my-next-app --template=nextjs \\\n` +
        `    --database=hyperdrive-postgres --hd-connection-string=postgres://user:pass@host:5432/db\n` +
        `\n` +
        `  # Create app without KV or R2\n` +
        `  npx @better-auth-cloudflare/cli --app-name=minimal-app --kv=false --r2=false\n` +
        `\n` +
        `  # Skip Cloudflare setup (useful for CI/CD)\n` +
        `  npx @better-auth-cloudflare/cli --app-name=ci-app --skip-cloudflare-setup=true\n` +
        `\n` +
        `  # Specify account ID for non-interactive mode\n` +
        `  npx @better-auth-cloudflare/cli --app-name=prod-app --account-id=your-account-id\n` +
        `\n` +
        `  # Apply migrations automatically in non-interactive mode\n` +
        `  npx @better-auth-cloudflare/cli --app-name=auto-app --apply-migrations=dev\n` +
        `\n` +
        `  # Run migration workflow interactively\n` +
        `  npx @better-auth-cloudflare/cli migrate\n` +
        `\n` +
        `  # Run migration workflow with non-interactive target\n` +
        `  npx @better-auth-cloudflare/cli migrate --migrate-target=dev\n` +
        `\n` +
        `Creates a new Better Auth Cloudflare project from Hono or OpenNext.js templates,\n` +
        `optionally creating Cloudflare D1, KV, R2, or Hyperdrive resources for you.\n` +
        `The migrate command runs auth:update, db:generate, and optionally db:migrate.\n`;
    // eslint-disable-next-line no-console
    console.log(help);
}

const cmd = process.argv[2];

// Check for version first
if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    printVersion();
    checkForUpdates();
} else if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
} else if (cmd === "migrate") {
    // Handle migrate command
    const hasCliArgs = process.argv.slice(3).some(arg => arg.startsWith("--"));
    const cliArgs = hasCliArgs ? parseCliArgs(process.argv) : undefined;
    migrate(cliArgs).catch(err => {
        fatal(String(err?.message ?? err));
    });
} else {
    // Check if we have CLI arguments (starts with --)
    const hasCliArgs = process.argv.slice(2).some(arg => arg.startsWith("--"));

    if (!cmd || cmd === "generate" || hasCliArgs) {
        // If no command is specified and no CLI args, show help with version
        if (!cmd && !hasCliArgs) {
            printHelp();
        } else {
            const cliArgs = hasCliArgs ? parseCliArgs(process.argv) : undefined;
            generate(cliArgs).catch(err => {
                fatal(String(err?.message ?? err));
            });
        }
    } else {
        printHelp();
        process.exit(1);
    }
}
