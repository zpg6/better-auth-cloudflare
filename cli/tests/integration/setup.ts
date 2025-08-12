import { execSync, spawn, spawnSync } from "child_process";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";

export interface TestConfig {
    name: string;
    args: string[];
    skipCloudflare?: boolean;
    expectedResources: {
        d1?: boolean;
        kv?: boolean;
        r2?: boolean;
        hyperdrive?: boolean;
    };
    expectedFiles: string[];
    databaseType: "sqlite" | "postgres";
    template: "hono" | "nextjs";
}

export class TestEnvironment {
    private static readonly ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
    private static readonly POSTGRES_URL = process.env.DATABASE_URL;
    private static readonly TEST_DIR = "/tmp/cli-integration-tests";

    static {
        const isQuickTest = process.env.QUICK_TESTS === "true";

        if (!isQuickTest) {
            if (!TestEnvironment.ACCOUNT_ID) {
                console.warn("⚠️  CLOUDFLARE_ACCOUNT_ID environment variable not set - integration tests will be skipped");
                process.env.SKIP_INTEGRATION_TESTS = "true";
            }
            if (!TestEnvironment.POSTGRES_URL) {
                console.warn("⚠️  DATABASE_URL environment variable not set - PostgreSQL tests will be skipped");
                process.env.SKIP_POSTGRES_TESTS = "true";
            }
        }
    }

    private readonly createdResources: Array<{
        type: "worker" | "d1" | "kv" | "r2" | "hyperdrive";
        name: string;
        id?: string;
    }> = [];

    constructor(private readonly testName: string) {
        this.setupTestDirectory();
    }

    static get accountId() {
        if (!this.ACCOUNT_ID) {
            throw new Error("CLOUDFLARE_ACCOUNT_ID not available in quick test mode");
        }
        return this.ACCOUNT_ID;
    }
    static get postgresUrl() {
        if (!this.POSTGRES_URL) {
            throw new Error("DATABASE_URL not available in quick test mode");
        }
        return this.POSTGRES_URL;
    }
    static get testDir() {
        return this.TEST_DIR;
    }

    private setupTestDirectory() {
        if (!existsSync(TestEnvironment.TEST_DIR)) {
            mkdirSync(TestEnvironment.TEST_DIR, { recursive: true });
        }
    }

    async runCli(config: TestConfig): Promise<string> {
        const args = [
            ...config.args,
            `--account-id=${TestEnvironment.ACCOUNT_ID}`,
            ...(config.skipCloudflare ? ["--skip-cloudflare-setup"] : []),
            ...(config.expectedResources.hyperdrive ? [`--hd-connection-string=${TestEnvironment.POSTGRES_URL}`] : []),
        ];

        // Preemptive cleanup of resources that might exist
        await this.preemptiveCleanup(config);

        console.log(`🚀 Running CLI: ${args.join(" ")}`);

        const result = spawnSync("node", [join(process.cwd(), "dist/index.js"), ...args], {
            cwd: TestEnvironment.TEST_DIR,
            encoding: "utf8",
            stdio: "pipe",
            env: {
                ...process.env,
                CLOUDFLARE_ACCOUNT_ID: TestEnvironment.ACCOUNT_ID,
                DATABASE_URL: TestEnvironment.POSTGRES_URL,
            },
        });

        if (result.error) {
            throw result.error;
        }

        if (result.status !== 0) {
            console.error("=== CLI OUTPUT ===");
            console.error("STDOUT:", result.stdout);
            console.error("STDERR:", result.stderr);
            console.error("=== END CLI OUTPUT ===");
            throw new Error(`CLI failed with status ${result.status}: ${result.stderr}`);
        }

        const output = result.stdout as string;

        // Track resources for cleanup
        this.trackResourcesFromOutput(output, config);

        return output;
    }

    private trackResourcesFromOutput(output: string, config: TestConfig) {
        const appName = this.extractAppName(config.args);

        if (appName) {
            this.createdResources.push({ type: "worker", name: appName });

            if (config.expectedResources.d1) {
                this.createdResources.push({ type: "d1", name: `${appName}-db` });
            }

            if (config.expectedResources.kv) {
                this.createdResources.push({ type: "kv", name: `${appName}-kv` });
            }

            if (config.expectedResources.r2) {
                const r2Match = config.args.find(arg => arg.startsWith("--r2-bucket-name="));
                if (r2Match) {
                    const bucketName = r2Match.split("=")[1];
                    this.createdResources.push({ type: "r2", name: bucketName });
                }
            }

            if (config.expectedResources.hyperdrive) {
                this.createdResources.push({ type: "hyperdrive", name: `${appName}-hyperdrive` });
            }
        }
    }

    private extractAppName(args: string[]): string | null {
        const appNameArg = args.find(arg => arg.startsWith("--app-name="));
        return appNameArg ? appNameArg.split("=")[1] : null;
    }

