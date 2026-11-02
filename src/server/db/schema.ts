// drizzle のスキーマ。D1 と better-sqlite3 のどちらでも使えるよう、drizzle-orm/sqlite-core だけを使う。
// 守ること: 家族が語ったこと（誰が、いつ）と、Claude の推測は、別の列か別の表に分けて持つ。
// 推測の表・列は名前で分かるようにし（guessed_*、origin = 'guessed'）、model と prompt_version を必ず付ける。
// ID は crypto.randomUUID()、時刻は UTC のミリ秒、「その日」は日本時間の YYYY-MM-DD。
import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const families = sqliteTable(
  "families",
  {
    id: text("id").primaryKey(),
    name: text("name"), // 家族の呼び名。ログに出さない
    isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
    // 時計。null なら本当の日本時間で動く。両方 null か、両方あるか
    clockDate: text("clock_date"),
    clockSlot: text("clock_slot", { enum: ["morning", "noon", "night"] }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [check("families_clock_pair", sql`(${t.clockDate} IS NULL) = (${t.clockSlot} IS NULL)`)],
);

export const inviteLinks = sqliteTable(
  "invite_links",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    tokenHash: text("token_hash").notNull().unique(), // 合言葉の SHA-256。平文は持たない
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  // 有効な合言葉は家族ごとに一つ
  (t) => [uniqueIndex("invite_links_one_active").on(t.familyId).where(sql`${t.revokedAt} IS NULL`)],
);

export const members = sqliteTable(
  "members",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    role: text("role", { enum: ["elder", "family"] }).notNull(),
    relation: text("relation").notNull(),
    calledAs: text("called_as").notNull(),
    speechStyle: text("speech_style", { enum: ["standard", "dialect"] }).notNull(),
    dialectRegion: text("dialect_region"),
    setUpByMemberId: text("set_up_by_member_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("members_family").on(t.familyId)],
);

export const photos = sqliteTable(
  "photos",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    ownerMemberId: text("owner_member_id").notNull().references(() => members.id),
    storageKey: text("storage_key").notNull(),
    contentHash: text("content_hash").notNull(), // 縮小の前の元ファイルの SHA-256
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    takenAt: text("taken_at"), // 日本時間とみなした YYYY-MM-DDTHH:mm:ss
    latitude: real("latitude"), // 小数第 2 位に丸めた値だけ
    longitude: real("longitude"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("photos_owner_hash").on(t.ownerMemberId, t.contentHash),
    index("photos_family").on(t.familyId),
  ],
);

/** Claude による写っている内容の説明（推測）。家族には見せない。 */
export const photoGuesses = sqliteTable("photo_guesses", {
  id: text("id").primaryKey(),
  photoId: text("photo_id").notNull().references(() => photos.id),
  familyId: text("family_id").notNull().references(() => families.id),
  description: text("description").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const narrations = sqliteTable(
  "narrations",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    speakerMemberId: text("speaker_member_id").notNull().references(() => members.id),
    photoId: text("photo_id").notNull().references(() => photos.id),
    entranceId: text("entrance_id").references(() => entrances.id),
    replyToId: text("reply_to_id"),
    // 再送を一つにまとめるための、クライアントが語り一つごとに作る ID
    requestId: text("request_id"),
    kind: text("kind", { enum: ["voice", "text"] }).notNull(),
    audioKey: text("audio_key"),
    audioContentType: text("audio_content_type"),
    durationMs: integer("duration_ms"),
    transcript: text("transcript"), // 文字起こしそのまま（text のときは打った文字）
    transcriptStatus: text("transcript_status", { enum: ["pending", "done", "failed"] }).notNull(),
    // 以下は Claude が整えたもの（推測の側）
    cleanedText: text("cleaned_text"),
    cleanedModel: text("cleaned_model"),
    cleanedPromptVersion: text("cleaned_prompt_version"),
    uncertainSpans: text("uncertain_spans", { mode: "json" }).$type<{ start: number; end: number }[]>(),
    forDate: text("for_date").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("narrations_photo").on(t.familyId, t.photoId),
    uniqueIndex("narrations_request").on(t.familyId, t.requestId),
    check("narrations_voice_audio", sql`${t.kind} <> 'voice' OR ${t.audioKey} IS NOT NULL`),
    check(
      "narrations_cleaned_origin",
      sql`${t.cleanedText} IS NULL OR (${t.cleanedModel} IS NOT NULL AND ${t.cleanedPromptVersion} IS NOT NULL)`,
    ),
  ],
);

/** 記録（人・場所・時期・出来事）。家族が語ったもの（told）と Claude の推測（guessed）を origin で分ける。 */
export const records = sqliteTable(
  "records",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    photoId: text("photo_id").references(() => photos.id),
    kind: text("kind", { enum: ["person", "place", "time", "event"] }).notNull(),
    value: text("value").notNull(),
    origin: text("origin", { enum: ["told", "guessed"] }).notNull(),
    toldByMemberId: text("told_by_member_id").references(() => members.id),
    narrationId: text("narration_id").references(() => narrations.id),
    quoteStart: integer("quote_start"),
    quoteEnd: integer("quote_end"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "records_origin",
      sql`(${t.origin} = 'told' AND ${t.toldByMemberId} IS NOT NULL AND ${t.narrationId} IS NOT NULL AND ${t.model} IS NULL)
       OR (${t.origin} = 'guessed' AND ${t.model} IS NOT NULL AND ${t.promptVersion} IS NOT NULL)`,
    ),
  ],
);

/** むすび（同じ出来事のまとまり）。 */
export const musubi = sqliteTable(
  "musubi",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    createdBy: text("created_by", { enum: ["guessed", "family"] }).notNull(),
    guessedReason: text("guessed_reason"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    check(
      "musubi_origin",
      sql`${t.createdBy} <> 'guessed' OR (${t.model} IS NOT NULL AND ${t.promptVersion} IS NOT NULL)`,
    ),
  ],
);

export const musubiPhotos = sqliteTable(
  "musubi_photos",
  {
    musubiId: text("musubi_id").notNull().references(() => musubi.id),
    photoId: text("photo_id").notNull().references(() => photos.id),
    familyId: text("family_id").notNull().references(() => families.id),
    status: text("status", { enum: ["guessed", "confirmed", "rejected"] }).notNull(),
    evidenceNarrationId: text("evidence_narration_id").references(() => narrations.id),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.musubiId, t.photoId] }),
    check("musubi_photos_evidence", sql`${t.status} = 'guessed' OR ${t.evidenceNarrationId} IS NOT NULL`),
  ],
);

export const entrances = sqliteTable(
  "entrances",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull().references(() => families.id),
    memberId: text("member_id").notNull().references(() => members.id),
    forDate: text("for_date").notNull(),
    photoId: text("photo_id").notNull().references(() => photos.id),
    focus: text("focus", { mode: "json" }).$type<{ x: number; y: number; w: number; h: number }>(),
    quoteNarrationId: text("quote_narration_id"),
    quoteStart: integer("quote_start"), // null なら全文
    quoteEnd: integer("quote_end"),
    question: text("question"), // Claude の言葉。kind = 'claude' のとき必須
    reason: text("reason"), // Claude。家族に見せない
    kind: text("kind", { enum: ["claude", "fixed"] }).notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputNarrationIds: text("input_narration_ids", { mode: "json" }).$type<string[]>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    shownAt: integer("shown_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("entrances_member_date").on(t.memberId, t.forDate),
    check(
      "entrances_kind",
      sql`(${t.kind} = 'fixed' AND ${t.question} IS NULL AND ${t.model} IS NULL)
       OR (${t.kind} = 'claude' AND ${t.question} IS NOT NULL AND ${t.model} IS NOT NULL AND ${t.promptVersion} IS NOT NULL)`,
    ),
  ],
);
