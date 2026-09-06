CREATE TABLE `run_rows` (
	`run_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`response_id` text NOT NULL,
	`submitted_at_ms` integer NOT NULL,
	`origin` text NOT NULL,
	`response_json` text NOT NULL,
	PRIMARY KEY(`run_id`, `row_index`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_rows_run_idx` ON `run_rows` (`run_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`scope_kind` text NOT NULL,
	`scope_start_ms` integer,
	`scope_end_ms` integer,
	`scope_response_count` integer NOT NULL,
	`scope_response_set_hash` text NOT NULL,
	`final_response_count` integer NOT NULL,
	`target_json` text NOT NULL,
	`seed` integer NOT NULL,
	`engine_report_json` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_revision_id`) REFERENCES `source_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `runs_project_idx` ON `runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `runs_source_revision_idx` ON `runs` (`source_revision_id`);--> statement-breakpoint
CREATE TABLE `value_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`question_id` text NOT NULL,
	`name` text NOT NULL,
	`members_json` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `value_groups_project_idx` ON `value_groups` (`project_id`);