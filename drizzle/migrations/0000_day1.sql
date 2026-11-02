CREATE TABLE `entrances` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`member_id` text NOT NULL,
	`for_date` text NOT NULL,
	`photo_id` text NOT NULL,
	`focus` text,
	`quote_narration_id` text,
	`quote_start` integer,
	`quote_end` integer,
	`question` text,
	`reason` text,
	`kind` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`input_narration_ids` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`shown_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "entrances_kind" CHECK(("entrances"."kind" = 'fixed' AND "entrances"."question" IS NULL AND "entrances"."model" IS NULL)
       OR ("entrances"."kind" = 'claude' AND "entrances"."question" IS NOT NULL AND "entrances"."model" IS NOT NULL AND "entrances"."prompt_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entrances_member_date` ON `entrances` (`member_id`,`for_date`);--> statement-breakpoint
CREATE TABLE `families` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`is_demo` integer DEFAULT false NOT NULL,
	`clock_date` text,
	`clock_slot` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "families_clock_pair" CHECK(("families"."clock_date" IS NULL) = ("families"."clock_slot" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `invite_links` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_token_hash_unique` ON `invite_links` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_one_active` ON `invite_links` (`family_id`) WHERE "invite_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`role` text NOT NULL,
	`relation` text NOT NULL,
	`called_as` text NOT NULL,
	`speech_style` text NOT NULL,
	`dialect_region` text,
	`set_up_by_member_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `members_family` ON `members` (`family_id`);--> statement-breakpoint
CREATE TABLE `musubi` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`created_by` text NOT NULL,
	`guessed_reason` text,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "musubi_origin" CHECK("musubi"."created_by" <> 'guessed' OR ("musubi"."model" IS NOT NULL AND "musubi"."prompt_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `musubi_photos` (
	`musubi_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`family_id` text NOT NULL,
	`status` text NOT NULL,
	`evidence_narration_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`musubi_id`, `photo_id`),
	FOREIGN KEY (`musubi_id`) REFERENCES `musubi`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_narration_id`) REFERENCES `narrations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "musubi_photos_evidence" CHECK("musubi_photos"."status" = 'guessed' OR "musubi_photos"."evidence_narration_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `narrations` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`speaker_member_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`entrance_id` text,
	`reply_to_id` text,
	`request_id` text,
	`kind` text NOT NULL,
	`audio_key` text,
	`audio_content_type` text,
	`duration_ms` integer,
	`transcript` text,
	`transcript_status` text NOT NULL,
	`cleaned_text` text,
	`cleaned_model` text,
	`cleaned_prompt_version` text,
	`uncertain_spans` text,
	`for_date` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`speaker_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`entrance_id`) REFERENCES `entrances`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "narrations_voice_audio" CHECK("narrations"."kind" <> 'voice' OR "narrations"."audio_key" IS NOT NULL),
	CONSTRAINT "narrations_cleaned_origin" CHECK("narrations"."cleaned_text" IS NULL OR ("narrations"."cleaned_model" IS NOT NULL AND "narrations"."cleaned_prompt_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `narrations_photo` ON `narrations` (`family_id`,`photo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `narrations_request` ON `narrations` (`family_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `photo_guesses` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`family_id` text NOT NULL,
	`description` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`owner_member_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`taken_at` text,
	`latitude` real,
	`longitude` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photos_owner_hash` ON `photos` (`owner_member_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `photos_family` ON `photos` (`family_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`photo_id` text,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`origin` text NOT NULL,
	`told_by_member_id` text,
	`narration_id` text,
	`quote_start` integer,
	`quote_end` integer,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`told_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`narration_id`) REFERENCES `narrations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "records_origin" CHECK(("records"."origin" = 'told' AND "records"."told_by_member_id" IS NOT NULL AND "records"."narration_id" IS NOT NULL AND "records"."model" IS NULL)
       OR ("records"."origin" = 'guessed' AND "records"."model" IS NOT NULL AND "records"."prompt_version" IS NOT NULL))
);
