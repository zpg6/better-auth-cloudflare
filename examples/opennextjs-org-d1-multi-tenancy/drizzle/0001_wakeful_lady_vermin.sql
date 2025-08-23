CREATE TABLE `tenant_databases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`tenant_type` text NOT NULL,
	`database_name` text NOT NULL,
	`database_id` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
