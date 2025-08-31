ALTER TABLE `tenants` ADD `last_migrated_at` integer;--> statement-breakpoint
ALTER TABLE `tenants` DROP COLUMN `last_migration_version`;--> statement-breakpoint
ALTER TABLE `tenants` DROP COLUMN `migration_history`;