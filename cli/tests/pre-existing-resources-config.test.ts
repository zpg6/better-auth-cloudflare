import { describe, test, expect } from "bun:test";
import { getTestConfigurations } from "./integration/test-configs";

describe("Pre-existing Resources Integration Test Configuration", () => {
    test("should include pre-existing resource test configurations", () => {
        const configs = getTestConfigurations();

        // Find the pre-existing resource configurations
        const preExistingConfigs = configs.filter(config => config.preCreateResources);

        expect(preExistingConfigs.length).toBe(2);

        // Verify Hono + D1 + KV pre-existing config
        const honoConfig = preExistingConfigs.find(
            config => config.name.includes("Hono") && config.name.includes("Pre-existing")
        );
        expect(honoConfig).toBeDefined();
        expect(honoConfig?.template).toBe("hono");
        expect(honoConfig?.expectedResources.d1).toBe(true);
        expect(honoConfig?.expectedResources.kv).toBe(true);
        expect(honoConfig?.expectedResources.r2).toBe(false);
        expect(honoConfig?.expectedResources.hyperdrive).toBe(false);
        expect(honoConfig?.preCreateResources).toBe(true);

        // Verify Next.js + Hyperdrive + KV + R2 pre-existing config
        const nextjsConfig = preExistingConfigs.find(
            config => config.name.includes("Next.js") && config.name.includes("Pre-existing")
        );
        expect(nextjsConfig).toBeDefined();
        expect(nextjsConfig?.template).toBe("nextjs");
        expect(nextjsConfig?.expectedResources.d1).toBe(false);
        expect(nextjsConfig?.expectedResources.kv).toBe(true);
        expect(nextjsConfig?.expectedResources.r2).toBe(true);
        expect(nextjsConfig?.expectedResources.hyperdrive).toBe(true);
        expect(nextjsConfig?.preCreateResources).toBe(true);
    });

    test("should have unique app names for pre-existing resource tests", () => {
        const configs = getTestConfigurations();
        const preExistingConfigs = configs.filter(config => config.preCreateResources);

        const appNames = preExistingConfigs.map(config => {
            const appNameArg = config.args.find(arg => arg.startsWith("--app-name="));
            return appNameArg?.split("=")[1];
        });

        // All app names should be defined and unique
        expect(appNames.every(name => name !== undefined)).toBe(true);
        expect(new Set(appNames).size).toBe(appNames.length);

        // App names should include "preexisting" to distinguish them
        expect(appNames.every(name => name?.includes("preexisting"))).toBe(true);
    });

    test("should cover different resource combinations for pre-existing tests", () => {
        const configs = getTestConfigurations();
        const preExistingConfigs = configs.filter(config => config.preCreateResources);

        // Should test both D1 and Hyperdrive scenarios (can't have both together)
        const hasD1Test = preExistingConfigs.some(config => config.expectedResources.d1);
        const hasHyperdriveTest = preExistingConfigs.some(config => config.expectedResources.hyperdrive);

        expect(hasD1Test).toBe(true);
        expect(hasHyperdriveTest).toBe(true);

        // Should test KV in both scenarios
        const kvTests = preExistingConfigs.filter(config => config.expectedResources.kv);
        expect(kvTests.length).toBe(2);

        // Should test R2 in at least one scenario
        const r2Tests = preExistingConfigs.filter(config => config.expectedResources.r2);
        expect(r2Tests.length).toBeGreaterThan(0);
    });

    test("should have proper CLI arguments for pre-existing resource tests", () => {
        const configs = getTestConfigurations();
        const preExistingConfigs = configs.filter(config => config.preCreateResources);

        for (const config of preExistingConfigs) {
            // Should have app name
            expect(config.args.some(arg => arg.startsWith("--app-name="))).toBe(true);

            // Should have template
            expect(config.args.some(arg => arg.startsWith("--template="))).toBe(true);

            // Should have database type
            expect(config.args.some(arg => arg.startsWith("--database="))).toBe(true);

            // If has KV, should have kv=true
            if (config.expectedResources.kv) {
                expect(config.args.some(arg => arg === "--kv=true")).toBe(true);
            }

            // If has R2, should have r2=true and bucket name
            if (config.expectedResources.r2) {
                expect(config.args.some(arg => arg === "--r2=true")).toBe(true);
                expect(config.args.some(arg => arg.startsWith("--r2-bucket-name="))).toBe(true);
            }
        }
    });
});
