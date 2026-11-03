CREATE TABLE `musubi_guess_runs` (
	`family_id` text NOT NULL,
	`input_key` text NOT NULL,
	`prompt_version` text NOT NULL,
	`model` text,
	`state` text NOT NULL,
	`attempts` integer NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`family_id`, `input_key`),
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
-- むすびの推測（0044）: musubi に根拠の記録の ID を足し、musubi_photos の確定・却下を家族の手（決めた人と時刻）に縛る。
-- CHECK を変えるので表を作り直す。D1 では PRAGMA foreign_keys を切れないので、外部キーが途中で切れない順にする:
-- musubi_photos を外部キーのない一時の表に写して消す → musubi を作り直す → musubi_photos を作り直して戻す
-- （この移行の時点では、どの環境にも musubi の行はないはず。むすびを読み書きするコードがまだないため）
CREATE TABLE `__old_musubi_photos` AS SELECT * FROM `musubi_photos`;--> statement-breakpoint
DROP TABLE `musubi_photos`;--> statement-breakpoint
CREATE TABLE `__new_musubi` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`created_by` text NOT NULL,
	`guessed_reason` text,
	`guessed_evidence_record_ids` text,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "musubi_origin" CHECK("created_by" <> 'guessed' OR ("model" IS NOT NULL AND "prompt_version" IS NOT NULL AND "guessed_evidence_record_ids" IS NOT NULL))
);
--> statement-breakpoint
-- 前の形の推測（根拠の記録を持たない）は写さない
INSERT INTO `__new_musubi`("id", "family_id", "created_by", "guessed_reason", "guessed_evidence_record_ids", "model", "prompt_version", "created_at") SELECT "id", "family_id", "created_by", "guessed_reason", NULL, "model", "prompt_version", "created_at" FROM `musubi` WHERE "created_by" <> 'guessed';--> statement-breakpoint
DROP TABLE `musubi`;--> statement-breakpoint
ALTER TABLE `__new_musubi` RENAME TO `musubi`;--> statement-breakpoint
CREATE INDEX `musubi_family` ON `musubi` (`family_id`);--> statement-breakpoint
CREATE TABLE `musubi_photos` (
	`musubi_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`family_id` text NOT NULL,
	`status` text NOT NULL,
	`evidence_narration_id` text,
	`decided_by_member_id` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`musubi_id`, `photo_id`),
	FOREIGN KEY (`musubi_id`) REFERENCES `musubi`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`family_id`) REFERENCES `families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_narration_id`) REFERENCES `narrations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "musubi_photos_decided" CHECK(("status" = 'guessed' AND "decided_by_member_id" IS NULL AND "decided_at" IS NULL)
       OR ("status" <> 'guessed' AND "decided_by_member_id" IS NOT NULL AND "decided_at" IS NOT NULL))
);
--> statement-breakpoint
-- 前の形の確定・却下は根拠の語りを持っていたので、決めた人はその語り手、決めた時刻は decided_at（なければ作った時刻）とする。
-- 推測のままのものは、決めた人を持たない。写さなかったむすびの行は写さない
INSERT INTO `musubi_photos`("musubi_id", "photo_id", "family_id", "status", "evidence_narration_id", "decided_by_member_id", "decided_at", "created_at") SELECT mp."musubi_id", mp."photo_id", mp."family_id", mp."status", mp."evidence_narration_id", CASE WHEN mp."status" = 'guessed' THEN NULL ELSE n."speaker_member_id" END, CASE WHEN mp."status" = 'guessed' THEN NULL ELSE COALESCE(mp."decided_at", mp."created_at") END, mp."created_at" FROM `__old_musubi_photos` mp LEFT JOIN `narrations` n ON n."id" = mp."evidence_narration_id" WHERE (mp."status" = 'guessed' OR n."id" IS NOT NULL) AND mp."musubi_id" IN (SELECT "id" FROM `musubi`);--> statement-breakpoint
DROP TABLE `__old_musubi_photos`;--> statement-breakpoint
CREATE INDEX `musubi_photos_family` ON `musubi_photos` (`family_id`);