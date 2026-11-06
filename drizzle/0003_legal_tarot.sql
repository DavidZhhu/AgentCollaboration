CREATE TABLE `worker_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `worker_id` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `worker_seen` integer;--> statement-breakpoint
ALTER TABLE `agents` ADD `worker_status` text DEFAULT 'stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `worker_error` text DEFAULT '' NOT NULL;