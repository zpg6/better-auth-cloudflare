import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createClient(db: D1Database): DrizzleD1Database<typeof schema> {
	return drizzle(db, {
		schema
	});
}

export type DrizzleClient = ReturnType<typeof createClient>;

export * from './schema';
