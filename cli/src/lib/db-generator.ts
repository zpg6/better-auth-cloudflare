export interface DbConfig {
    template: "hono" | "nextjs";
    database: "sqlite" | "postgres" | "mysql";
    bindings: {
        d1?: string;
        hyperdrive?: string;
    };
    excludeAuthSchema?: boolean;
}

export function generateDbIndex(config: DbConfig): string {
    if (config.template === "hono") {
        return generateHonoDbIndex();
    } else {
        return generateNextjsDbIndex(config);
    }
}

function generateHonoDbIndex(): string {
    return `import { schema } from "./schema";

// Re-export the drizzle-orm types and utilities from here for convenience
export * from "drizzle-orm";

// Re-export the feature schemas for use in other files
export * from "./auth.schema"; // Export individual tables for drizzle-kit
export * from "./schema";
`;
}

function generateNextjsDbIndex(config: DbConfig): string {
    const imports = generateNextjsImports(config);
    const getDbFunction = generateGetDbFunction(config);
    const exports = generateNextjsExports(config.excludeAuthSchema);

    return `${imports}

${getDbFunction}

${exports}`;
}

function generateNextjsImports(config: DbConfig): string {
    const imports = ['import { getCloudflareContext } from "@opennextjs/cloudflare";'];

    if (config.database === "sqlite") {
        imports.push('import { drizzle } from "drizzle-orm/d1";');
    } else if (config.database === "postgres") {
        imports.push('import { drizzle } from "drizzle-orm/postgres-js";');
        imports.push('import postgres from "postgres";');
    } else {
        imports.push('import { drizzle } from "drizzle-orm/mysql2";');
        imports.push('import mysql from "mysql2/promise";');
    }

    imports.push('import { schema } from "./schema";');

    return imports.join("\n");
}

function generateGetDbFunction(config: DbConfig): string {
    const binding =
        config.database === "sqlite" ? config.bindings.d1 || "DATABASE" : config.bindings.hyperdrive || "HYPERDRIVE";

    if (config.database === "sqlite") {
        return `export async function getDb() {
    // Retrieves Cloudflare-specific context, including environment variables and bindings
    const { env } = await getCloudflareContext({ async: true });

    // Initialize Drizzle with your D1 binding (e.g., "DB" or "DATABASE" from wrangler.toml)
    return drizzle(env.${binding}, {
        // Ensure "${binding}" matches your D1 binding name in wrangler.toml
        schema,
        logger: true, // Optional
    });
}`;
    } else if (config.database === "postgres") {
        return `export async function getDb() {
    // Retrieves Cloudflare-specific context, including environment variables and bindings
    const { env } = await getCloudflareContext({ async: true });

    // Initialize Drizzle with your Hyperdrive binding for PostgreSQL
    return drizzle(postgres(env.${binding}.connectionString), {
        // Ensure "${binding}" matches your Hyperdrive binding name in wrangler.toml
        schema,
        logger: true, // Optional
    });
}`;
    } else {
        return `export async function getDb() {
    // Retrieves Cloudflare-specific context, including environment variables and bindings
    const { env } = await getCloudflareContext({ async: true });

    // Initialize Drizzle with your Hyperdrive binding for MySQL
    const pool = await mysql.createPool(env.${binding}.connectionString);
    return drizzle(pool, {
        // Ensure "${binding}" matches your Hyperdrive binding name in wrangler.toml
        schema,
    });
}`;
    }
}

function generateNextjsExports(excludeAuthSchema?: boolean): string {
    const authSchemaExport = excludeAuthSchema
        ? "// Temporary: auth.schema export removed"
        : 'export * from "@/db/auth.schema";';

    return `// Re-export the drizzle-orm types and utilities from here for convenience
export * from "drizzle-orm";

// Re-export the feature schemas for use in other files
${authSchemaExport}
export * from "./schema";`;
}
