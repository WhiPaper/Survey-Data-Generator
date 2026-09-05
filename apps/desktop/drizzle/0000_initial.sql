CREATE TABLE `form_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`google_form_id` text NOT NULL,
	`title` text NOT NULL,
	`schema_json` text NOT NULL,
	`schema_hash` text NOT NULL,
	`captured_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_snapshots_project_idx` ON `form_snapshots` (`project_id`);--> statement-breakpoint
CREATE TABLE `google_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_accounts_email_unique` ON `google_accounts` (`email`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`google_account_id` text,
	`google_form_id` text NOT NULL,
	`current_source_revision_id` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`google_account_id`) REFERENCES `google_accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `projects_google_account_idx` ON `projects` (`google_account_id`);--> statement-breakpoint
CREATE TABLE `source_responses` (
	`revision_id` text NOT NULL,
	`response_id` text NOT NULL,
	`submitted_at_ms` integer NOT NULL,
	`response_json` text NOT NULL,
	PRIMARY KEY(`revision_id`, `response_id`),
	FOREIGN KEY (`revision_id`) REFERENCES `source_revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `source_responses_revision_submitted_idx` ON `source_responses` (`revision_id`,`submitted_at_ms`);--> statement-breakpoint
CREATE TABLE `source_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_snapshot_id` text NOT NULL,
	`response_count` integer NOT NULL,
	`response_set_hash` text NOT NULL,
	`imported_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_snapshot_id`) REFERENCES `form_snapshots`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `source_revisions_project_idx` ON `source_revisions` (`project_id`);--> statement-breakpoint
CREATE INDEX `source_revisions_project_hash_idx` ON `source_revisions` (`project_id`,`response_set_hash`);