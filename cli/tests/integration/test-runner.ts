#!/usr/bin/env bun

/**
 * Simple test runner to validate the integration tests work
 * Run with: bun tests/integration/test-runner.ts
 */

import { TestEnvironment } from "./setup";
import { FileValidator } from "./validators";
import { QUICK_TEST_CONFIGURATIONS } from "./test-configs";

async function runSingleTest() {
    // Use the first quick test configuration (Hono + D1 Only)
    const config = QUICK_TEST_CONFIGURATIONS[0];
    console.log(`🧪 Testing configuration: ${config.name}`);
    console.log(`⚙️  Args: ${config.args.join(" ")}`);

    const env = new TestEnvironment(`test-runner-${config.name}`);

    try {
        // Run CLI
        console.log("\n🚀 Running CLI...");
        const output = await env.runCli(config);
        console.log("✅ CLI completed successfully");
        console.log("📋 Output preview:", output.substring(0, 200) + "...");

        // Get project details
        const appName = config.args.find(arg => arg.startsWith("--app-name="))?.split("=")[1];
        if (!appName) {
            throw new Error("App name not found");
        }

        const projectPath = env.getProjectPath(appName);
        const validator = new FileValidator(projectPath, appName);

        // Validate basic files exist
        console.log("\n📄 Checking files...");
        for (const file of config.expectedFiles) {
            const exists = validator.projectFileExists(projectPath, file);
            if (exists) {
                console.log(`✅ ${file}`);
            } else {
                console.log(`❌ ${file} - MISSING`);
            }
        }

        // Validate wrangler.toml
        console.log("\n⚙️  Validating wrangler.toml...");
        const wranglerResult = validator.validateWranglerToml(
            config.expectedResources,
            config.databaseType,
            config.skipCloudflare
        );

        if (wranglerResult.success) {
            console.log("✅ wrangler.toml validation passed");
        } else {
            console.log("❌ wrangler.toml validation failed:");
            wranglerResult.errors.forEach(error => console.log(`  - ${error}`));
        }

        // Test build
        console.log("\n🔨 Testing build...");
        const { execSync } = await import("child_process");
        try {
            execSync("npm run build", {
                cwd: projectPath,
                stdio: "pipe",
            });
            console.log("✅ Project builds successfully");
        } catch (error) {
            console.log("❌ Build failed:", error);
        }

        console.log("\n🎉 Test runner completed successfully!");
    } catch (error) {
        console.error("❌ Test failed:", error);
        process.exit(1);
    } finally {
        // Cleanup
        console.log("\n🧹 Cleaning up...");
        await env.cleanup();
        console.log("✅ Cleanup completed");
    }
}

if (import.meta.main) {
    runSingleTest().catch(console.error);
}
