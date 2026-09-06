ALTER TABLE `runs` ADD `app_version` text NOT NULL DEFAULT '0.1.0';
--> statement-breakpoint
ALTER TABLE `runs` ADD `engine_version` integer NOT NULL DEFAULT 2;
