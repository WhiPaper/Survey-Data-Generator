CREATE TABLE `target_drafts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`draft_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
