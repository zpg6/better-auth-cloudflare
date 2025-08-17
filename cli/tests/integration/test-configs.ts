import { TestConfig } from "./setup";

// Function to generate test configs with timestamp when called
export function getTestConfigurations(): TestConfig[] {
    const timestamp = Date.now();

    return [
        // 1. Basic Hono setup
        {
            name: "Hono + D1 Only",
            args: [
                `--app-name=test-hono-d1-only-${timestamp}`,
                "--template=hono",
                "--database=d1",
                "--kv=false",
                "--r2=false",
            ],
            expectedResources: { d1: true, kv: false, r2: false, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts"],
            databaseType: "sqlite",
            template: "hono",
        },
        // 2. Basic Next.js setup
        {
            name: "Next.js + Hyperdrive Only",
            args: [
                `--app-name=test-nextjs-hyperdrive-only-${timestamp}`,
                "--template=nextjs",
                "--database=hyperdrive-postgres",
                "--kv=false",
                "--r2=false",
                "--apply-migrations=prod",
            ],
            expectedResources: { d1: false, kv: false, r2: false, hyperdrive: true },
            expectedFiles: ["wrangler.toml", ".env", "src/auth/index.ts", "drizzle.config.ts", "next.config.ts"],
            databaseType: "postgres",
            template: "nextjs",
        },
        // 3. Full Hono feature set
        {
            name: "Hono + D1 + KV + R2",
            args: [
                `--app-name=test-hono-d1-all-${timestamp}`,
                "--template=hono",
                "--database=d1",
                "--kv=true",
                "--r2=true",
                "--r2-bucket-name=test-hono-all-bucket",
            ],
            expectedResources: { d1: true, kv: true, r2: true, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts"],
            databaseType: "sqlite",
            template: "hono",
        },
        // 4. Full Next.js feature set
        {
            name: "Next.js + Hyperdrive + KV + R2",
            args: [
                `--app-name=test-nextjs-hyperdrive-all-${timestamp}`,
                "--template=nextjs",
                "--database=hyperdrive-postgres",
                "--kv=true",
                "--r2=true",
                "--r2-bucket-name=test-nextjs-all-bucket",
                "--apply-migrations=prod",
            ],
            expectedResources: { d1: false, kv: true, r2: true, hyperdrive: true },
            expectedFiles: ["wrangler.toml", ".env", "src/auth/index.ts", "drizzle.config.ts", "next.config.ts"],
            databaseType: "postgres",
            template: "nextjs",
        },
        // 5. Skip setup edge case
        {
            name: "Hono + D1 Skip Setup",
            args: [
                "--app-name=test-hono-skip-setup",
                "--template=hono",
                "--database=d1",
                "--kv=true",
                "--r2=true",
                "--r2-bucket-name=test-skip-bucket",
            ],
            skipCloudflare: true,
            expectedResources: { d1: false, kv: false, r2: false, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts"],
            databaseType: "sqlite",
            template: "hono",
        },
        // 6. Next.js skip setup
        {
            name: "Next.js + Hyperdrive Skip Setup",
            args: [
                "--app-name=test-nextjs-skip-setup",
                "--template=nextjs",
                "--database=hyperdrive-postgres",
                "--kv=true",
                "--r2=true",
                "--r2-bucket-name=test-nextjs-skip-bucket",
                "--hd-connection-string=postgresql://user:password@localhost:5432/test",
            ],
            skipCloudflare: true,
            expectedResources: { d1: false, kv: false, r2: false, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts", "next.config.ts"],
            databaseType: "postgres",
            template: "nextjs",
        },
        // 7. Edge case: Special characters in names
        {
            name: "Hono + D1 Special Characters",
            args: [
                `--app-name=test-hono-special-chars-123-${timestamp}`,
                "--template=hono",
                "--database=d1",
                "--kv=true",
                "--r2=false",
            ],
            expectedResources: { d1: true, kv: true, r2: false, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts"],
            databaseType: "sqlite",
            template: "hono",
        },
        // 8. Pre-existing resources: Hono + D1 + KV (resources created first)
        {
            name: "Hono + D1 + KV Pre-existing Resources",
            args: [
                `--app-name=test-hono-preexisting-${timestamp}`,
                "--template=hono",
                "--database=d1",
                "--kv=true",
                "--r2=false",
            ],
            preCreateResources: true,
            expectedResources: { d1: true, kv: true, r2: false, hyperdrive: false },
            expectedFiles: ["wrangler.toml", "src/auth/index.ts", "drizzle.config.ts"],
            databaseType: "sqlite",
            template: "hono",
        },
        // 9. Pre-existing resources: Next.js + Hyperdrive + KV + R2 (resources created first)
        {
            name: "Next.js + Hyperdrive + KV + R2 Pre-existing Resources",
            args: [
                `--app-name=test-nextjs-preexisting-${timestamp}`,
                "--template=nextjs",
                "--database=hyperdrive-postgres",
                "--kv=true",
                "--r2=true",
                "--r2-bucket-name=test-nextjs-preexisting-bucket",
                "--apply-migrations=prod",
            ],
            preCreateResources: true,
            expectedResources: { d1: false, kv: true, r2: true, hyperdrive: true },
            expectedFiles: ["wrangler.toml", ".env", "src/auth/index.ts", "drizzle.config.ts", "next.config.ts"],
            databaseType: "postgres",
            template: "nextjs",
        },
    ];
}

// Legacy exports for backward compatibility
export const TEST_CONFIGURATIONS: TestConfig[] = getTestConfigurations();
export const QUICK_TEST_CONFIGURATIONS: TestConfig[] = getTestConfigurations();
