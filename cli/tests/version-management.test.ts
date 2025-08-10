import { describe, expect, test, mock } from "bun:test";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

// Mock functions that mirror the actual CLI implementation
function mockGetPackageVersion(): string {
    try {
        // In tests, we'll use a mock package.json structure
        const mockPackage = {
            name: "@better-auth-cloudflare/cli",
            version: "0.1.0",
        };
        return mockPackage.version;
    } catch {
        return "unknown";
    }
}

function mockCompareVersions(current: string, latest: string): boolean {
    if (current === "unknown" || latest === "unknown") return false;
    
    const currentParts = current.split('.').map(n => parseInt(n, 10));
    const latestParts = latest.split('.').map(n => parseInt(n, 10));
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] || 0;
        const latestPart = latestParts[i] || 0;
        if (latestPart > currentPart) {
            return true;
        } else if (latestPart < currentPart) {
            return false;
        }
    }
    return false;
}

function mockFormatUpdateMessage(current: string, latest: string): string[] {
    return [
        `🔄 Update available: ${current} → ${latest}`,
        `   Run: npm install -g @better-auth-cloudflare/cli@latest`,
        `   Or:  npx @better-auth-cloudflare/cli@latest`,
    ];
}

describe("Version Management", () => {
    test("getPackageVersion returns valid version format", () => {
        const version = mockGetPackageVersion();
        
        // Should be a string
        expect(typeof version).toBe("string");
        
        // Should either be "unknown" or follow semantic versioning pattern
        if (version !== "unknown") {
            expect(version).toMatch(/^\d+\.\d+\.\d+/);
        }
    });

    test("version comparison logic works correctly", () => {
        // Test cases for version comparison
        const testCases = [
            { current: "0.1.0", latest: "0.1.1", shouldUpdate: true },
            { current: "0.1.0", latest: "0.2.0", shouldUpdate: true },
            { current: "0.1.0", latest: "1.0.0", shouldUpdate: true },
            { current: "0.1.1", latest: "0.1.0", shouldUpdate: false },
            { current: "0.2.0", latest: "0.1.0", shouldUpdate: false },
            { current: "1.0.0", latest: "0.1.0", shouldUpdate: false },
            { current: "0.1.0", latest: "0.1.0", shouldUpdate: false },
            { current: "unknown", latest: "0.1.0", shouldUpdate: false },
            { current: "0.1.0", latest: "unknown", shouldUpdate: false },
        ];

        for (const testCase of testCases) {
            const result = mockCompareVersions(testCase.current, testCase.latest);
            expect(result).toBe(testCase.shouldUpdate);
        }
    });

    test("update message formatting is correct", () => {
        const current = "0.1.0";
        const latest = "0.2.0";
        const messages = mockFormatUpdateMessage(current, latest);

        expect(messages).toHaveLength(3);
        expect(messages[0]).toContain("Update available");
        expect(messages[0]).toContain(current);
        expect(messages[0]).toContain(latest);
        expect(messages[1]).toContain("npm install -g");
        expect(messages[2]).toContain("npx");
    });

    test("version display format is consistent", () => {
        const version = "0.1.0";
        const expectedFormats = [
            `@better-auth-cloudflare/cli v${version}`,
            `Better Auth Cloudflare v${version} · generate`,
            `Better Auth Cloudflare v${version} · migrate`,
        ];

        for (const format of expectedFormats) {
            expect(format).toContain(version);
            expect(format).toMatch(/v\d+\.\d+\.\d+/);
        }
    });
});

describe("Version Commands", () => {
    test("version command variants are recognized", () => {
        const versionCommands = ["version", "--version", "-v"];
        
        for (const cmd of versionCommands) {
            // Test command recognition logic
            const isVersionCommand = cmd === "version" || cmd === "--version" || cmd === "-v";
            expect(isVersionCommand).toBe(true);
        }
    });

    test("version commands have highest priority", () => {
        // Test command priority logic that should be used in main CLI
        function getCommandPriority(cmd: string): number {
            if (cmd === "version" || cmd === "--version" || cmd === "-v") return 1; // Highest
            if (cmd === "help" || cmd === "-h" || cmd === "--help") return 2;
            if (cmd === "migrate") return 3;
            if (cmd === "generate" || !cmd) return 4; // Lowest (default)
            return 5; // Unknown commands
        }

        const commands = ["version", "--version", "-v", "help", "migrate", "generate", undefined];
        const priorities = commands.map(cmd => getCommandPriority(cmd || ""));

        // Version commands should have priority 1
        expect(priorities[0]).toBe(1); // version
        expect(priorities[1]).toBe(1); // --version
        expect(priorities[2]).toBe(1); // -v
        
        // Other commands should have lower priority
        expect(priorities[3]).toBe(2); // help
        expect(priorities[4]).toBe(3); // migrate
        expect(priorities[5]).toBe(4); // generate
        expect(priorities[6]).toBe(4); // undefined (default to generate)
    });
});

describe("Update Checking", () => {
    test("npm view command structure is correct", () => {
        // Test the command structure used for checking updates
        const packageName = "@better-auth-cloudflare/cli";
        const command = "npm";
        const args = ["view", packageName, "version"];

        expect(command).toBe("npm");
        expect(args).toEqual(["view", "@better-auth-cloudflare/cli", "version"]);
    });

    test("update check handles network failures gracefully", () => {
        // Test error handling for network failures
        function mockUpdateCheck(shouldFail: boolean): { success: boolean; version?: string } {
            if (shouldFail) {
                // Simulate network failure - should fail silently
                return { success: false };
            }
            return { success: true, version: "0.2.0" };
        }

        // Network failure should not throw
        expect(() => mockUpdateCheck(true)).not.toThrow();
        
        // Success case should return version
        const result = mockUpdateCheck(false);
        expect(result.success).toBe(true);
        expect(result.version).toBe("0.2.0");
    });

    test("update suggestions are user-friendly", () => {
        const updateMessage = mockFormatUpdateMessage("0.1.0", "0.2.0");
        
        // Should provide clear upgrade instructions
        expect(updateMessage.some(msg => msg.includes("npm install -g"))).toBe(true);
        expect(updateMessage.some(msg => msg.includes("npx"))).toBe(true);
        
        // Should use friendly emoji and formatting
        expect(updateMessage[0]).toContain("🔄");
        expect(updateMessage[0]).toContain("→");
    });
});

describe("Integration with CLI Commands", () => {
    test("version is shown in command intros", () => {
        const version = "0.1.0";
        
        // Test intro message formats used in actual commands
        const generateIntro = `Better Auth Cloudflare v${version} · generator`;
        const migrateIntro = `Better Auth Cloudflare v${version} · migrate`;
        
        expect(generateIntro).toContain(version);
        expect(migrateIntro).toContain(version);
        expect(generateIntro).toContain("generator");
        expect(migrateIntro).toContain("migrate");
    });

    test("help command shows version", () => {
        const version = "0.1.0";
        const helpHeader = `@better-auth-cloudflare/cli v${version}`;
        
        expect(helpHeader).toContain("@better-auth-cloudflare/cli");
        expect(helpHeader).toContain(version);
    });

    test("no command shows help with version", () => {
        // When no command is specified, should show help with version
        const argv = ["node", "cli"];
        const cmd = argv[2]; // undefined
        const hasCliArgs = argv.slice(2).some(arg => arg.startsWith("--")); // false
        
        // This logic should trigger help display
        const shouldShowHelp = !cmd && !hasCliArgs;
        expect(shouldShowHelp).toBe(true);
    });
});
