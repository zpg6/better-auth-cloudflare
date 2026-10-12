import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createClient(env: App.Platform['env'] & { HYPERDRIVE: { connectionString: string } }) {
	const client = postgres(env.HYPERDRIVE.connectionString, { prepare: false });
	return drizzle(client, {
		schema
	});
}

export type DrizzleClient = ReturnType<typeof createClient>;

export * from './schema';
