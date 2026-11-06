CREATE TABLE `github_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`generation` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_project_activity` ON `github_activity` (`project_id`,`generation`,`created_at`);--> statement-breakpoint
CREATE TABLE `github_connections` (
	`project_id` text PRIMARY KEY NOT NULL,
	`generation` text NOT NULL,
	`repository_id` integer NOT NULL,
	`installation_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`snapshot` text,
	`version` integer DEFAULT 1 NOT NULL,
	`synced_version` integer DEFAULT 0 NOT NULL,
	`last_sync` integer,
	`last_webhook` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`retry_at` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_repository_installation` ON `github_connections` (`repository_id`,`installation_id`);--> statement-breakpoint
CREATE TABLE `github_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_project_members` (
	`project_id` text NOT NULL,
	`account_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `account_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
