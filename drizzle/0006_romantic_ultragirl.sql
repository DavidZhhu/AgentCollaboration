ALTER TABLE `agents` ADD `connection_mode` text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `controller_label` text DEFAULT '' NOT NULL;