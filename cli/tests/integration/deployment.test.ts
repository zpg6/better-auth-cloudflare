import { expect } from "bun:test";
import { execSync } from "child_process";
import { TestEnvironment, TestConfig } from "./setup";

export async function testDeployment(env: TestEnvironment, config: TestConfig): Promise<void> {
    if (config.skipCloudflare) {
        console.log("⏭️  Skipping deployment test for skip-cloudflare configuration");
        return;
    }

    const appName = config.args.find(arg => arg.startsWith("--app-name="))?.split("=")[1];
    if (!appName) {
        throw new Error("App name not found in config");
    }

    const projectPath = env.getProjectPath(appName);

    console.log(`🚀 Testing deployment for ${appName}...`);

    try {
        // Build and deploy the application
        let deployResult: string;

        if (config.template === "nextjs") {
            // Next.js requires opennextjs-cloudflare build before deploy
            execSync("npm run build:cf", {
                cwd: projectPath,
                encoding: "utf8",
                stdio: "pipe",
                env: {
                    ...process.env,
                    CLOUDFLARE_ACCOUNT_ID: TestEnvironment.accountId,
                    // localConnectionString is now properly set in wrangler.toml by CLI
                },
            });

            deployResult = execSync("npx wrangler deploy --compatibility-date=2024-09-23", {
                cwd: projectPath,
                encoding: "utf8",
                stdio: "pipe",
                                    timeout: 300000, // 5 minute timeout for Next.js deployments
                env: {
                    ...process.env,
                    CLOUDFLARE_ACCOUNT_ID: TestEnvironment.accountId,
                },
            });
        } else {
            // Hono projects can deploy directly
            deployResult = execSync("npx wrangler deploy --compatibility-date=2024-09-23", {
                cwd: projectPath,
                encoding: "utf8",
                stdio: "pipe",
                                    timeout: 180000, // 3 minute timeout for Hono deployments
                env: {
                    ...process.env,
                    CLOUDFLARE_ACCOUNT_ID: TestEnvironment.accountId,
                },
            });
        }

        expect(deployResult).toMatch(
            /Deployed|Success.*Uploaded.*files|Total Upload|Starting asset upload|Found.*assets to upload/i
        );
        console.log("✅ Deployment successful");

        // Extract deployment URL
        const urlMatch = deployResult.match(/https:\/\/[^\s]+/);
        if (!urlMatch) {
            throw new Error("Deployment URL not found in output");
        }

        const deploymentUrl = urlMatch[0];
        console.log(`📡 Deployed to: ${deploymentUrl}`);

        // Test basic connectivity
        await testBasicConnectivity(deploymentUrl);

        // Test auth endpoints
        if (config.template === "nextjs") {
            await testNextjsAuthEndpoints(deploymentUrl);
        } else {
            await testHonoAuthEndpoints(deploymentUrl);
        }
    } catch (error) {
        console.error(`❌ Deployment test failed: ${error}`);
        throw error;
    }
}

