import { describe, expect, test } from "bun:test";

// Mock package manager detection and command generation
type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

function detectPackageManager(): PackageManager {
    // In real implementation, this would check for lock files, process.env, etc.
    // For testing, we'll simulate the logic

    // Check for Bun runtime first
    try {
        if (typeof Bun !== "undefined") {
            return "bun";
        }
    } catch {}

    // Check for lock files (would use fs.existsSync in real implementation)
    const mockLockFiles = {
        "pnpm-lock.yaml": "pnpm",
        "yarn.lock": "yarn",
        "package-lock.json": "npm",
    } as const;

    // For testing, simulate finding pnpm-lock.yaml
    return "pnpm";
}

function getInstallCommand(packageManager: PackageManager): string {
    switch (packageManager) {
        case "bun":
            return "bun install";
        case "pnpm":
            return "pnpm install";
        case "yarn":
            return "yarn install";
        case "npm":
            return "npm install";
    }
}

function getRunCommand(packageManager: PackageManager, script: string): string {
    switch (packageManager) {
        case "bun":
            return `bun run ${script}`;
        case "pnpm":
            return `pnpm run ${script}`;
        case "yarn":
            return `yarn run ${script}`;
        case "npm":
            return `npm run ${script}`;
    }
}

function getAddCommand(packageManager: PackageManager, packages: string[]): string {
    const pkgList = packages.join(" ");
    switch (packageManager) {
        case "bun":
            return `bun add ${pkgList}`;
        case "pnpm":
            return `pnpm add ${pkgList}`;
        case "yarn":
            return `yarn add ${pkgList}`;
        case "npm":
            return `npm install ${pkgList}`;
    }
}

function shouldUseExactVersions(packageManager: PackageManager): boolean {
    // Some package managers prefer exact versions for certain packages
    return packageManager === "pnpm" || packageManager === "yarn";
}

function formatDependencyVersion(version: string, packageManager: PackageManager): string {
    if (version === "latest") {
        return shouldUseExactVersions(packageManager) ? version : "^latest";
    }
    return version;
}

describe("Package manager detection", () => {
    test("detects package manager correctly", () => {
        const pm = detectPackageManager();
        expect(["bun", "pnpm", "yarn", "npm"]).toContain(pm);
    });

    test("generates correct install commands", () => {
        expect(getInstallCommand("bun")).toBe("bun install");
        expect(getInstallCommand("pnpm")).toBe("pnpm install");
        expect(getInstallCommand("yarn")).toBe("yarn install");
        expect(getInstallCommand("npm")).toBe("npm install");
    });

    test("generates correct run commands", () => {
        expect(getRunCommand("bun", "dev")).toBe("bun run dev");
        expect(getRunCommand("pnpm", "build")).toBe("pnpm run build");
        expect(getRunCommand("yarn", "test")).toBe("yarn run test");
        expect(getRunCommand("npm", "deploy")).toBe("npm run deploy");
    });

    test("generates correct add commands", () => {
        expect(getAddCommand("bun", ["postgres"])).toBe("bun add postgres");
        expect(getAddCommand("pnpm", ["mysql2", "@types/node"])).toBe("pnpm add mysql2 @types/node");
        expect(getAddCommand("yarn", ["drizzle-orm"])).toBe("yarn add drizzle-orm");
        expect(getAddCommand("npm", ["better-auth-cloudflare"])).toBe("npm install better-auth-cloudflare");
    });

    test("handles version formatting", () => {
        expect(formatDependencyVersion("^1.0.0", "npm")).toBe("^1.0.0");
        expect(formatDependencyVersion("latest", "bun")).toBe("^latest");
        expect(formatDependencyVersion("latest", "pnpm")).toBe("latest");
        expect(formatDependencyVersion("latest", "yarn")).toBe("latest");
    });
});

describe("Package manager utilities", () => {
    test("identifies exact version preferences", () => {
        expect(shouldUseExactVersions("bun")).toBe(false);
        expect(shouldUseExactVersions("npm")).toBe(false);
        expect(shouldUseExactVersions("pnpm")).toBe(true);
        expect(shouldUseExactVersions("yarn")).toBe(true);
    });

    test("handles multiple packages in add command", () => {
        const packages = ["postgres", "drizzle-orm", "@types/node"];
        expect(getAddCommand("bun", packages)).toBe("bun add postgres drizzle-orm @types/node");
        expect(getAddCommand("npm", packages)).toBe("npm install postgres drizzle-orm @types/node");
    });

    test("handles empty package list", () => {
        expect(getAddCommand("bun", [])).toBe("bun add ");
        expect(getAddCommand("npm", [])).toBe("npm install ");
    });
});
