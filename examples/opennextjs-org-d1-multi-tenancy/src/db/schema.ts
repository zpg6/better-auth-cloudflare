import * as authSchema from "./auth.schema"; // Core auth tables (main database)
import * as tenantSchema from "./tenant.schema"; // Tenant tables (tenant databases)

// Combine all schemas here for migrations
export const schema = {
    ...authSchema,
    ...tenantSchema,
} as const;
