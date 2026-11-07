CREATE TABLE `message_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`received_at` integer,
	`responding_at` integer,
	`replied_at` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `message_deliveries_agent_idx` ON `message_deliveries` (`agent_id`,`message_id`);--> statement-breakpoint
ALTER TABLE `messages` ADD `mentions` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `author_agent_id` text REFERENCES agents(id);--> statement-breakpoint
ALTER TABLE `messages` ADD `reply_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `notification_depth` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- Preserve unread human requests without replaying historical agent chatter.
INSERT INTO message_deliveries (id,message_id,agent_id,status)
SELECT m.id || ':' || a.id,m.id,a.id,'queued'
FROM messages m JOIN agents a ON a.project_id=m.project_id
JOIN projects p ON p.id=m.project_id
WHERE m.author_type='human' AND a.deleted_at IS NULL AND p.deleted_at IS NULL
  AND m.created_at>COALESCE(a.last_seen,0)
  AND (m.channel=a.id OR (m.channel='general' AND a.role IN ('R0','Product manager')))
  AND (a.account_id IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE accounts.id=a.account_id AND accounts.enabled=1));
