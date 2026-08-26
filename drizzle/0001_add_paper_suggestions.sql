CREATE TABLE `paper_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`kind` text DEFAULT 'biblio' NOT NULL,
	`state` text DEFAULT 'running' NOT NULL,
	`fields` text,
	`instruction` text,
	`error` text,
	`job_id` text,
	`applied_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_suggestions_paper_idx` ON `paper_suggestions` (`paper_id`,`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `papers` ADD `csl` text;
