#!/usr/bin/env node
import { cancel, confirm, group, intro, outro, select, spinner, text } from "@clack/prompts";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import pc from "picocolors";
import {
    appendOrReplaceHyperdriveBlock,
    extractD1DatabaseId,
    extractHyperdriveId,
    extractKvNamespaceId,
    parseWranglerToml,
    updateD1BlockWithId,
    updateHyperdriveBlockWithId,
    updateKvBlockWithId,
    type DatabaseConfig,
} from "./lib/helpers.js";

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
    verbose?: boolean;
}

// JSON typing helpers (avoid any/unknown)
export type JSONValue = string | number | boolean | null | JSONArray | JSONObject;
export interface JSONObject {
    [key: string]: JSONValue;
}
export interface JSONArray extends Array<JSONValue> {}

type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

// Global verbose flag state
let isVerbose = false;

function debugLog(message: string): void {
    if (isVerbose) {
        process.stderr.write(`${pc.gray("|")}  ${pc.cyan("DEBUG:")} ${pc.gray(message)}\n`);
    }
}

function bunSpawnSync(command: string, args: string[], cwd?: string, env?: Record<string, string>) {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const result = spawnSync(command, args, {
        stdio: "pipe",
        cwd,
        encoding: "utf8",
        env: env ? { ...process.env, ...env } : process.env,
    });

    // Enhanced error logging for debugging
    if (result.status !== 0) {
        debugLog(`Command failed: ${command} ${args.join(" ")}`);
        debugLog(`CWD: ${cwd || "default"}`);
        debugLog(`Status: ${result.status}`);
        debugLog(`Stdout: ${result.stdout || "empty"}`);
        debugLog(`Stderr: ${result.stderr || "empty"}`);
        debugLog(`Error: ${result.error || "none"}`);
    }

    return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function commandAvailable(command: string): boolean {
    const res = bunSpawnSync(command, ["--version"]);
    return (res.code ?? 1) === 0;
}

function fatal(message: string, details?: string) {
    if (details && details.trim()) process.stdout.write(details);
    outro(pc.red(message));
    console.log(pc.gray("\nNeed help?"));
    console.log(pc.cyan("  Get help (usage, arguments): npx @better-auth-cloudflare/cli --help"));
    console.log(pc.cyan("  Cloudflare Status: https://www.cloudflarestatus.com/"));
    console.log(pc.cyan("  Report issues: https://github.com/zpg6/better-auth-cloudflare/issues"));
    process.exit(1);
}

function assertOk(result: { code: number; stdout?: string; stderr?: string }, failMessage: string) {
    if (result.code !== 0) fatal(failMessage, result.stderr || result.stdout || "");
}

function detectPackageManager(cwd: string): PackageManager {
    if (existsSync(join(cwd, "bun.lockb")) && commandAvailable("bun")) return "bun";
    if (existsSync(join(cwd, "pnpm-lock.yaml")) && commandAvailable("pnpm")) return "pnpm";
    if (existsSync(join(cwd, "yarn.lock")) && commandAvailable("yarn")) return "yarn";
    if (commandAvailable("npm")) return "npm";
    if (commandAvailable("bun")) return "bun";
    if (commandAvailable("pnpm")) return "pnpm";
    if (commandAvailable("yarn")) return "yarn";
    return "npm";
}

function detectPackageManagerForAuth(cwd: string): PackageManager {
    // Always use npm for auth commands to ensure consistency
    if (commandAvailable("npm")) return "npm";
    // Fallback to regular detection if npm is not available
    return detectPackageManager(cwd);
}

function runScript(pm: PackageManager, script: string, cwd: string) {
    const args = pm === "bun" ? ["run", script] : pm === "yarn" ? [script] : ["run", script];
    return bunSpawnSync(pm, args, cwd);
}

function runInstall(pm: PackageManager, cwd: string) {
    const args = pm === "yarn" ? [] : ["install"];
    debugLog(`Running install: ${pm} ${args.join(" ")} in ${cwd}`);
    const result = bunSpawnSync(pm, args, cwd);
    debugLog(`Install result: code=${result.code}`);

    // Verify installation actually worked by checking for node_modules
    const nodeModulesPath = join(cwd, "node_modules");
    const actuallyInstalled = existsSync(nodeModulesPath);
    debugLog(`node_modules exists: ${actuallyInstalled}`);

    if (result.code === 0 && !actuallyInstalled) {
        // Installation claimed success but didn't create node_modules
        debugLog(`Installation failed - no node_modules created`);
        return {
            code: 1,
            stdout: result.stdout,
            stderr: result.stderr + "\nInstallation failed: no node_modules directory created",
        };
    }

    return result;
}

function runWranglerCommand(args: string[], cwd: string, accountId?: string) {
    const env = accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : undefined;
    debugLog(`Running wrangler command: wrangler ${args.join(" ")}${accountId ? " (with account ID)" : ""}`);
    return bunSpawnSync("npx", ["wrangler", ...args], cwd, env);
}

function checkD1DatabaseExists(databaseName: string, cwd: string, accountId?: string): boolean {
    if (!databaseName || databaseName.startsWith("YOUR_")) {
        return false;
    }

    const result = runWranglerCommand(["d1", "list", "--json"], cwd, accountId);
    if (result.code === 0) {
        try {
            const databases = JSON.parse(result.stdout);
            return databases.some((db: any) => db.name === databaseName);
        } catch {
            return false;
        }
    }
    return false;
}

function checkHyperdriveExists(hyperdriveId: string, cwd: string, accountId?: string): boolean {
    if (!hyperdriveId || hyperdriveId.startsWith("YOUR_")) {
        return false;
    }

    const result = runWranglerCommand(["hyperdrive", "get", hyperdriveId], cwd, accountId);
    return result.code === 0;
}

// Functions to get IDs of existing resources
function getExistingD1DatabaseId(databaseName: string, cwd: string, accountId?: string): string | null {
    try {
        console.log(`[DEBUG] Attempting to get D1 ID for database: ${databaseName}`);
        const result = runWranglerCommand(["d1", "list", "--json"], cwd, accountId);
        console.log(`[DEBUG] D1 list command result - code: ${result.code}`);
        console.log(`[DEBUG] D1 list stderr: ${result.stderr}`);
        console.log(`[DEBUG] D1 list stdout: ${result.stdout}`);
        if (result.code === 0) {
            // Parse the JSON output to find the database by name
            const databases = JSON.parse(result.stdout);
            const database = databases.find((db: any) => db.name === databaseName);
            const extractedId = database?.uuid || null;
            console.log(`[DEBUG] Extracted D1 ID: ${extractedId}`);
            return extractedId;
        }
        console.log(`[DEBUG] D1 list command failed with code: ${result.code}`);
        return null;
    } catch (error) {
        console.log(`[DEBUG] D1 list command threw error: ${error}`);
        return null;
    }
}

function getExistingKvNamespaceId(namespaceName: string, cwd: string, accountId?: string): string | null {
    try {
        const result = runWranglerCommand(["kv", "namespace", "list"], cwd, accountId);
        if (result.code === 0) {
            // Parse the JSON output to find the namespace by name
            const namespaces = JSON.parse(result.stdout);
            const namespace = namespaces.find((ns: any) => ns.title === namespaceName);
            return namespace?.id || null;
        }
        return null;
    } catch {
        return null;
    }
}

function getExistingHyperdriveId(hyperdriveName: string, cwd: string, accountId?: string): string | null {
    try {
        const result = runWranglerCommand(["hyperdrive", "list"], cwd, accountId);
        if (result.code === 0) {
            // Parse the table format from `wrangler hyperdrive list` command
            const lines = result.stdout.split("\n");
            for (const line of lines) {
                // Look for a line that contains the hyperdrive name and extract the ID from the first column
                if (line.includes(hyperdriveName)) {
                    // Extract ID from first column: │ id │ name │ ...
                    const idMatch = /│\s*([0-9a-f]{32})\s*│/.exec(line);
                    if (idMatch) {
                        return idMatch[1];
                    }
                }
            }
        }
        return null;
    } catch {
        return null;
    }
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
    const placeholderId = id || "YOUR_KV_NAMESPACE_ID";
    const newBlock = ["[[kv_namespaces]]", `binding = "${binding}"`, `id = "${placeholderId}"`].join("\n");

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

export function clearAllR2Blocks(toml: string) {
    return toml.replace(/\[\[r2_buckets\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
}

export function clearAllHyperdriveBlocks(toml: string) {
    return toml.replace(/\[\[hyperdrive\]\][\s\S]*?(?=(\n\[\[|$))/g, "");
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

        // Handle short flags like -v
        if (arg === "-v") {
            args.verbose = true;
        }
        // Handle --key=value format
        else if (arg.startsWith("--") && arg.includes("=")) {
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
    // Set verbose mode if specified
    if (cliArgs?.verbose) {
        isVerbose = true;
        debugLog("Verbose mode enabled");
    }

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
    debugLog(`Reading wrangler.toml from: ${wranglerPath}`);
    let wranglerContent: string;
    try {
        wranglerContent = readFileSync(wranglerPath, "utf8");
    } catch (e) {
        fatal("Failed to read wrangler.toml");
        return;
    }

    const { databases, hasMultipleDatabases } = parseWranglerToml(wranglerContent);
    debugLog(`Found ${databases.length} database configuration(s) in wrangler.toml`);

    if (databases.length === 0) {
        fatal("No database configurations found in wrangler.toml. Please configure a D1 or Hyperdrive database.");
    }

    const pm = detectPackageManager(process.cwd());
    debugLog(`Detected package manager: ${pm}`);
    const isNonInteractive = Boolean(cliArgs && Object.keys(cliArgs).length > 0);
    debugLog(`Running in ${isNonInteractive ? "non-interactive" : "interactive"} mode`);

    // Determine migration target early to potentially skip database checks
    let migrateChoice: "dev" | "remote" | "skip" = "skip";

    if (isNonInteractive) {
        if (cliArgs && cliArgs["migrate-target"]) {
            const target = cliArgs["migrate-target"] as string;
            if (["dev", "remote", "skip"].includes(target)) {
                migrateChoice = target as "dev" | "remote" | "skip";
                debugLog(`Migration target set to: ${migrateChoice}`);
            } else {
                fatal("migrate-target must be 'dev', 'remote', or 'skip'");
            }
        }
    }

    // Run auth:update - use npm specifically for auth commands
    debugLog("Running auth:update script");
    const authSpinner = spinner();
    authSpinner.start("Running auth:update...");
    const authPm = detectPackageManagerForAuth(process.cwd());
    debugLog(`Using package manager for auth commands: ${authPm}`);
    const authRes = runScript(authPm, "auth:update", process.cwd());
    if (authRes.code === 0) {
        authSpinner.stop(pc.green("Auth schema updated."));

        // Check if multi-tenancy is enabled and split schemas if needed
        const { detectMultiTenancy, splitAuthSchema } = await import("./lib/tenant-migration-generator.js");
        if (detectMultiTenancy(process.cwd())) {
            debugLog("Multi-tenancy detected, splitting auth schema");
            const splitSpinner = spinner();
            splitSpinner.start("Splitting schema for multi-tenancy...");
            try {
                await splitAuthSchema(process.cwd());
                splitSpinner.stop(
                    pc.green("Schema split into auth.schema.ts (core) and tenant.schema.ts (tenant-specific).")
                );
            } catch (error) {
                splitSpinner.stop(pc.yellow("Schema splitting failed, continuing with single schema."));
                debugLog(`Schema splitting error: ${error}`);
            }
        }
    } else {
        authSpinner.stop(pc.red("Failed to update auth schema."));
        assertOk(authRes, "Auth schema update failed.");
    }

    // Run db:generate
    debugLog("Running db:generate script");
    const dbSpinner = spinner();
    dbSpinner.start("Running db:generate...");
    const dbRes = runScript(pm, "db:generate", process.cwd());
    if (dbRes.code === 0) {
        dbSpinner.stop(pc.green("Database migrations generated."));
    } else {
        dbSpinner.stop(pc.red("Failed to generate database migrations."));
        assertOk(dbRes, "Database migration generation failed.");
    }

    // If migration target is skip, exit early
    if (migrateChoice === "skip") {
        debugLog("Migration target is skip, skipping database migration");
        outro(pc.green("Migration completed successfully! Database migration was skipped as requested."));
        return;
    }

    // Handle D1 database migrations
    const d1Databases = databases.filter(db => db.type === "d1");

    if (d1Databases.length === 0) {
        // No D1 databases found
        const hyperdriveDatabases = databases.filter(db => db.type === "hyperdrive");
        const existingHyperdriveDatabases = hyperdriveDatabases.filter(db => {
            if (!db.id) return false;
            return checkHyperdriveExists(db.id, process.cwd());
        });

        if (hyperdriveDatabases.length > 0 && existingHyperdriveDatabases.length === 0) {
            outro(
                pc.yellow(
                    `Found ${hyperdriveDatabases.length} Hyperdrive configuration(s) but none exist in your account. Please create your Hyperdrive instance(s) first, then apply migrations using: bun run db:migrate:dev or bun run db:migrate:prod`
                )
            );
        } else {
            outro(
                pc.yellow(
                    `Found ${existingHyperdriveDatabases.length} Hyperdrive database${existingHyperdriveDatabases.length === 1 ? "" : "s"}. Apply migrations to your database using: bun run db:migrate:dev or bun run db:migrate:prod`
                )
            );
        }
        return;
    }

    // Check if any D1 databases actually exist
    debugLog(`Checking existence of ${d1Databases.length} D1 database(s)`);
    const existingD1Databases = d1Databases.filter(db => {
        if (!db.name) return false;
        const exists = checkD1DatabaseExists(db.name, process.cwd());
        debugLog(`D1 database ${db.binding} (${db.name}): ${exists ? "exists" : "not found"}`);
        return exists;
    });

    if (existingD1Databases.length === 0) {
        outro(
            pc.yellow(
                `No existing D1 databases found in your account. Skipping db:migrate. Please create your D1 database(s) first, then rerun: npx @better-auth-cloudflare/cli migrate`
            )
        );
        return;
    }

    // Determine which D1 database to migrate
    let selectedDatabase = existingD1Databases[0];

    if (hasMultipleDatabases && existingD1Databases.length > 1) {
        if (isNonInteractive) {
            // In non-interactive mode, use the first existing D1 database found
            outro(
                pc.yellow(
                    `Multiple existing D1 databases found. Using first one: ${selectedDatabase.binding} (${selectedDatabase.name ?? "unnamed"})`
                )
            );
        } else {
            // Interactive mode - let user choose
            const choice = (await (select as any)({
                message: "Multiple existing D1 databases found. Which one would you like to migrate?",
                options: existingD1Databases.map(db => ({
                    value: db,
                    label: `${db.binding}${db.name ? ` (${db.name})` : ""}`,
                })),
                initialValue: selectedDatabase,
            })) as DatabaseConfig;
            selectedDatabase = choice;
        }
    }

    // Ask about migration target (interactive mode only)
    if (!isNonInteractive) {
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
        debugLog("Applying migrations locally (dev environment)");
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
        debugLog("Applying migrations to remote (production environment)");
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
    // Set verbose mode if specified
    if (cliArgs?.verbose) {
        isVerbose = true;
        debugLog("Verbose mode enabled");
    }

    const version = getPackageVersion();
    intro(`${pc.bold("Better Auth Cloudflare")} ${pc.gray("v" + version + " · generator")}`);

    // Check for updates in the background
    checkForUpdates();

    let answers: GenerateAnswers;

    if (cliArgs && Object.keys(cliArgs).length > 0) {
        // Non-interactive mode - use CLI arguments
        debugLog(`Non-interactive mode detected with ${Object.keys(cliArgs).length} arguments`);
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
    debugLog(`Using template: ${answers.template} from ${templateDir}`);

    const targetDir = resolve(process.cwd(), answers.appName);
    debugLog(`Target directory: ${targetDir}`);
    try {
        ensureCleanAppDir(targetDir);
    } catch (err) {
        fatal((err as Error).message);
    }

    const copying = spinner();
    copying.start("Copying project files...");
    debugLog(`Copying template files from ${templateDir} to ${targetDir}`);
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
        debugLog(`Updating package.json: ${pkgPath}`);
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
                    } else if (answers.database !== "d1") {
                        // For Hyperdrive, replace D1 migration commands with Drizzle commands
                        if (val.includes("wrangler d1 migrations apply")) {
                            scripts[key] = val
                                .replace(/wrangler d1 migrations apply \w+ --local/, "drizzle-kit migrate")
                                .replace(
                                    /wrangler d1 migrations apply \w+ --remote/,
                                    "drizzle-kit migrate"
                                ) as unknown as JSONValue;
                        }
                    }
                }
                return { ...j, name: answers.appName, dependencies: deps, scripts } as JSONObject;
            });
        } catch (e) {
            fatal("Failed to update package.json.");
        }
    }

    // Create .env file for Hyperdrive projects
    if (answers.database !== "d1" && answers.hdConnectionString) {
        const envPath = join(targetDir, ".env");
        debugLog(`Creating .env file: ${envPath}`);
        const envContent = `# Database connection string for Drizzle migrations\nDATABASE_URL="${answers.hdConnectionString}"\n`;
        writeFileSync(envPath, envContent, "utf8");
    }

    // Clear existing schema and migration files for non-D1 databases
    // This ensures they get regenerated with the correct database type
    if (answers.database !== "d1") {
        // Temporarily patch both schema.ts and index.ts to avoid circular dependency during auth generation
        const schemaPath = join(targetDir, "src/db/schema.ts");
        const indexPath = join(targetDir, "src/db/index.ts");
        let originalSchemaContent = "";
        let originalIndexContent = "";

        if (existsSync(schemaPath)) {
            originalSchemaContent = readFileSync(schemaPath, "utf8");
            debugLog(`Temporarily modifying schema file: ${schemaPath}`);
            // Create temporary schema without auth.schema import
            const tempSchemaContent = `// Temporary schema for auth generation
export const schema = {} as const;`;
            writeFileSync(schemaPath, tempSchemaContent, "utf8");
        }

        if (existsSync(indexPath)) {
            originalIndexContent = readFileSync(indexPath, "utf8");
            // Regenerate index.ts without auth.schema export for Next.js projects
            if (answers.template === "nextjs") {
                const { generateDbIndex } = await import("./lib/db-generator");
                const tempDbConfig = {
                    template: "nextjs" as const,
                    database: answers.database.startsWith("hyperdrive-postgres")
                        ? ("postgres" as const)
                        : answers.database.startsWith("hyperdrive-mysql")
                          ? ("mysql" as const)
                          : ("sqlite" as const),
                    bindings: {
                        d1: answers.d1Binding,
                        hyperdrive: answers.hdBinding,
                    },
                    excludeAuthSchema: true, // Exclude auth.schema during auth generation
                };
                const tempIndexContent = generateDbIndex(tempDbConfig);
                writeFileSync(indexPath, tempIndexContent, "utf8");
            } else {
                // For Hono, use simple string replacement
                const tempIndexContent = originalIndexContent
                    .replace('export * from "./auth.schema";', "// Temporary: auth.schema export removed")
                    .replace('export * from "./auth.schema"', "// Temporary: auth.schema export removed");
                writeFileSync(indexPath, tempIndexContent, "utf8");
            }
        }

        const authSchemaPath = join(targetDir, "src/db/auth.schema.ts");
        if (existsSync(authSchemaPath)) {
            rmSync(authSchemaPath, { force: true });
        }

        // Create a temporary empty auth.schema.ts to avoid import errors during auth generation
        debugLog(`Creating temporary auth schema: ${authSchemaPath}`);
        const tempAuthSchema = `// Temporary empty auth schema for generation
export const user = {} as any;
export const session = {} as any;
export const account = {} as any;
export const verification = {} as any;`;
        writeFileSync(authSchemaPath, tempAuthSchema, "utf8");

        const drizzleDir = join(targetDir, "drizzle");
        if (existsSync(drizzleDir)) {
            rmSync(drizzleDir, { recursive: true, force: true });
        }

        // Store original content for later restoration
        if (originalSchemaContent) {
            const tempSchemaBackupPath = join(targetDir, ".schema-backup.tmp");
            writeFileSync(tempSchemaBackupPath, originalSchemaContent, "utf8");
        }
        if (originalIndexContent) {
            const tempIndexBackupPath = join(targetDir, ".index-backup.tmp");
            writeFileSync(tempIndexBackupPath, originalIndexContent, "utf8");
        }
    }

    // Ensure .env is in .gitignore
    const gitignorePath = join(targetDir, ".gitignore");
    if (existsSync(gitignorePath)) {
        const gitignoreContent = readFileSync(gitignorePath, "utf8");
        // Check for exact .env line, not just substring
        if (!gitignoreContent.split("\n").some(line => line.trim() === ".env")) {
            writeFileSync(gitignorePath, gitignoreContent + "\n# Environment variables\n.env\n", "utf8");
        }
    } else {
        // Create .gitignore if it doesn't exist
        const gitignoreContent = `# Environment variables\n.env\n`;
        writeFileSync(gitignorePath, gitignoreContent, "utf8");
    }

    // Helper function to generate wrangler config
    const createWranglerConfig = (resourceIds: any = {}) => ({
        appName: answers.appName,
        template: answers.template as "hono" | "nextjs",
        resources: {
            d1: answers.database === "d1",
            kv: Boolean(answers.kv),
            r2: Boolean(answers.r2),
            hyperdrive: answers.database.startsWith("hyperdrive"),
        },
        bindings: {
            d1: answers.d1Binding,
            kv: answers.kvBinding,
            r2: answers.r2Binding,
            hyperdrive: answers.hdBinding,
        },
        skipCloudflareSetup: answers.skipCloudflareSetup,
        resourceIds: {
            r2BucketName: answers.r2BucketName,
            ...resourceIds,
        },
    });

    // Generate initial wrangler.toml (will be updated after resource creation)
    const { generateWranglerToml } = await import("./lib/wrangler-generator");
    const wranglerPath = join(targetDir, "wrangler.toml");
    debugLog(`Creating wrangler.toml: ${wranglerPath}`);
    const initialWrangler = generateWranglerToml(createWranglerConfig());
    writeFileSync(wranglerPath, initialWrangler);

    // Tweak example source based on options
    const isHono = answers.template === "hono";
    const isNext = answers.template === "nextjs";

    try {
        // Generate auth files using unified generator
        debugLog("Generating auth configuration files");
        const { generateAuthFile } = await import("./lib/auth-generator");

        const authConfig = {
            template: answers.template as "hono" | "nextjs",
            database:
                answers.database === "d1"
                    ? ("sqlite" as const)
                    : answers.database === "hyperdrive-postgres"
                      ? ("postgres" as const)
                      : ("mysql" as const),
            resources: {
                d1: answers.database === "d1",
                kv: Boolean(answers.kv),
                r2: Boolean(answers.r2),
                hyperdrive: answers.database.startsWith("hyperdrive"),
            },
            bindings: {
                d1: answers.d1Binding,
                kv: answers.kvBinding,
                r2: answers.r2Binding,
                hyperdrive: answers.hdBinding,
            },
        };

        // Generate database files using unified generator
        debugLog("Generating database configuration files");
        const { generateDbIndex } = await import("./lib/db-generator");

        const dbConfig = {
            template: answers.template as "hono" | "nextjs",
            database:
                answers.database === "d1"
                    ? ("sqlite" as const)
                    : answers.database === "hyperdrive-postgres"
                      ? ("postgres" as const)
                      : ("mysql" as const),
            bindings: {
                d1: answers.d1Binding,
                hyperdrive: answers.hdBinding,
            },
        };

        if (isHono) {
            const authPath = join(targetDir, "src/auth/index.ts");
            debugLog(`Writing auth configuration: ${authPath}`);
            const generatedAuth = generateAuthFile(authConfig);
            writeFileSync(authPath, generatedAuth);

            const dbIndex = join(targetDir, "src/db/index.ts");
            debugLog(`Writing database index: ${dbIndex}`);
            const generatedDbIndex = generateDbIndex(dbConfig);
            writeFileSync(dbIndex, generatedDbIndex);

            // Note: TypeScript validation is skipped during generation to avoid dependency issues
            // Users can run `npm run build` or `npm run typecheck` after installation to validate

            // Generate env.d.ts using unified generator
            debugLog("Generating env.d.ts file for Hono template");
            const { generateEnvDFile } = await import("./lib/env-d-generator");
            const envDConfig = {
                template: "hono" as const,
                database:
                    answers.database === "d1"
                        ? ("sqlite" as const)
                        : answers.database === "hyperdrive-postgres"
                          ? ("postgres" as const)
                          : ("mysql" as const),
                resources: {
                    d1: answers.database === "d1",
                    kv: Boolean(answers.kv),
                    r2: Boolean(answers.r2),
                    hyperdrive: answers.database.startsWith("hyperdrive"),
                },
                bindings: {
                    d1: answers.d1Binding,
                    kv: answers.kvBinding,
                    r2: answers.r2Binding,
                    hyperdrive: answers.hdBinding,
                },
            };
            const envPath = join(targetDir, "src/env.d.ts");
            debugLog(`Writing env.d.ts: ${envPath}`);
            const generatedEnvD = generateEnvDFile(envDConfig);
            writeFileSync(envPath, generatedEnvD);

            const drizzleCfg = join(targetDir, "drizzle.config.ts");
            debugLog(`Updating drizzle config: ${drizzleCfg}`);
            tryUpdateFile(drizzleCfg, code => {
                if (answers.database === "hyperdrive-postgres") {
                    return code.replace(/dialect:\s*"sqlite"/g, 'dialect: "postgresql"').replace(
                        /\.\.\.\(process\.env\.NODE_ENV === "production"[\s\S]*?\}\),/g,
                        `...(process.env.NODE_ENV === "production"
        ? {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }
        : {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }),`
                    );
                }
                if (answers.database === "hyperdrive-mysql") {
                    return code.replace(/dialect:\s*"sqlite"/g, 'dialect: "mysql2"').replace(
                        /\.\.\.\(process\.env\.NODE_ENV === "production"[\s\S]*?\}\),/g,
                        `...(process.env.NODE_ENV === "production"
        ? {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }
        : {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }),`
                    );
                }
                return code;
            });
        }

        if (isNext) {
            const dbIndex = join(targetDir, "src/db/index.ts");
            debugLog(`Writing database index: ${dbIndex}`);
            const generatedDbIndex = generateDbIndex(dbConfig);
            writeFileSync(dbIndex, generatedDbIndex);

            const nextAuth = join(targetDir, "src/auth/index.ts");
            debugLog(`Writing auth configuration: ${nextAuth}`);
            const generatedNextAuth = generateAuthFile(authConfig);
            writeFileSync(nextAuth, generatedNextAuth);

            // Note: TypeScript validation is skipped during generation to avoid dependency issues
            // Users can run `npm run build` or `npm run typecheck` after installation to validate

            // Generate env.d.ts using unified generator
            debugLog("Generating env.d.ts file for Next.js template");
            const { generateEnvDFile } = await import("./lib/env-d-generator");
            const envDConfig = {
                template: "nextjs" as const,
                database:
                    answers.database === "d1"
                        ? ("sqlite" as const)
                        : answers.database === "hyperdrive-postgres"
                          ? ("postgres" as const)
                          : ("mysql" as const),
                resources: {
                    d1: answers.database === "d1",
                    kv: Boolean(answers.kv),
                    r2: Boolean(answers.r2),
                    hyperdrive: answers.database.startsWith("hyperdrive"),
                },
                bindings: {
                    d1: answers.d1Binding,
                    kv: answers.kvBinding,
                    r2: answers.r2Binding,
                    hyperdrive: answers.hdBinding,
                },
            };
            const envPath = join(targetDir, "env.d.ts");
            debugLog(`Writing env.d.ts: ${envPath}`);
            const generatedEnvD = generateEnvDFile(envDConfig);
            writeFileSync(envPath, generatedEnvD);

            const drizzleCfg = join(targetDir, "drizzle.config.ts");
            debugLog(`Updating drizzle config: ${drizzleCfg}`);
            tryUpdateFile(drizzleCfg, code => {
                if (answers.database === "hyperdrive-postgres") {
                    return code.replace(/dialect:\s*"sqlite"/g, 'dialect: "postgresql"').replace(
                        /\.\.\.\(process\.env\.NODE_ENV === "production"[\s\S]*?\}\),/g,
                        `...(process.env.NODE_ENV === "production"
        ? {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }
        : {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }),`
                    );
                }
                if (answers.database === "hyperdrive-mysql") {
                    return code.replace(/dialect:\s*"sqlite"/g, 'dialect: "mysql2"').replace(
                        /\.\.\.\(process\.env\.NODE_ENV === "production"[\s\S]*?\}\),/g,
                        `...(process.env.NODE_ENV === "production"
        ? {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }
        : {
              dbCredentials: {
                  url: process.env.DATABASE_URL!,
              },
          }),`
                    );
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
    let databaseSetupSkipped = false;

    if (isNonInteractive) {
        // Non-interactive mode
        setup = !answers.skipCloudflareSetup;
        if (answers.skipCloudflareSetup) {
            outro(pc.yellow("Skipping Cloudflare setup as requested."));
            databaseSetupSkipped = true;
        }
    } else {
        // Interactive mode
        const confirmResult = await confirm({ message: "Run Cloudflare setup commands now?" });
        setup = confirmResult === true;
        if (!setup) {
            outro(pc.yellow("You can run wrangler setup later."));
            databaseSetupSkipped = true;
        }
    }

    // Install dependencies before Cloudflare resource creation
    // This ensures projects are buildable even if Cloudflare setup fails
    const pm = detectPackageManager(targetDir);
    debugLog(`Detected package manager: ${pm}`);
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
        if (res.code === 0) {
            inst.stop(pc.green("Dependencies installed."));
        } else {
            inst.stop(pc.red("Failed to install dependencies."));
            // Skip dependency installation failure in test environments
            // The CLI will continue but auth generation may fail
            console.warn("⚠️ Warning: Dependency installation failed. Auth generation may not work properly.");
        }
    }

    if (setup) {
        debugLog("Starting Cloudflare resource setup");
        // Ensure user is authenticated and handle account selection
        const authResult = await ensureWranglerAuth(isNonInteractive);
        if (authResult === "skip-setup") {
            setup = false;
            databaseSetupSkipped = true;
        }
    }

    // Resource creation - any failure will be fatal

    if (setup) {
        const cwd = targetDir;

        if (answers.database === "d1" && answers.d1Name) {
            debugLog(`Creating D1 database: ${answers.d1Name} with binding: ${answers.d1Binding}`);
            const creating = spinner();
            creating.start(`Creating D1 Database \`${answers.d1Name}\`...`);
            const res = runWranglerCommand(["d1", "create", answers.d1Name], cwd, answers.accountId);

            if (res.code === 0) {
                // Extract database ID from wrangler response and regenerate wrangler.toml
                const databaseId = extractD1DatabaseId(res.stdout);

                if (databaseId && answers.d1Binding && existsSync(wranglerPath)) {
                    debugLog(`Updating wrangler.toml with D1 database ID: ${databaseId}`);
                    // Update existing wrangler.toml with the actual database ID
                    const currentWrangler = readFileSync(wranglerPath, "utf-8");
                    const updatedWrangler = updateD1BlockWithId(
                        currentWrangler,
                        answers.d1Binding,
                        answers.d1Name,
                        databaseId
                    );
                    writeFileSync(wranglerPath, updatedWrangler);
                }
                creating.stop(
                    pc.green(`\`${answers.d1Name}\` created${databaseId ? " (id: " + databaseId + ")" : ""}.`)
                );
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
                        // Extract database ID from retry response and regenerate wrangler.toml
                        const databaseId = extractD1DatabaseId(retryRes.stdout);
                        if (databaseId && answers.d1Binding && existsSync(wranglerPath)) {
                            // Update existing wrangler.toml with the actual database ID
                            const currentWrangler = readFileSync(wranglerPath, "utf-8");
                            const updatedWrangler = updateD1BlockWithId(
                                currentWrangler,
                                answers.d1Binding,
                                answers.d1Name,
                                databaseId
                            );
                            writeFileSync(wranglerPath, updatedWrangler);
                        }
                        creating.stop(
                            pc.green(`\`${answers.d1Name}\` created${databaseId ? " (id: " + databaseId + ")" : ""}.`)
                        );
                        answers.accountId = selectedAccountId; // Save for subsequent commands
                    } else {
                        creating.stop(pc.red("Failed to create D1 database."));
                        assertOk(retryRes, "D1 creation failed.");
                    }
                }
            } else {
                // Check for specific error types
                const isInternalError =
                    res.stderr?.includes("code: 7500") ||
                    res.stdout?.includes("code: 7500") ||
                    res.stderr?.includes("internal error") ||
                    res.stdout?.includes("internal error");

                const isDatabaseExists =
                    res.stderr?.includes("already exists") || res.stdout?.includes("already exists");

                if (isDatabaseExists) {
                    // Database already exists, which is fine - get its ID and configure it in wrangler.toml
                    const existingDatabaseId = getExistingD1DatabaseId(answers.d1Name, cwd, answers.accountId);
                    if (existingDatabaseId && existsSync(wranglerPath)) {
                        debugLog(`Updating wrangler.toml with existing D1 database ID: ${existingDatabaseId}`);
                        const currentWrangler = readFileSync(wranglerPath, "utf-8");
                        const updatedWrangler = updateD1BlockWithId(
                            currentWrangler,
                            answers.d1Binding || "DATABASE",
                            answers.d1Name,
                            existingDatabaseId
                        );
                        writeFileSync(wranglerPath, updatedWrangler);
                    }
                    creating.stop(
                        pc.yellow(
                            `D1 database already exists (name: ${answers.d1Name})${existingDatabaseId ? " (id: " + existingDatabaseId + ")" : ""}.`
                        )
                    );
                } else if (isInternalError) {
                    creating.stop(pc.red("D1 database creation failed due to Cloudflare API internal error."));
                    console.log(pc.gray("This is usually a temporary issue with Cloudflare's API."));
                    console.log(
                        pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/")
                    );
                    console.log(pc.gray("You can try running the command again, or create the D1 database manually:"));
                    console.log(pc.cyan(`  npx wrangler d1 create ${answers.d1Name}`));
                    console.log(pc.gray("Then update your wrangler.toml with the database ID."));
                    assertOk(res, "D1 database creation failed due to internal error.");
                } else {
                    creating.stop(pc.red("Failed to create D1 database."));
                    console.log(
                        pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/")
                    );
                    assertOk(res, "D1 creation failed.");
                }
            }
        }

        if (answers.database !== "d1" && answers.hdName && answers.hdConnectionString && answers.hdBinding) {
            debugLog(`Creating Hyperdrive: ${answers.hdName} with binding: ${answers.hdBinding}`);
            debugLog(`Connection string: ${answers.hdConnectionString.replace(/:([^:@]+)@/, ":***@")}`);
            const creating = spinner();
            creating.start(`Creating Hyperdrive \`${answers.hdName}\`...`);
            const res = runWranglerCommand(
                ["hyperdrive", "create", answers.hdName, `--connection-string=${answers.hdConnectionString}`],
                cwd,
                answers.accountId
            );
            if (res.code === 0) {
                // Extract Hyperdrive ID from wrangler response and regenerate wrangler.toml
                const hyperdriveId = extractHyperdriveId(res.stdout);

                if (hyperdriveId && existsSync(wranglerPath)) {
                    debugLog(`Updating wrangler.toml with Hyperdrive ID: ${hyperdriveId}`);
                    // Update existing wrangler.toml with the actual hyperdrive ID
                    const currentWrangler = readFileSync(wranglerPath, "utf-8");
                    const updatedWrangler = updateHyperdriveBlockWithId(
                        currentWrangler,
                        answers.hdBinding!,
                        hyperdriveId
                    );
                    writeFileSync(wranglerPath, updatedWrangler);
                }
                creating.stop(pc.green(`Hyperdrive created${hyperdriveId ? " (id: " + hyperdriveId + ")" : ""}.`));
            } else {
                // Check for specific error types
                const isHyperdriveExists =
                    res.stderr?.includes("code: 2017") ||
                    res.stdout?.includes("code: 2017") ||
                    res.stderr?.includes("A Hyperdrive config with the given name already exists") ||
                    res.stdout?.includes("A Hyperdrive config with the given name already exists");

                if (isHyperdriveExists) {
                    // Hyperdrive already exists, which is fine - get its ID and configure it in wrangler.toml
                    const existingHyperdriveId = getExistingHyperdriveId(answers.hdName, cwd, answers.accountId);
                    if (existingHyperdriveId && existsSync(wranglerPath)) {
                        debugLog(`Updating wrangler.toml with existing Hyperdrive ID: ${existingHyperdriveId}`);
                        const currentWrangler = readFileSync(wranglerPath, "utf-8");
                        const updatedWrangler = updateHyperdriveBlockWithId(
                            currentWrangler,
                            answers.hdBinding,
                            existingHyperdriveId,
                            answers.hdConnectionString
                        );
                        writeFileSync(wranglerPath, updatedWrangler);
                    }
                    creating.stop(
                        pc.yellow(
                            `Hyperdrive already exists (name: ${answers.hdName})${existingHyperdriveId ? " (id: " + existingHyperdriveId + ")" : ""}.`
                        )
                    );
                } else {
                    creating.stop(pc.red("Failed to create Hyperdrive."));
                    assertOk(res, "Hyperdrive creation failed.");
                }
            }
        }

        if (answers.kv && answers.kvNamespaceName && answers.kvBinding) {
            debugLog(`Creating KV namespace: ${answers.kvNamespaceName} with binding: ${answers.kvBinding}`);
            const creating = spinner();
            creating.start(`Creating KV Namespace \`${answers.kvNamespaceName}\`...`);
            const res = runWranglerCommand(
                ["kv", "namespace", "create", answers.kvNamespaceName],
                cwd,
                answers.accountId
            );
            if (res.code === 0) {
                // Extract namespace ID from wrangler response and regenerate wrangler.toml
                const namespaceId = extractKvNamespaceId(res.stdout);

                if (namespaceId && existsSync(wranglerPath)) {
                    debugLog(`Updating wrangler.toml with KV namespace ID: ${namespaceId}`);
                    // Update existing wrangler.toml with the actual KV namespace ID
                    const currentWrangler = readFileSync(wranglerPath, "utf-8");
                    const updatedWrangler = updateKvBlockWithId(currentWrangler, answers.kvBinding!, namespaceId);
                    writeFileSync(wranglerPath, updatedWrangler);
                }
                creating.stop(pc.green(`KV namespace created${namespaceId ? " (id: " + namespaceId + ")" : ""}.`));
            } else {
                // Check for specific error types
                const isKvExists =
                    res.stderr?.includes("code: 10014") ||
                    res.stdout?.includes("code: 10014") ||
                    res.stderr?.includes("A namespace with this account ID and title already exists") ||
                    res.stdout?.includes("A namespace with this account ID and title already exists") ||
                    res.stderr?.includes("already exists") ||
                    res.stdout?.includes("already exists");

                if (isKvExists) {
                    // KV namespace already exists, which is fine - get its ID and configure it in wrangler.toml
                    const existingNamespaceId = getExistingKvNamespaceId(
                        answers.kvNamespaceName,
                        cwd,
                        answers.accountId
                    );
                    if (existingNamespaceId && existsSync(wranglerPath)) {
                        debugLog(`Updating wrangler.toml with existing KV namespace ID: ${existingNamespaceId}`);
                        const currentWrangler = readFileSync(wranglerPath, "utf-8");
                        const updatedWrangler = updateKvBlockWithId(
                            currentWrangler,
                            answers.kvBinding,
                            existingNamespaceId
                        );
                        writeFileSync(wranglerPath, updatedWrangler);
                    }
                    creating.stop(
                        pc.yellow(
                            `KV namespace already exists (name: ${answers.kvNamespaceName})${existingNamespaceId ? " (id: " + existingNamespaceId + ")" : ""}.`
                        )
                    );
                } else {
                    creating.stop(pc.red("Failed to create KV namespace."));
                    assertOk(res, "KV namespace creation failed.");
                }
            }
        }

        if (answers.r2 && answers.r2BucketName) {
            const r2Binding = answers.r2Binding || "R2_BUCKET";
            debugLog(`Creating R2 bucket: ${answers.r2BucketName} with binding: ${r2Binding}`);
            const creating = spinner();
            creating.start(`Creating R2 Bucket \`${answers.r2BucketName}\`...`);
            const res = runWranglerCommand(["r2", "bucket", "create", answers.r2BucketName], cwd, answers.accountId);
            if (res.code === 0) {
                if (existsSync(wranglerPath)) {
                    debugLog(`Updating wrangler.toml with R2 bucket: ${answers.r2BucketName}`);
                    let wrangler = readFileSync(wranglerPath, "utf8");
                    wrangler = appendOrReplaceR2Block(wrangler, r2Binding, answers.r2BucketName);
                    writeFileSync(wranglerPath, wrangler);
                }
                creating.stop(pc.green(`R2 bucket created (name: ${answers.r2BucketName}).`));
            } else {
                // Check if the error is because the bucket already exists (error code 10004)
                const bucketAlreadyExists =
                    res.stderr?.includes("code: 10004") ||
                    res.stdout?.includes("code: 10004") ||
                    res.stderr?.includes("[code: 10004]") ||
                    res.stdout?.includes("[code: 10004]") ||
                    res.stderr?.includes("already exists") ||
                    res.stdout?.includes("already exists");

                if (bucketAlreadyExists) {
                    // Bucket already exists, which is fine - just configure it in wrangler.toml
                    if (existsSync(wranglerPath)) {
                        let wrangler = readFileSync(wranglerPath, "utf8");
                        wrangler = appendOrReplaceR2Block(wrangler, r2Binding, answers.r2BucketName);
                        writeFileSync(wranglerPath, wrangler);
                    }
                    creating.stop(pc.yellow(`R2 bucket already exists (name: ${answers.r2BucketName}).`));
                } else {
                    creating.stop(pc.red("Failed to create R2 bucket."));
                    console.log(
                        pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/")
                    );
                    assertOk(res, "R2 bucket creation failed.");
                }
            }
        }
    }

    // All resources created successfully at this point

    // Schema generation & migrations
    debugLog("Starting auth schema generation");
    const genAuth = spinner();
    genAuth.start("Generating auth schema...");
    {
        const authPm = detectPackageManagerForAuth(targetDir);
        debugLog(`Using package manager for auth commands: ${authPm}`);
        const authRes = runScript(authPm, "auth:update", targetDir);
        if (authRes.code === 0) {
            genAuth.stop(pc.green("Auth schema updated."));

            // Restore original schema.ts and index.ts after successful auth generation for non-D1 databases
            if (answers.database !== "d1") {
                const tempSchemaBackupPath = join(targetDir, ".schema-backup.tmp");
                const tempIndexBackupPath = join(targetDir, ".index-backup.tmp");
                const schemaPath = join(targetDir, "src/db/schema.ts");
                const indexPath = join(targetDir, "src/db/index.ts");

                if (existsSync(tempSchemaBackupPath)) {
                    debugLog(`Restoring original schema file: ${schemaPath}`);
                    const originalSchemaContent = readFileSync(tempSchemaBackupPath, "utf8");
                    writeFileSync(schemaPath, originalSchemaContent, "utf8");
                    rmSync(tempSchemaBackupPath, { force: true });
                }

                if (existsSync(tempIndexBackupPath)) {
                    debugLog(`Restoring original index file: ${indexPath}`);
                    const originalIndexContent = readFileSync(tempIndexBackupPath, "utf8");
                    writeFileSync(indexPath, originalIndexContent, "utf8");
                    rmSync(tempIndexBackupPath, { force: true });
                }
            }
        } else {
            genAuth.stop(pc.red("Failed to generate auth schema."));
            // In test environments, continue even if auth generation fails
            // The temporary auth schema will remain in place
            console.warn("⚠️ Warning: Auth schema generation failed. Using placeholder schema.");
        }
    }

    debugLog("Starting Drizzle migration generation");
    const genDb = spinner();
    genDb.start("Generating Drizzle migrations...");
    {
        const dbGenRes = runScript(pm, "db:generate", targetDir);
        if (dbGenRes.code === 0) {
            genDb.stop(pc.green("Drizzle migrations generated."));
        } else {
            genDb.stop(pc.red("Failed to generate migrations."));
            assertOk(dbGenRes, "Migration generation failed.");
        }
    }

    if (answers.database === "d1" && !databaseSetupSkipped) {
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
            debugLog("Applying D1 migrations locally");
            const mig = spinner();
            mig.start("Applying migrations locally...");
            const res = runScript(pm, "db:migrate:dev", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied locally."));
            else {
                mig.stop(pc.red("Failed to apply local migrations."));
                assertOk(res, "Local migration failed.");
            }
        } else if (migrateChoice === "prod") {
            debugLog("Applying D1 migrations to production");
            const mig = spinner();
            mig.start("Applying migrations remotely...");
            const res = runScript(pm, "db:migrate:prod", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied remotely."));
            else {
                mig.stop(pc.red("Failed to apply remote migrations."));
                assertOk(res, "Remote migration failed.");
            }
        }
    } else if (answers.database === "d1" && databaseSetupSkipped) {
        outro(
            pc.yellow(
                "Skipping D1 migrations since database setup was skipped. After setting up your D1 database, run: npx @better-auth-cloudflare/cli migrate"
            )
        );
    }

    // Handle PostgreSQL/MySQL migrations (Hyperdrive)
    if (answers.database.startsWith("hyperdrive") && !databaseSetupSkipped) {
        let migrateChoice: "dev" | "prod" | "skip";

        if (isNonInteractive) {
            // In non-interactive mode, use the CLI argument or default to skip (matches D1 behavior)
            migrateChoice = answers.applyMigrations || "skip";
        } else {
            // In interactive mode, ask user
            const databaseLabel = answers.database === "hyperdrive-postgres" ? "PostgreSQL" : "MySQL";
            migrateChoice = (await (select as any)({
                message: `Apply ${databaseLabel} migrations now?`,
                options: [
                    { value: "dev", label: "Yes, apply to development database" },
                    { value: "prod", label: "Yes, apply to production database" },
                    { value: "skip", label: "No, I'll do it later" },
                ],
                initialValue: "dev",
            })) as "dev" | "prod" | "skip";
        }

        if (migrateChoice === "dev") {
            const mig = spinner();
            mig.start("Applying migrations to development database...");
            const res = runScript(pm, "db:migrate:dev", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied to development database."));
            else {
                mig.stop(pc.red("Failed to apply development migrations."));
                assertOk(res, "Development migration failed.");
            }
        } else if (migrateChoice === "prod") {
            const mig = spinner();
            mig.start("Applying migrations to production database...");
            const res = runScript(pm, "db:migrate:prod", targetDir);
            if (res.code === 0) mig.stop(pc.green("Migrations applied to production database."));
            else {
                mig.stop(pc.red("Failed to apply production migrations."));
                console.log(pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/"));
                assertOk(res, "Production migration failed.");
            }
        }
    } else if (answers.database.startsWith("hyperdrive") && databaseSetupSkipped) {
        outro(
            pc.yellow(
                "Skipping database migrations since Cloudflare setup was skipped. After setting up your Hyperdrive configuration, run: npx @better-auth-cloudflare/cli migrate"
            )
        );
    }

    // Run database migrations to production if database was created
    if (setup && !databaseSetupSkipped) {
        if (answers.database === "d1") {
            const migrateSpinner = spinner();
            migrateSpinner.start("Applying D1 database migrations to production...");

            const migrateRes = runScript(pm, "db:migrate:prod", targetDir);
            if (migrateRes.code === 0) {
                migrateSpinner.stop(pc.green("D1 database migrations applied to production."));
            } else {
                migrateSpinner.stop(pc.red("Failed to apply D1 database migrations to production."));
                // Don't fail the entire process, but warn the user
                outro(
                    pc.yellow(
                        "Warning: D1 database migrations failed. You may need to run 'bun run db:migrate:prod' manually."
                    )
                );
                console.log(pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/"));
            }
        } else {
            const migrateSpinner = spinner();
            migrateSpinner.start("Applying database migrations to production...");

            const migrateRes = runScript(pm, "db:migrate:prod", targetDir);
            if (migrateRes.code === 0) {
                migrateSpinner.stop(pc.green("Database migrations applied to production."));
            } else {
                migrateSpinner.stop(pc.red("Failed to apply database migrations to production."));
                // Don't fail the entire process, but warn the user
                outro(
                    pc.yellow(
                        "Warning: Database migrations failed. You may need to run 'bun run db:migrate:prod' manually."
                    )
                );
                console.log(pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/"));
                console.log(
                    pc.gray(
                        "Also check your database connection string and make sure it is correct, and check status with your database provider."
                    )
                );
            }
        }
    }

    // Deploy to Cloudflare if setup was completed
    if (setup && !databaseSetupSkipped) {
        let deployChoice: boolean;

        if (isNonInteractive) {
            // In non-interactive mode, deploy automatically since they chose to setup Cloudflare
            deployChoice = true;
        } else {
            // In interactive mode, ask user
            const deployResult = await confirm({
                message: "Deploy your app to Cloudflare Workers now?",
                initialValue: true,
            });
            deployChoice = deployResult === true;
        }

        if (deployChoice) {
            debugLog("Starting deployment to Cloudflare Workers");
            const deploySpinner = spinner();
            deploySpinner.start("Deploying to Cloudflare Workers...");

            const deployRes = runScript(pm, "deploy", targetDir);
            if (deployRes.code === 0) {
                deploySpinner.stop(pc.green("Successfully deployed to Cloudflare Workers!"));

                // Try to extract the deployment URL from wrangler output
                const urlMatch = deployRes.stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
                if (urlMatch) {
                    outro(pc.cyan(`🚀 Your app is live at: ${urlMatch[0]}`));
                }
            } else {
                deploySpinner.stop(pc.red("Deployment failed."));
                console.log(pc.gray("Check Cloudflare Status for ongoing issues: https://www.cloudflarestatus.com/"));
                outro(pc.yellow("You can deploy manually later with: bun run deploy"));
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
                "Apply migrations to your Postgres/MySQL database using: bun run db:migrate:dev or bun run db:migrate:prod"
            )
        );
    }
    lines.push(`  ${runScriptHelp("db:studio:dev")} ${pc.gray("# Open Drizzle Studio (local)")}`);
    lines.push(`  ${runScriptHelp("db:studio:prod")} ${pc.gray("# Open Drizzle Studio (remote)")}`);
    lines.push(`  ${runScriptHelp("deploy")} ${pc.gray("# Deploy to Cloudflare Workers")}`);
    lines.push("");
    lines.push(pc.gray("Refer to the example README for more details."));

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
        `  npx @better-auth-cloudflare/cli generate-tenant-migrations  Split schemas for multi-tenancy\n` +
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
        `  --verbose                      Show debug output during execution\n` +
        `  -v                             Show debug output (when used with other args) or version (when alone)\n` +
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
        `  --skip-cloudflare-setup=<bool> Skip Cloudflare resource creation and deployment (default: false)\n` +
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
        `  # Create and deploy app in one command (default when not skipping setup)\n` +
        `  npx @better-auth-cloudflare/cli --app-name=prod-app\n` +
        `\n` +
        `  # Run migration workflow interactively\n` +
        `  npx @better-auth-cloudflare/cli migrate\n` +
        `\n` +
        `  # Run migration workflow with non-interactive target\n` +
        `  npx @better-auth-cloudflare/cli migrate --migrate-target=dev\n` +
        `\n` +
        `Creates a new Better Auth Cloudflare project from Hono or OpenNext.js templates,\n` +
        `optionally creating Cloudflare D1, KV, R2, or Hyperdrive resources for you.\n` +
        `The migrate command runs auth:update, db:generate, and optionally db:migrate.\n` +
        `The generate-tenant-migrations command splits auth schemas for multi-tenancy.\n` +
        `\n` +
        `Cloudflare Status: https://www.cloudflarestatus.com/\n` +
        `Report issues: https://github.com/zpg6/better-auth-cloudflare/issues\n`;
    // eslint-disable-next-line no-console
    console.log(help);
}

const cmd = process.argv[2];

// Check for version first - handle -v as version only when it's the only argument
if (cmd === "version" || cmd === "--version" || (cmd === "-v" && process.argv.length === 3)) {
    printVersion();
    checkForUpdates();
} else if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
} else if (cmd === "migrate") {
    // Handle migrate command
    const hasCliArgs = process.argv.slice(3).some(arg => arg.startsWith("--") || arg === "-v");
    const cliArgs = hasCliArgs ? parseCliArgs(process.argv) : undefined;
    migrate(cliArgs).catch(err => {
        fatal(String(err?.message ?? err));
    });
} else if (cmd === "generate-tenant-migrations") {
    // Handle generate-tenant-migrations command
    import("./commands/generate-tenant-migrations.js")
        .then(({ generateTenantMigrations }) => {
            generateTenantMigrations().catch(err => {
                fatal(String(err?.message ?? err));
            });
        })
        .catch(err => {
            fatal(String(err?.message ?? err));
        });
} else {
    // Check if we have CLI arguments (starts with -- or -v)
    const hasCliArgs = process.argv.slice(2).some(arg => arg.startsWith("--") || arg === "-v");

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
