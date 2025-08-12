export interface WranglerConfig {
    appName: string;
    template: "hono" | "nextjs";
    resources: {
        d1: boolean;
        kv: boolean;
        r2: boolean;
        hyperdrive: boolean;
    };
    bindings: {
        d1?: string;
        kv?: string;
        r2?: string;
        hyperdrive?: string;
    };
    skipCloudflareSetup?: boolean;
    resourceIds?: {
        d1?: string;
        kv?: string;
        r2BucketName?: string;
        hyperdriveId?: string;
        hyperdriveConnectionString?: string;
    };
}

export function generateWranglerToml(config: WranglerConfig): string {
    const header = generateHeader();
    const basicConfig = generateBasicConfig(config);
    const assetsConfig = config.template === "nextjs" ? generateAssetsConfig() : "";
    const observabilityConfig = generateObservabilityConfig();
    const placementConfig = generatePlacementConfig();
    const resourcesConfig = generateResourcesConfig(config);
    const footer = generateFooter(config);

    return [header, basicConfig, assetsConfig, observabilityConfig, placementConfig, resourcesConfig, footer]
        .filter(Boolean)
        .join("\n");
}

function generateHeader(): string {
    return `# For more details on how to configure Wrangler, refer to:
# https://developers.cloudflare.com/workers/wrangler/configuration/`;
}

function generateBasicConfig(config: WranglerConfig): string {
    const main = config.template === "hono" ? "src/index.ts" : ".open-next/worker.js";
    const compatibilityFlags =
        config.template === "hono" ? '["nodejs_compat"]' : '["nodejs_compat", "global_fetch_strictly_public"]';

    return `
name = "${config.appName}"
main = "${main}"
compatibility_date = "2025-03-01"
compatibility_flags = ${compatibilityFlags}`;
}

function generateAssetsConfig(): string {
    return `
[assets]
binding = "ASSETS"
directory = ".open-next/assets"`;
}

function generateObservabilityConfig(): string {
    return `
[observability]
enabled = true`;
}

function generatePlacementConfig(): string {
    return `
[placement]
mode = "smart"`;
}

function generateResourcesConfig(config: WranglerConfig): string {
    const resources: string[] = [];

    // D1 Database
    if (config.resources.d1) {
        const binding = config.bindings.d1 || "DATABASE";
        const databaseName = `${config.appName}-db`;
        const databaseId = config.skipCloudflareSetup
            ? "your-d1-database-id-here"
            : config.resourceIds?.d1 || "your-d1-database-id-here";

        resources.push(`
[[d1_databases]]
binding = "${binding}"
database_name = "${databaseName}"
database_id = "${databaseId}"
migrations_dir = "drizzle"`);
    }

    // KV Namespace
    if (config.resources.kv) {
        const binding = config.bindings.kv || "KV";
        const kvId = config.skipCloudflareSetup
            ? "your-kv-namespace-id-here"
            : config.resourceIds?.kv || "your-kv-namespace-id-here";

        resources.push(`
[[kv_namespaces]]
binding = "${binding}"
id = "${kvId}"`);
    }

    // R2 Bucket
    if (config.resources.r2) {
        const binding = config.bindings.r2 || "R2_BUCKET";
        const bucketName = config.resourceIds?.r2BucketName || `${config.appName}-files`;

        resources.push(`
[[r2_buckets]]
binding = "${binding}"
bucket_name = "${bucketName}"`);
    }

    // Hyperdrive
    if (config.resources.hyperdrive) {
        const binding = config.bindings.hyperdrive || "HYPERDRIVE";
        const hyperdriveId = config.skipCloudflareSetup
            ? "your-hyperdrive-id-here"
            : config.resourceIds?.hyperdriveId || "your-hyperdrive-id-here";
        
        // Add proper localConnectionString for Next.js builds
        const localConnectionString = config.resourceIds?.hyperdriveConnectionString || 
            "postgresql://postgres:password@localhost:5432/postgres";

        resources.push(`
[[hyperdrive]]
binding = "${binding}"
id = "${hyperdriveId}"
localConnectionString = "${localConnectionString}"`);
    }

    return resources.join("\n");
}

function generateFooter(config: WranglerConfig): string {
    const protectedResources: string[] = [];

    if (config.resources.d1) protectedResources.push("database id");
    if (config.resources.kv) protectedResources.push("kv id");
    if (config.resources.r2) protectedResources.push("r2 bucket name");
    if (config.resources.hyperdrive) protectedResources.push("hyperdrive id");

    if (protectedResources.length === 0) return "";

    const resourcesList = protectedResources.join(", ");

    return `

# To protect the ${resourcesList}, we ignore this
# file when committing to the repo by running once:
# git update-index --assume-unchanged wrangler.toml
#
# Put back in git if you need to commit this file:
# git update-index --no-assume-unchanged wrangler.toml`;
}
