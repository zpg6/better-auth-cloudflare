import * as authSchema from './auth.schema';

// Export all schemas individually so that Drizzle Kit can discover the tables.
export * from './auth.schema';

// If you have other schema files, you can export them here.
// import * as otherSchema from "./other.schema";
// export * from "./other.schema";

// Combine all schemas into a single object for the Drizzle client to use at runtime.
export const schema = {
	...authSchema
	// ...otherSchema,
} as const;
