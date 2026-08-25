CREATE TABLE `agent_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	`actor` text DEFAULT 'agent' NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`detail` text
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`agent_suggest_default` integer DEFAULT 0 NOT NULL,
	`summary_presets` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`ext` text DEFAULT '' NOT NULL,
	`mime_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`kind` text DEFAULT 'file' NOT NULL,
	`path` text NOT NULL,
	`thumb_path` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`parent_id` text,
	`parent_depth` integer GENERATED ALWAYS AS (depth - 1) VIRTUAL,
	`description` text,
	`color` text,
	`view_mode` text DEFAULT 'list' NOT NULL,
	`system_key` text,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`,`parent_depth`) REFERENCES `groups`(`id`,`depth`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "groups_depth_ck" CHECK(depth in (0, 1)),
	CONSTRAINT "groups_root_ck" CHECK((depth = 0) = (parent_id is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_id_depth_uq` ON `groups` (`id`,`depth`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_system_uq` ON `groups` (`system_key`);--> statement-breakpoint
CREATE INDEX `groups_parent_idx` ON `groups` (`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `login_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	`type` text NOT NULL,
	`success` integer DEFAULT 0 NOT NULL,
	`user_agent` text
);
--> statement-breakpoint
CREATE TABLE `paper_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`paper_id` text NOT NULL,
	`page` integer DEFAULT 1 NOT NULL,
	`anchor` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_notes_paper_idx` ON `paper_notes` (`paper_id`,`page`);--> statement-breakpoint
CREATE TABLE `paper_summaries` (
	`paper_id` text PRIMARY KEY NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'human' NOT NULL,
	`instruction` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`file_id` text,
	`title` text NOT NULL,
	`authors` text,
	`venue` text,
	`year` integer,
	`doi` text,
	`arxiv_id` text,
	`abstract` text,
	`tags` text,
	`url` text,
	`read_state` text DEFAULT 'unread' NOT NULL,
	`mark` text,
	`position` integer DEFAULT 0 NOT NULL,
	`head_text` text,
	`head_text_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `papers_group_idx` ON `papers` (`group_id`,`position`);--> statement-breakpoint
CREATE INDEX `papers_doi_idx` ON `papers` (`doi`);--> statement-breakpoint
CREATE INDEX `papers_arxiv_idx` ON `papers` (`arxiv_id`);--> statement-breakpoint
CREATE TABLE `trash` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`group_id` text,
	`payload` text NOT NULL,
	`deleted_at` integer DEFAULT (unixepoch()) NOT NULL
);
