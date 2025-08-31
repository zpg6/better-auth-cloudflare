import { defineConfig } from "drizzle-kit";

export default defineConfig({
    dialect: "sqlite",
    schema: "./src/db/tenant.schema.ts",
    out: "./drizzle-tenant",
    // Note: Tenant migrations are applied via CLI to individual tenant databases
    // This config is used only for generating migration files
    // Uses same env vars as multi-tenancy plugin for consistency
    ...(process.env.NODE_ENV === "production"
        ? {
              driver: "d1-http",
              dbCredentials: {
                  accountId: process.env.CLOUDFLARE_ACCT_ID,
                  databaseId: "placeholder", // Not used for generation
                  token: process.env.CLOUDFLARE_D1_API_TOKEN,
              },
          }
        : {}),
});
