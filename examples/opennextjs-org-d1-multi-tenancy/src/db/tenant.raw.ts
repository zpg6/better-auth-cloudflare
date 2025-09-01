// Raw SQL statements for creating tenant tables
// This is concatenated from actual migration files for just-in-time deployment

export const raw = `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at numeric
);
--> statement-breakpoint
CREATE TABLE \`birthday_reminders\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`tenant_id\` text NOT NULL,
	\`reminder_date\` integer NOT NULL,
	\`reminder_type\` text NOT NULL,
	\`sent\` integer,
	\`sent_at\` integer,
	\`created_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`birthday_wishs\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`from_user_id\` text NOT NULL,
	\`to_user_id\` text NOT NULL,
	\`tenant_id\` text NOT NULL,
	\`message\` text NOT NULL,
	\`is_public\` integer DEFAULT true,
	\`created_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`user_birthdays\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`tenant_id\` text NOT NULL,
	\`birthday\` integer NOT NULL,
	\`is_public\` integer,
	\`timezone\` text,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`user_files\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`filename\` text NOT NULL,
	\`original_name\` text NOT NULL,
	\`content_type\` text NOT NULL,
	\`size\` integer NOT NULL,
	\`r2_key\` text NOT NULL,
	\`uploaded_at\` integer NOT NULL,
	\`category\` text,
	\`is_public\` integer,
	\`description\` text,
);

--> statement-breakpoint
DROP TABLE \`user_files\`;
--> statement-breakpoint
DROP TABLE \`birthday_wishs\`;
--> statement-breakpoint
INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (1, 'a901041488d9d033d10c6219611972caccf5bf284170291300705452addcfb36', 1756653909271);
--> statement-breakpoint
INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (2, '957aabc4d6ac887f534a908531f5eb82e087bac36706380bea0d94680e58515c', 1756655610475);
--> statement-breakpoint
INSERT INTO "__drizzle_migrations" (id, hash, created_at) VALUES (3, '6e759a31547919d3bf59f447c164bd5ac0365d3cc94b2a1ac7ed155f20343939', 1756657243301);`;
