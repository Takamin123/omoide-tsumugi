DROP INDEX `invite_links_one_active`;--> statement-breakpoint
ALTER TABLE `invite_links` ADD `member_id` text REFERENCES members(id);--> statement-breakpoint
-- 家族単位のリンクは、すべて使えなくする（一人ずつのリンクに替える。0036）
UPDATE `invite_links` SET `revoked_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE `revoked_at` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_member_active` ON `invite_links` (`family_id`,`member_id`) WHERE "invite_links"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `invite_links_first_active` ON `invite_links` (`family_id`) WHERE "invite_links"."revoked_at" IS NULL AND "invite_links"."member_id" IS NULL;