    private async preemptiveCleanup(config: TestConfig) {
        console.log("🧹 Performing preemptive cleanup...");

        const appName = this.extractAppName(config.args);
        if (!appName) return;

        const accountId = TestEnvironment.ACCOUNT_ID;

        // Clean up local project directory first (fastest)
        const projectPath = this.getProjectPath(appName);
        if (existsSync(projectPath)) {
            rmSync(projectPath, { recursive: true, force: true });
            console.log(`✅ Cleaned up existing local directory: ${appName}`);
        }

        // Skip Cloudflare cleanup if we're in skip mode anyway
        if (config.skipCloudflare) {
            console.log("⏭️  Skipping Cloudflare resource cleanup (skip-cloudflare mode)");
            return;
        }

        const cleanupPromises = [];

        // Clean up worker (fastest)
        cleanupPromises.push(
            this.safeExecSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler delete --name ${appName}`, 3000, "yes\n")
                .then(() => console.log(`✅ Cleaned up existing worker: ${appName}`))
                .catch(() => {}) // Ignore errors
        );

        // Clean up D1 database
        if (config.expectedResources.d1) {
            const dbName = `${appName}-db`;
            cleanupPromises.push(
                this.safeExecSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler d1 delete ${dbName} -y`, 3000)
                    .then(() => console.log(`✅ Cleaned up existing D1 database: ${dbName}`))
                    .catch(() => {}) // Ignore errors
            );
        }

        // Clean up R2 bucket
        if (config.expectedResources.r2) {
            const r2Match = config.args.find(arg => arg.startsWith("--r2-bucket-name="));
            if (r2Match) {
                const bucketName = r2Match.split("=")[1];
                cleanupPromises.push(
                    this.safeExecSync(
                        `CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler r2 bucket delete ${bucketName}`,
                        3000
                    )
                        .then(() => console.log(`✅ Cleaned up existing R2 bucket: ${bucketName}`))
                        .catch(() => {}) // Ignore errors
                );
            }
        }

        // Wait for all cleanup operations with a timeout
        try {
            await Promise.race([
                Promise.all(cleanupPromises),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Cleanup timeout")), 10000)),
            ]);
        } catch (error) {
            console.warn("⚠️  Some cleanup operations timed out, continuing...");
        }

        console.log("🧹 Preemptive cleanup completed");
    }

    private safeExecSync(command: string, timeout: number, input?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // spawn already imported at top
            const [cmd, ...args] = command.split(" ");

            let child: any;

            const timer = setTimeout(() => {
                if (child && !child.killed) {
                    child.kill("SIGTERM");
                    setTimeout(() => {
                        if (child && !child.killed) {
                            child.kill("SIGKILL");
                        }
                    }, 1000);
                }
                reject(new Error("Command timeout"));
            }, timeout);

            try {
                child = spawn(cmd, args, {
                    stdio: "pipe",
                    env: process.env,
                });

                // Send input if provided
                if (input && child.stdin) {
                    child.stdin.write(input);
                    child.stdin.end();
                }

                let stdout = "";
                let stderr = "";

                child.stdout?.on("data", (data: Buffer) => {
                    stdout += data.toString();
                });

                child.stderr?.on("data", (data: Buffer) => {
                    stderr += data.toString();
                });

                child.on("close", (code: number) => {
                    clearTimeout(timer);
                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error(`Command failed with code ${code}: ${stderr}`));
                    }
                });

                child.on("error", (error: Error) => {
                    clearTimeout(timer);
                    reject(error);
                });
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    getProjectPath(appName: string): string {
        return join(TestEnvironment.TEST_DIR, appName);
    }

    async cleanup() {
        console.log(`🧹 Cleaning up resources for: ${this.testName}`);

        const errors: string[] = [];

        // Clean up Cloudflare resources
        for (const resource of this.createdResources) {
            try {
                await this.cleanupResource(resource);
                console.log(`✅ Cleaned up ${resource.type}: ${resource.name}`);
            } catch (error) {
                const errorMsg = `Failed to cleanup ${resource.type} ${resource.name}: ${error}`;
                errors.push(errorMsg);
                console.warn(`⚠️  ${errorMsg}`);
            }
        }

        // Clean up PostgreSQL tables for hyperdrive tests
        if (this.createdResources.some(r => r.type === "hyperdrive")) {
            try {
                await this.cleanupPostgresTables();
                console.log("✅ Cleaned up PostgreSQL tables");
            } catch (error) {
                errors.push(`PostgreSQL cleanup failed: ${error}`);
            }
        }

        // Clean up local directories
        this.createdResources
            .filter(r => r.type === "worker")
            .forEach(r => {
                const projectPath = this.getProjectPath(r.name);
                if (existsSync(projectPath)) {
                    rmSync(projectPath, { recursive: true, force: true });
                    console.log(`✅ Deleted local directory: ${r.name}`);
                }
            });

        if (errors.length > 0) {
            console.warn(`⚠️  Cleanup completed with ${errors.length} warnings`);
        }
    }

    private async cleanupResource(resource: { type: string; name: string }) {
        const accountId = TestEnvironment.ACCOUNT_ID;

        switch (resource.type) {
            case "worker": {
                try {
                    execSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler delete --name ${resource.name}`, {
                        stdio: "pipe",
                        input: "yes\n",
                    });
                } catch (error) {
                    // Worker might not exist, which is fine
                    console.log(`⚠️  Worker ${resource.name} might not exist (this is fine)`);
                }
                break;
            }

            case "d1": {
                execSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler d1 delete ${resource.name} -y`, {
                    stdio: "pipe",
                });
                break;
            }

            case "kv": {
                // List and delete KV namespaces
                const kvList = execSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler kv namespace list`, {
                    stdio: "pipe",
                    encoding: "utf8",
                });

                // Parse table output to find matching namespaces
                const lines = kvList.split("\n");
                for (const line of lines) {
                    if (line.includes(resource.name) && line.includes("│")) {
                        const parts = line.split("│").map(p => p.trim());
                        if (parts.length >= 2) {
                            const namespaceId = parts[0];
                            if (namespaceId && namespaceId !== "ID" && namespaceId.length > 10) {
                                execSync(
                                    `CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler kv namespace delete --namespace-id=${namespaceId}`,
                                    {
                                        stdio: "pipe",
                                    }
                                );
                            }
                        }
                    }
                }
                break;
            }

            case "r2": {
                execSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler r2 bucket delete ${resource.name}`, {
                    stdio: "pipe",
                });
                break;
            }

            case "hyperdrive": {
                // List and delete Hyperdrive configs
                const hdList = execSync(`CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler hyperdrive list`, {
                    stdio: "pipe",
                    encoding: "utf8",
                });

                // Parse table output to find matching configs
                const lines = hdList.split("\n");
                for (const line of lines) {
                    if (line.includes(resource.name) && line.includes("│")) {
                        const parts = line.split("│").map(p => p.trim());
                        if (parts.length >= 2) {
                            const hyperdriveId = parts[0];
                            if (hyperdriveId && hyperdriveId !== "ID" && hyperdriveId.length > 10) {
                                execSync(
                                    `CLOUDFLARE_ACCOUNT_ID=${accountId} npx wrangler hyperdrive delete ${hyperdriveId}`,
                                    {
                                        stdio: "pipe",
                                    }
                                );
                            }
                        }
                    }
                }
                break;
            }
        }
    }

    private async cleanupPostgresTables() {
        if (!TestEnvironment.POSTGRES_URL) {
            console.log("📝 No PostgreSQL URL configured - skipping table cleanup");
            return;
        }

        console.log("🧹 Cleaning up PostgreSQL tables...");

        try {
            // Use bun to run the cleanup script with better error handling
            const result = execSync(
                `bun -e "
                import postgres from 'postgres';
                
                let sql;
                try {
                    sql = postgres('${TestEnvironment.POSTGRES_URL}', {
                        max: 1,
                        idle_timeout: 5,
                        connect_timeout: 10
                    });
                    
                    // Test connection first
                    await sql\\\`SELECT 1\\\`;
                    console.log('✅ PostgreSQL connection established');
                    
                    // Drop tables in correct order (respecting foreign keys)
                    const tables = [
                        'user_files',
                        'sessions', 
                        'accounts',
                        'verifications',
                        'users',
                        '__drizzle_migrations'
                    ];
                    
                    for (const table of tables) {
                        try {
                            await sql\\\`DROP TABLE IF EXISTS \\\${sql(table)} CASCADE\\\`;
                            console.log(\\\`✅ Dropped table: \\\${table}\\\`);
                        } catch (e) {
                            console.log(\\\`⚠️  Table \\\${table} did not exist (this is fine)\\\`);
                        }
                    }
                    
                    // Drop schema if it exists
                    try {
                        await sql\\\`DROP SCHEMA IF EXISTS drizzle CASCADE\\\`;
                        console.log('✅ Dropped drizzle schema');
                    } catch (e) {
                        console.log('⚠️  Drizzle schema did not exist (this is fine)');
                    }
                    
                    console.log('✅ PostgreSQL cleanup completed successfully');
                    
                } catch (e) {
                    console.error('❌ PostgreSQL cleanup error:', e.message);
                    process.exit(1);
                } finally {
                    if (sql) {
                        try {
                            await sql.end();
                        } catch (e) {
                            // Ignore connection close errors
                        }
                    }
                }
                "`,
                { 
                    stdio: "pipe",
                    encoding: "utf8",
                    timeout: 30000 // 30 second timeout
                }
            );

            console.log("✅ PostgreSQL tables cleaned up successfully");
            
        } catch (error) {
            console.error(`❌ CRITICAL: PostgreSQL cleanup failed: ${error}`);
            console.error("This will cause test contamination and must be fixed!");
            
            // For now, log the specific error but don't fail the test
            // In production, we might want to fail the test suite
            console.error("Error details:", error.message);
            
            throw new Error(`PostgreSQL cleanup failed: ${error.message}`);
        }
    }
}

export function readProjectFile(projectPath: string, filePath: string): string {
    const fullPath = join(projectPath, filePath);
    if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${filePath}`);
    }
    return readFileSync(fullPath, "utf8");
}

export function projectFileExists(projectPath: string, filePath: string): boolean {
    return existsSync(join(projectPath, filePath));
}
