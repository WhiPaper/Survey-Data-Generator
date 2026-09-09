CREATE TABLE `composite_children` (
	`composite_id` text NOT NULL,
	`position` integer NOT NULL,
	`rule_id` text NOT NULL,
	`run_id` text NOT NULL,
	`count_json` text NOT NULL,
	`scope_response_count` integer NOT NULL,
	`final_response_count` integer NOT NULL,
	PRIMARY KEY(`composite_id`, `position`),
	FOREIGN KEY (`composite_id`) REFERENCES `composite_results`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `composite_children_rule_unique` ON `composite_children` (`composite_id`,`rule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `composite_children_run_unique` ON `composite_children` (`composite_id`,`run_id`);--> statement-breakpoint
CREATE INDEX `composite_children_run_idx` ON `composite_children` (`run_id`);--> statement-breakpoint
CREATE TABLE `composite_results` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_revision_id` text NOT NULL,
	`overlap_policy` text NOT NULL,
	`final_response_count` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_revision_id`) REFERENCES `source_revisions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `composite_results_project_idx` ON `composite_results` (`project_id`);--> statement-breakpoint
CREATE INDEX `composite_results_source_revision_idx` ON `composite_results` (`source_revision_id`);
