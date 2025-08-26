import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import { existsSync } from "fs";
import { join } from "path";

// Conditionally import tenant schema if it exists
let tenantSchema = {};
try {
    if (existsSync(join(__dirname, "tenant.schema.ts")) || existsSync(join(__dirname, "tenant.schema.js"))) {
        tenantSchema = require("./tenant.schema");
    }
} catch (error) {
    // Tenant schema doesn't exist yet, use empty object
    tenantSchema = {};
}

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    ...tenantSchema,
} as const;
