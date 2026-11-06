CREATE TABLE `setup_checks` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `setup_grants` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`provider` text NOT NULL,
	`session_mode` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`folder` text NOT NULL,
	`clone_repo` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `account_id` text REFERENCES accounts(id);