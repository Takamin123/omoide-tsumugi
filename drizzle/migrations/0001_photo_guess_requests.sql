CREATE TABLE `photo_guess_requests` (
	`photo_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`family_id` text NOT NULL,
	`state` text NOT NULL,
	`batch_id` text,
	`attempts` integer NOT NULL,
	`claimed_at` integer NOT NULL,
	PRIMARY KEY(`photo_id`, `prompt_version`),
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photo_guess_requests_batch` ON `photo_guess_requests` (`batch_id`);--> statement-breakpoint
CREATE INDEX `photo_guess_requests_family` ON `photo_guess_requests` (`family_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_guesses_photo_version` ON `photo_guesses` (`photo_id`,`prompt_version`);--> statement-breakpoint
CREATE INDEX `photo_guesses_family` ON `photo_guesses` (`family_id`);