CREATE TABLE `record_extractions` (
	`narration_id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text,
	`state` text NOT NULL,
	`attempts` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`narration_id`) REFERENCES `narrations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `record_extractions_family` ON `record_extractions` (`family_id`);