async function testBasicConnectivity(url: string): Promise<void> {
    console.log("🔍 Testing basic connectivity...");

    try {
        const response = await fetch(url, {
            method: "GET",
            signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        // Home page should return 200
        expect(response.status).toBe(200);
        console.log(`✅ Basic connectivity test passed (status: ${response.status})`);
    } catch (error) {
        console.error(`❌ Basic connectivity failed: ${error}`);
        throw error;
    }
}

async function testNextjsAuthEndpoints(baseUrl: string): Promise<void> {
    console.log("🔐 Testing Next.js routes...");

    try {
        // Test protected dashboard route - should return 401 or redirect (3xx) without auth
        const dashboardResponse = await fetch(`${baseUrl}/dashboard`, {
            method: "GET",
            signal: AbortSignal.timeout(10000),
            redirect: "manual", // Don't follow redirects
        });

        // Should return 401 or redirect status (3xx) since user is not authenticated
        const status = dashboardResponse.status;
        const isUnauthorized = status === 401;
        const isRedirect = status >= 300 && status < 400;
        
        if (!isUnauthorized && !isRedirect) {
            throw new Error(`Dashboard route should return 401 or 3xx without auth, got: ${status}`);
        }
        
        console.log(`✅ Protected dashboard route properly secured (status: ${status})`);
    } catch (error) {
        console.error(`❌ Next.js route test failed: ${error}`);
        throw error;
    }
}

async function testHonoAuthEndpoints(baseUrl: string): Promise<void> {
    console.log("🔐 Testing Hono routes...");

    try {
        // Test protected route - should return 401 without auth
        const protectedResponse = await fetch(`${baseUrl}/protected`, {
            method: "GET",
            signal: AbortSignal.timeout(10000),
        });

        // Should return 401 since user is not authenticated
        expect(protectedResponse.status).toBe(401);
        console.log(`✅ Protected route properly secured (status: ${protectedResponse.status})`);
    } catch (error) {
        console.error(`❌ Hono route test failed: ${error}`);
        throw error;
    }
}

export async function testDatabaseMigrations(env: TestEnvironment, config: TestConfig): Promise<void> {
    const appName = config.args.find(arg => arg.startsWith("--app-name="))?.split("=")[1];
    if (!appName) {
        throw new Error("App name not found in config");
    }

    const projectPath = env.getProjectPath(appName);

    console.log(`🗄️  Testing database migrations for ${appName}...`);

    if (config.databaseType === "sqlite" && !config.skipCloudflare) {
        // Test D1 migrations
        try {
            const result = execSync(
                `npx wrangler d1 execute ${appName}-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"`,
                {
                    cwd: projectPath,
                    encoding: "utf8",
                    stdio: "pipe",
                    env: {
                        ...process.env,
                        CLOUDFLARE_ACCOUNT_ID: TestEnvironment.accountId,
                    },
                }
            );

            // Check if tables exist (result format may vary)
            const hasUsers = result.includes("user") || result.includes("users");
            const hasSessions = result.includes("session") || result.includes("sessions");
            const hasAccounts = result.includes("account") || result.includes("accounts");

            if (!hasUsers && !hasSessions && !hasAccounts) {
                // If no tables found, check if it's because migrations weren't applied
                console.log("No auth tables found, checking migration status...");
                console.log("D1 query result:", result);
            }

            expect(hasUsers || hasSessions || hasAccounts).toBe(true);
            console.log("✅ D1 migrations applied successfully");
        } catch (error) {
            console.error(`❌ D1 migration test failed: ${error}`);
            throw error;
        }
    } else if (config.databaseType === "postgres" && !config.skipCloudflare) {
        // Test PostgreSQL migrations
        try {
            // Use bun to test the database connection and tables
            const testScript = `
                import postgres from 'postgres';
                const sql = postgres(process.env.DATABASE_URL);
                
                try {
                    const tables = await sql\`
                        SELECT table_name FROM information_schema.tables 
                        WHERE table_schema = 'public' AND table_name IN ('users', 'sessions', 'accounts')
                    \`;
                    
                    if (tables.length < 3) {
                        throw new Error(\`Missing auth tables. Found: \${tables.map(t => t.table_name).join(', ')}\`);
                    }
                    
                    console.log('✅ PostgreSQL tables found:', tables.map(t => t.table_name).join(', '));
                } finally {
                    await sql.end();
                }
            `;

            // Write the test script to a temporary file to avoid shell escaping issues
            const fs = require("fs");
            const path = require("path");
            const tempScript = path.join(projectPath, "temp-db-test.mjs");
            fs.writeFileSync(tempScript, testScript);

            try {
                execSync(`bun ${tempScript}`, {
                    cwd: projectPath,
                    encoding: "utf8",
                    stdio: "pipe",
                    env: {
                        ...process.env,
                        DATABASE_URL: TestEnvironment.postgresUrl,
                    },
                });
            } finally {
                // Clean up temp file
                if (fs.existsSync(tempScript)) {
                    fs.unlinkSync(tempScript);
                }
            }

            console.log("✅ PostgreSQL migrations applied successfully");
        } catch (error) {
            console.error(`❌ PostgreSQL migration test failed: ${error}`);
            throw error;
        }
    } else {
        console.log("⏭️  Skipping migration test for skip-cloudflare configuration");
    }
}
