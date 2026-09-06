import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";
export type DatabaseKind = "d1" | "hyperdrive-postgres" | "hyperdrive-mysql";

interface JsonObject {
    [key: string]: unknown;
}

export interface ProjectNormalizationOptions {
    appName: string;
    database: DatabaseKind;
    d1Binding?: string;
    packageManager: PackageManager;
    packageManagerVersion: string;
}

const templateLockfiles = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json"];

export function detectPackageManagerHint(directory: string): PackageManager | undefined {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as JsonObject;
        if (pkg.packageManager !== undefined) {
            if (typeof pkg.packageManager !== "string") throw new Error("packageManager must be a string.");
            const match = /^(bun|pnpm|yarn|npm)(?:@.+)?$/.exec(pkg.packageManager);
            if (!match) throw new Error(`Unsupported packageManager value: ${pkg.packageManager}`);
            return match[1] as PackageManager;
        }
    }

    const lockfileManagers = new Set<PackageManager>();
    if (existsSync(join(directory, "bun.lock")) || existsSync(join(directory, "bun.lockb"))) {
        lockfileManagers.add("bun");
    }
    if (existsSync(join(directory, "pnpm-lock.yaml"))) lockfileManagers.add("pnpm");
    if (existsSync(join(directory, "yarn.lock"))) lockfileManagers.add("yarn");
    if (existsSync(join(directory, "package-lock.json"))) lockfileManagers.add("npm");
    if (lockfileManagers.size > 1) {
        throw new Error(`Conflicting package-manager lockfiles: ${[...lockfileManagers].join(", ")}`);
    }
    return lockfileManagers.values().next().value;
}

export function normalizeProjectTemplate(targetDir: string, options: ProjectNormalizationOptions): void {
    for (const file of templateLockfiles) rmSync(join(targetDir, file), { force: true });

    rmSync(join(targetDir, "custom-worker.ts"), { force: true });
    const honoEntryPath = join(targetDir, "src/index.ts");
    if (existsSync(honoEntryPath)) {
        const entry = readFileSync(honoEntryPath, "utf8")
            .replace(/\nexport \{ BetterAuthDurableObject \} from "better-auth-cloudflare\/durable-object";\n/, "\n")
            .replace("auth: ReturnType<typeof createAuth>;", "auth: Awaited<ReturnType<typeof createAuth>>;")
            .replace("const auth = createAuth(", "const auth = await createAuth(");
        writeFileSync(honoEntryPath, entry);
    }

    const pkgPath = join(targetDir, "package.json");
    if (!existsSync(pkgPath)) return;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as JsonObject;
    const dependencies = (pkg.dependencies ?? {}) as JsonObject;
    if (typeof dependencies["better-auth-cloudflare"] === "string") {
        dependencies["better-auth-cloudflare"] = "latest";
    }
    if (options.database === "hyperdrive-postgres") {
        dependencies.postgres = dependencies.postgres || "^3.4.5";
    }
    if (options.database === "hyperdrive-mysql") {
        dependencies.mysql2 = dependencies.mysql2 || "^3.14.0";
    }

    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const runCommand = options.packageManager === "npm" ? "npm run" : `${options.packageManager} run`;
    const installCommand = options.packageManager === "yarn" ? "yarn install" : `${options.packageManager} install`;
    scripts["auth:update"] = `${runCommand} auth:generate && ${runCommand} auth:format`;
    if (scripts["auth:generate"]) {
        scripts["auth:generate"] = scripts["auth:generate"].replace("src/auth/index.ts", "src/auth.config.ts");
    }
    if (scripts["clean-deploy"] !== undefined) {
        scripts["clean-deploy"] = `${runCommand} clean && ${installCommand} && ${runCommand} deploy`;
    }
    delete scripts["db:check"];

    for (const key of Object.keys(scripts)) {
        const value = String(scripts[key]);
        if (options.database === "d1" && options.d1Binding) {
            scripts[key] = value.replace(/wrangler\s+d1\s+migrations\s+apply\s+\w+/g, match =>
                match.replace(/apply\s+\w+/, `apply ${options.d1Binding}`)
            );
        } else if (options.database !== "d1" && value.includes("wrangler d1 migrations apply")) {
            scripts[key] = value
                .replace(/wrangler d1 migrations apply \w+ --local/, "drizzle-kit migrate")
                .replace(/wrangler d1 migrations apply \w+ --remote/, "drizzle-kit migrate");
        }
    }

    const normalized: JsonObject = {
        ...pkg,
        name: options.appName,
        dependencies,
        scripts,
        packageManager: `${options.packageManager}@${options.packageManagerVersion}`,
    };
    if (options.packageManager !== "pnpm") {
        const pnpm = normalized.pnpm as JsonObject | undefined;
        delete normalized.pnpm;
        const overrides = pnpm?.overrides;
        if (overrides && options.packageManager === "yarn") normalized.resolutions = overrides;
        if (overrides && options.packageManager !== "yarn") normalized.overrides = overrides;
    }

    writeFileSync(pkgPath, JSON.stringify(normalized, null, 2));
}
