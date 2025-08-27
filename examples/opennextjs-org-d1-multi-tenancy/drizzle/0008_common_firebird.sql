ALTER TABLE `tenants` ADD `last_migration_version` text DEFAULT '0000';--> statement-breakpoint
ALTER TABLE `tenants` ADD `migration_history` text DEFAULT '[]';