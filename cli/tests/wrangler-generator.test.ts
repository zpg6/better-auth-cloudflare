import { describe, test, expect } from "bun:test";
import { generateWranglerToml } from "../src/lib/wrangler-generator";
import type { WranglerConfig } from "../src/lib/wrangler-generator";

describe("Wrangler Generator", () => {
    describe("Basic Configuration", () => {
        test("generates Hono basic configuration", () => {
            const config: WranglerConfig = {
                appName: "test-hono-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('name = "test-hono-app"');
            expect(result).toContain('main = "src/index.ts"');
            expect(result).toContain('compatibility_flags = ["nodejs_compat"]');
            expect(result).toContain("[observability]");
            expect(result).toContain("[placement]");
            expect(result).not.toContain("[assets]");
        });

        test("generates Next.js basic configuration", () => {
            const config: WranglerConfig = {
                appName: "test-nextjs-app",
                template: "nextjs",
                resources: { d1: false, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('name = "test-nextjs-app"');
            expect(result).toContain('main = ".open-next/worker.js"');
            expect(result).toContain('compatibility_flags = ["nodejs_compat", "global_fetch_strictly_public"]');
            expect(result).toContain("[assets]");
            expect(result).toContain('binding = "ASSETS"');
            expect(result).toContain('directory = ".open-next/assets"');
        });
    });

    describe("D1 Database Configuration", () => {
        test("generates D1 configuration with default binding", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("[[d1_databases]]");
            expect(result).toContain('binding = "DATABASE"');
            expect(result).toContain('database_name = "test-app-db"');
            expect(result).toContain('migrations_dir = "drizzle"');
        });

        test("generates D1 configuration with custom binding", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: { d1: "MY_DATABASE" },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('binding = "MY_DATABASE"');
        });

        test("generates D1 with real ID when not skipping setup", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: {},
                resourceIds: { d1: "real-d1-id-123" },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('database_id = "real-d1-id-123"');
        });

        test("generates D1 with placeholder when skipping setup", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: true, kv: false, r2: false, hyperdrive: false },
                bindings: {},
                skipCloudflareSetup: true,
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('database_id = "your-d1-database-id-here"');
        });
    });

    describe("KV Namespace Configuration", () => {
        test("generates KV configuration with default binding", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: true, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("[[kv_namespaces]]");
            expect(result).toContain('binding = "KV"');
        });

        test("generates KV configuration with custom binding", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: true, r2: false, hyperdrive: false },
                bindings: { kv: "MY_KV" },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('binding = "MY_KV"');
        });
    });

    describe("R2 Bucket Configuration", () => {
        test("generates R2 configuration with default binding", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: true, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("[[r2_buckets]]");
            expect(result).toContain('binding = "R2_BUCKET"');
            expect(result).toContain('bucket_name = "test-app-files"');
        });

        test("generates R2 configuration with custom bucket name", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: true, hyperdrive: false },
                bindings: { r2: "MY_BUCKET" },
                resourceIds: { r2BucketName: "custom-bucket-name" },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('binding = "MY_BUCKET"');
            expect(result).toContain('bucket_name = "custom-bucket-name"');
        });
    });

    describe("Hyperdrive Configuration", () => {
        test("generates Hyperdrive configuration", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: { hyperdrive: "MY_HYPERDRIVE" },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("[[hyperdrive]]");
            expect(result).toContain('binding = "MY_HYPERDRIVE"');
        });

        test("generates Hyperdrive with placeholder when skipping setup", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: false, hyperdrive: true },
                bindings: {},
                skipCloudflareSetup: true,
            };

            const result = generateWranglerToml(config);

            expect(result).toContain('id = "your-hyperdrive-id-here"');
        });
    });

    describe("Multiple Resources", () => {
        test("generates all resources configuration", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "nextjs",
                resources: { d1: true, kv: true, r2: true, hyperdrive: true },
                bindings: {
                    d1: "DATABASE",
                    kv: "KV",
                    r2: "R2_BUCKET",
                    hyperdrive: "HYPERDRIVE",
                },
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("[[d1_databases]]");
            expect(result).toContain("[[kv_namespaces]]");
            expect(result).toContain("[[r2_buckets]]");
            expect(result).toContain("[[hyperdrive]]");
            expect(result).toContain("[assets]"); // Next.js specific
        });

        test("generates no resource configurations when all disabled", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).not.toContain("[[d1_databases]]");
            expect(result).not.toContain("[[kv_namespaces]]");
            expect(result).not.toContain("[[r2_buckets]]");
            expect(result).not.toContain("[[hyperdrive]]");
        });
    });

    describe("Footer Generation", () => {
        test("generates appropriate footer for protected resources", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: true, kv: true, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("# To protect the database id, kv id");
            expect(result).toContain("git update-index --assume-unchanged wrangler.toml");
        });

        test("generates no footer when no protected resources", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: false, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).not.toContain("git update-index");
        });

        test("includes R2 bucket name in footer", () => {
            const config: WranglerConfig = {
                appName: "test-app",
                template: "hono",
                resources: { d1: false, kv: false, r2: true, hyperdrive: false },
                bindings: {},
            };

            const result = generateWranglerToml(config);

            expect(result).toContain("# To protect the r2 bucket name");
        });
    });

    describe("TOML Syntax Validation", () => {
        test("generates valid TOML syntax", () => {
            const config: WranglerConfig = {
                appName: "test-app-with-dashes",
                template: "nextjs",
                resources: { d1: true, kv: true, r2: true, hyperdrive: true },
                bindings: {
                    d1: "DATABASE",
                    kv: "KV",
                    r2: "R2_BUCKET",
                    hyperdrive: "HYPERDRIVE",
                },
            };

            const result = generateWranglerToml(config);

            // Basic TOML validation
            expect(result).toMatch(/^#/); // Starts with comment
            expect(result).toContain('name = "'); // Quoted strings
            expect(result).toContain("[["); // Array of tables syntax
            expect(result).not.toContain('""'); // No empty strings
            expect(result).not.toContain("=="); // No double equals

            // Check proper section headers
            expect(result).toMatch(/\[observability\]/);
            expect(result).toMatch(/\[placement\]/);
            expect(result).toMatch(/\[\[d1_databases\]\]/);
        });
    });
});
