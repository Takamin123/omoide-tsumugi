// リポジトリの実装。drizzle の SQLite 共通の書き方だけを使い、D1 でも better-sqlite3（VPS）でも同じものを使う。
// 実行環境ごとに違うのは「drizzle のデータベース」と「いくつかの文を一度に行う方法」だけで、入り口の層が渡す。
// - D1: db.batch()（対話的なトランザクションは使えない）
// - better-sqlite3: db.transaction() の中で順に run する
import { and, asc, desc, eq, exists, gte, inArray, isNotNull, isNull, lt, ne, notExists, or, sql, type SQLWrapper } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import { alias, type BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { DEMO_RESET_TABLES } from "../core/ports";
import type {
  ClaimOpts,
  DemoResetTable,
  EntranceRow,
  FamilyLinkRequest,
  FamilyRow,
  MemberRow,
  MusubiGuessAttempt,
  MusubiGuessRunRow,
  MusubiRow,
  NarrationRow,
  OpsEntranceRow,
  PhotoGuessRow,
  PhotoRow,
  RecordExtractionAttempt,
  RecordExtractionRow,
  RecordRow,
  Repositories,
  UncertainSpan,
} from "../core/ports";
import * as schema from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteDb = BaseSQLiteDatabase<"async" | "sync", any, typeof schema>;
export type BatchItem = DrizzleBatchItem<"sqlite">;
/** いくつかの書き込みを、すべて行うか、どれも行わないかで行う。 */
export type RunBatch = (items: [BatchItem, ...BatchItem[]]) => Promise<void>;

const { families, inviteLinks, members, photos, narrations, entrances, photoGuesses, photoGuessRequests, records, recordExtractions, musubi, musubiPhotos, musubiGuessRuns } =
  schema;

/** デモの初期化で消す表（名前 → drizzle の表）。DEMO_RESET_TABLES の順に消す */
const demoTables = {
  records: schema.records,
  record_extractions: schema.recordExtractions,
  musubi_photos: schema.musubiPhotos,
  musubi: schema.musubi,
  musubi_guess_runs: schema.musubiGuessRuns,
  photo_guess_requests: schema.photoGuessRequests,
  photo_guesses: schema.photoGuesses,
  narrations: schema.narrations,
  entrances: schema.entrances,
  photos: schema.photos,
} as const satisfies Record<DemoResetTable, unknown>;

type FamilyRecord = typeof families.$inferSelect;
const toFamily = (r: FamilyRecord): FamilyRow => ({
  id: r.id,
  name: r.name,
  isDemo: r.isDemo,
  clock: r.clockDate && r.clockSlot ? { date: r.clockDate, slot: r.clockSlot } : null,
  createdAt: r.createdAt,
});

type NarrationRecord = typeof narrations.$inferSelect;
const toNarration = (r: NarrationRecord): NarrationRow => ({
  id: r.id,
  familyId: r.familyId,
  speakerMemberId: r.speakerMemberId,
  photoId: r.photoId,
  entranceId: r.entranceId,
  replyToId: r.replyToId,
  requestId: r.requestId,
  kind: r.kind,
  audioKey: r.audioKey,
  audioContentType: r.audioContentType,
  durationMs: r.durationMs,
  transcript: r.transcript,
  transcriptStatus: r.transcriptStatus,
  cleanedText: r.cleanedText,
  cleanedModel: r.cleanedModel,
  cleanedPromptVersion: r.cleanedPromptVersion,
  uncertainSpans: parseSpans(r.uncertainSpans),
  forDate: r.forDate,
  createdAt: r.createdAt,
});

/** 印の範囲を読む。形が合わなければ null（表示は transcript に倒れる。範囲そのものの確かめは表示の側でも行う） */
function parseSpans(raw: string | null): UncertainSpan[] | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const spans: UncertainSpan[] = [];
  for (const s of v) {
    if (typeof s !== "object" || s === null) return null;
    const { start, end } = s as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number") return null;
    spans.push({ start, end });
  }
  return spans;
}

type EntranceRecord = typeof entrances.$inferSelect;
const toEntrance = (r: EntranceRecord): EntranceRow => ({
  id: r.id,
  familyId: r.familyId,
  memberId: r.memberId,
  forDate: r.forDate,
  photoId: r.photoId,
  focus: r.focus,
  quoteNarrationId: r.quoteNarrationId,
  quoteStart: r.quoteStart,
  quoteEnd: r.quoteEnd,
  question: r.question,
  kind: r.kind,
  reason: r.reason,
  model: r.model,
  promptVersion: r.promptVersion,
  inputNarrationIds: r.inputNarrationIds,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  inputMusubiIds: r.inputMusubiIds,
  receiverPresent: r.receiverPresent,
  questionAudioKey: r.questionAudioKey,
  questionAudioModel: r.questionAudioModel,
  questionAudioVoice: r.questionAudioVoice,
  shownAt: r.shownAt,
  createdAt: r.createdAt,
});

/** 取り直してよい作業の記録: 失敗で回数が上限に届いていないもの、または古いまま残っているもの（途中で落ちた処理、回収できなかった Batch） */
function claimable(req: typeof schema.photoGuessRequests, o: ClaimOpts) {
  // どの場合も、試した回数の上限は越えない（落ち続ける写真で Claude を呼び続けない）
  return and(
    lt(req.attempts, o.maxAttempts),
    or(
      // 失敗したものは、取ってから少し待ってから（一時的な障害の間に、続く登録で回数を使い切らないように）
      and(eq(req.state, "failed"), lt(req.claimedAt, o.staleBefore)),
      and(eq(req.state, "working"), isNull(req.batchId), lt(req.claimedAt, o.staleBefore)),
      // Batch に入れたまま回収できなかったもの（Batch の期限 24 時間の外側）
      and(eq(req.state, "working"), isNotNull(req.batchId), lt(req.claimedAt, o.batchStaleBefore)),
    ),
  );
}

/** 書き込みの結果から、変わった行の数を取り出す（D1 は meta.changes、better-sqlite3 は changes）。 */
function changes(result: unknown): number {
  const r = result as { changes?: number; meta?: { changes?: number } };
  return r.meta?.changes ?? r.changes ?? 0;
}

export function createSqlRepositories(db: SqliteDb, runBatch: RunBatch): Repositories {
  /**
   * 作業の行を入れる select。語りがその家族のものであるときだけ一行になる（ほかの家族の語りに作業の行を付けない）。
   */
  const extractionSelect = (attempt: RecordExtractionAttempt, state: "done" | "failed") => {
    const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
    return db
      .select({
        narrationId: narrations.id,
        familyId: narrations.familyId,
        promptVersion: v(attempt.promptVersion, "promptVersion"),
        model: v(attempt.model, "model"),
        state: v(state, "state"),
        attempts: v(1, "attempts"),
        inputTokens: v(attempt.inputTokens, "inputTokens"),
        outputTokens: v(attempt.outputTokens, "outputTokens"),
        createdAt: v(attempt.createdAt, "createdAt"),
      })
      .from(narrations)
      .where(and(eq(narrations.id, attempt.narrationId), eq(narrations.familyId, attempt.familyId)));
  };
  const runSelect = (attempt: MusubiGuessAttempt, state: "done" | "failed") => {
    const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
    return db
      .select({
        familyId: families.id,
        inputKey: v(attempt.inputKey, "inputKey"),
        promptVersion: v(attempt.promptVersion, "promptVersion"),
        model: v(attempt.model, "model"),
        state: v(state, "state"),
        attempts: v(1, "attempts"),
        inputTokens: v(attempt.inputTokens, "inputTokens"),
        outputTokens: v(attempt.outputTokens, "outputTokens"),
        createdAt: v(attempt.createdAt, "createdAt"),
      })
      .from(families)
      .where(eq(families.id, attempt.familyId));
  };
  /** その家族の、写真 X がいる家族の手のむすびのうち、いちばん古いもの（SQL の部分。0048） */
  const familyMusubiWith = (familyId: string, photoId: string) =>
    db
      .select({ id: musubi.id })
      .from(musubi)
      .innerJoin(musubiPhotos, eq(musubiPhotos.musubiId, musubi.id))
      .where(
        and(
          eq(musubi.familyId, familyId),
          eq(musubi.createdBy, "family"),
          eq(musubiPhotos.familyId, familyId),
          eq(musubiPhotos.photoId, photoId),
        ),
      )
      .orderBy(asc(musubi.createdAt), asc(musubi.id))
      .limit(1);
  /** X と Z が両方いる家族の手のむすび（いちばん古いもの） */
  const sharedFamilyMusubi = async (familyId: string, xId: string, zId: string): Promise<string | null> => {
    const mpX = alias(musubiPhotos, "mp_x");
    const mpZ = alias(musubiPhotos, "mp_z");
    const r = await db
      .select({ id: musubi.id })
      .from(musubi)
      .innerJoin(mpX, and(eq(mpX.musubiId, musubi.id), eq(mpX.photoId, xId), eq(mpX.familyId, familyId)))
      .innerJoin(mpZ, and(eq(mpZ.musubiId, musubi.id), eq(mpZ.photoId, zId), eq(mpZ.familyId, familyId)))
      .where(and(eq(musubi.familyId, familyId), eq(musubi.createdBy, "family")))
      .orderBy(asc(musubi.createdAt), asc(musubi.id))
      .limit(1)
      .get();
    return r?.id ?? null;
  };
  /**
   * 家族の手のむすびに X と Z を入れる文（0048）。順に:
   * 1. X がまだ家族のむすびにいなければ、新しいむすびを作る（X と Z が両方その家族の写真のときだけ）
   * 2. 入れる先 = X のいる家族のむすびのいちばん古いもの、なければ 1 で作ったもの
   * 3. X と Z を confirmed で入れる（既にいれば何もしない）。推測のむすびには触らない
   */
  const familyLinkItems = (req: FamilyLinkRequest): BatchItem[] => {
    const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
    const photoIn = (id: string) =>
      exists(db.select({ one: sql`1` }).from(photos).where(and(eq(photos.id, id), eq(photos.familyId, req.familyId))));
    const target = () =>
      sql<string>`coalesce((${familyMusubiWith(req.familyId, req.withPhotoId)}), (${db
        .select({ id: musubi.id })
        .from(musubi)
        .where(and(eq(musubi.id, req.newMusubiId), eq(musubi.familyId, req.familyId), eq(musubi.createdBy, "family")))}))`;
    const addRow = (photoId: string) =>
      db
        .insert(musubiPhotos)
        .select(
          db
            .select({
              musubiId: target().as("musubiId"),
              photoId: photos.id,
              familyId: photos.familyId,
              status: v("confirmed", "status"),
              evidenceNarrationId: v<string | null>(null, "evidenceNarrationId"),
              decidedByMemberId: v(req.memberId, "decidedByMemberId"),
              decidedAt: v(req.now, "decidedAt"),
              createdAt: v(req.now, "createdAt"),
            })
            .from(photos)
            .where(and(eq(photos.id, photoId), eq(photos.familyId, req.familyId), sql`${target()} IS NOT NULL`)),
        )
        .onConflictDoNothing() as unknown as BatchItem;
    return [
      db.insert(musubi).select(
        db
          .select({
            id: v(req.newMusubiId, "id"),
            familyId: families.id,
            createdBy: v("family", "createdBy"),
            guessedReason: v<string | null>(null, "guessedReason"),
            guessedEvidenceRecordIds: v<string | null>(null, "guessedEvidenceRecordIds"),
            model: v<string | null>(null, "model"),
            promptVersion: v<string | null>(null, "promptVersion"),
            createdAt: v(req.now, "createdAt"),
          })
          .from(families)
          .where(
            and(
              eq(families.id, req.familyId),
              photoIn(req.withPhotoId),
              photoIn(req.photoId),
              notExists(familyMusubiWith(req.familyId, req.withPhotoId)),
            ),
          ),
      ) as unknown as BatchItem,
      addRow(req.withPhotoId),
      addRow(req.photoId),
    ];
  };
  return {
    families: {
      async create(family, firstLink, now) {
        await runBatch([
          db.insert(families).values({
            id: family.id,
            name: family.name,
            isDemo: family.isDemo,
            clockDate: family.clock?.date ?? null,
            clockSlot: family.clock?.slot ?? null,
            createdAt: now,
          }),
          db.insert(inviteLinks).values({ id: firstLink.id, familyId: family.id, tokenHash: firstLink.tokenHash, memberId: null, createdAt: now }),
        ]);
      },
      async get(familyId) {
        const r = await db.select().from(families).where(eq(families.id, familyId)).get();
        return r ? toFamily(r) : null;
      },
      async findActiveLink(tokenHash) {
        const r = await db
          .select({ family: families, member: members, memberId: inviteLinks.memberId })
          .from(inviteLinks)
          .innerJoin(families, eq(families.id, inviteLinks.familyId))
          .leftJoin(members, and(eq(members.id, inviteLinks.memberId), eq(members.familyId, inviteLinks.familyId)))
          .where(and(eq(inviteLinks.tokenHash, tokenHash), isNull(inviteLinks.revokedAt)))
          .get();
        if (!r) return null;
        // 人を指すリンクなのに、その家族の人が引けない: 使えないリンクとみなす（閉じる側）
        if (r.memberId !== null && !r.member) return null;
        return { family: toFamily(r.family), member: (r.member as MemberRow | null) ?? null };
      },
      async setClock(familyId, clock) {
        await db.update(families).set({ clockDate: clock.date, clockSlot: clock.slot }).where(eq(families.id, familyId));
      },
      async listIdsWithoutClock() {
        const rows = await db.select({ id: families.id }).from(families).where(isNull(families.clockDate)).all();
        return rows.map((r) => r.id);
      },
    },

    members: {
      async list(familyId) {
        return (await db
          .select()
          .from(members)
          .where(eq(members.familyId, familyId))
          .orderBy(asc(members.createdAt), asc(members.id))
          .all()) as MemberRow[];
      },
      async get(familyId, memberId) {
        const r = await db
          .select()
          .from(members)
          .where(and(eq(members.familyId, familyId), eq(members.id, memberId)))
          .get();
        return (r as MemberRow | undefined) ?? null;
      },
      async create(row) {
        await db.insert(members).values(row);
      },
      async update(familyId, memberId, fields) {
        // 祖父母の画面に変えるときは、ほかに家族の画面の人が残るときだけ直す（一つの文で確かめて直す）
        const others = alias(members, "others");
        const keepsFamily =
          fields.role === "family"
            ? undefined
            : exists(
                db
                  .select({ one: sql`1` })
                  .from(others)
                  .where(and(eq(others.familyId, familyId), eq(others.role, "family"), ne(others.id, memberId))),
              );
        const res = await db
          .update(members)
          .set(fields)
          .where(and(eq(members.familyId, familyId), eq(members.id, memberId), keepsFamily));
        if (changes(res) === 0) return (await this.get(familyId, memberId)) ? "no_family_left" : null;
        return this.get(familyId, memberId);
      },
      async addFirst(row, link, now) {
        // 定数の列（insert ... select に使う。名前は表の列に合わせる）
        const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
        await runBatch([
          // 家族に人がまだいないときだけ入れる（二つの端末が同時に最初の人になろうとしても、一人だけ）
          db.insert(members).select(
            db
              .select({
                id: v(row.id, "id"),
                familyId: families.id,
                role: v(row.role, "role"),
                relation: v(row.relation, "relation"),
                calledAs: v(row.calledAs, "calledAs"),
                speechStyle: v(row.speechStyle, "speechStyle"),
                dialectRegion: v(row.dialectRegion, "dialectRegion"),
                setUpByMemberId: v(row.setUpByMemberId, "setUpByMemberId"),
                createdAt: v(row.createdAt, "createdAt"),
              })
              .from(families)
              .where(
                and(
                  eq(families.id, row.familyId),
                  notExists(db.select({ one: sql`1` }).from(members).where(eq(members.familyId, row.familyId))),
                ),
              ),
          ),
          // その人のリンク。人が入ったときだけ
          db.insert(inviteLinks).select(
            db
              .select({
                id: v(link.id, "id"),
                familyId: members.familyId,
                tokenHash: v(link.tokenHash, "tokenHash"),
                memberId: members.id,
                createdAt: v(now, "createdAt"),
                revokedAt: v<number | null>(null, "revokedAt"),
              })
              .from(members)
              .where(and(eq(members.id, row.id), eq(members.familyId, row.familyId))),
          ),
          // 最初の人のリンクは一度きり
          db
            .update(inviteLinks)
            .set({ revokedAt: now })
            .where(and(eq(inviteLinks.familyId, row.familyId), isNull(inviteLinks.memberId), isNull(inviteLinks.revokedAt))),
        ]);
        return (await this.get(row.familyId, row.id)) !== null;
      },
      async replaceLink(familyId, memberId, link, now) {
        await runBatch([
          db
            .update(inviteLinks)
            .set({ revokedAt: now })
            .where(and(eq(inviteLinks.familyId, familyId), eq(inviteLinks.memberId, memberId), isNull(inviteLinks.revokedAt))),
          db.insert(inviteLinks).values({ id: link.id, familyId, tokenHash: link.tokenHash, memberId, createdAt: now }),
        ]);
      },
      async listIdsWithActiveLink(familyId) {
        const rows = await db
          .selectDistinct({ memberId: inviteLinks.memberId })
          .from(inviteLinks)
          .where(and(eq(inviteLinks.familyId, familyId), isNull(inviteLinks.revokedAt), isNotNull(inviteLinks.memberId)))
          .all();
        return rows.flatMap((r) => (r.memberId ? [r.memberId] : []));
      },
    },

    photos: {
      async findByOwnerHash(familyId, ownerMemberId, contentHash) {
        const r = await db
          .select()
          .from(photos)
          .where(
            and(eq(photos.familyId, familyId), eq(photos.ownerMemberId, ownerMemberId), eq(photos.contentHash, contentHash)),
          )
          .get();
        return (r as PhotoRow | undefined) ?? null;
      },
      async insertIfAbsent(row) {
        const res = await db.insert(photos).values(row).onConflictDoNothing({ target: [photos.ownerMemberId, photos.contentHash] });
        return changes(res) > 0;
      },
      async get(familyId, photoId) {
        const r = await db
          .select()
          .from(photos)
          .where(and(eq(photos.familyId, familyId), eq(photos.id, photoId)))
          .get();
        return (r as PhotoRow | undefined) ?? null;
      },
      async list(familyId, ownerMemberId) {
        const where = ownerMemberId
          ? and(eq(photos.familyId, familyId), eq(photos.ownerMemberId, ownerMemberId))
          : eq(photos.familyId, familyId);
        return (await db.select().from(photos).where(where).orderBy(asc(photos.createdAt), asc(photos.id)).all()) as PhotoRow[];
      },
      async countByOwner(familyId) {
        const rows = await db
          .select({ ownerMemberId: photos.ownerMemberId, n: sql<number>`count(*)` })
          .from(photos)
          .where(eq(photos.familyId, familyId))
          .groupBy(photos.ownerMemberId)
          .all();
        return new Map(rows.map((r) => [r.ownerMemberId, Number(r.n)]));
      },
    },

    narrations: {
      async insertIfAbsent(row) {
        const res = await db.insert(narrations).values(row).onConflictDoNothing({ target: [narrations.familyId, narrations.requestId] });
        return changes(res) > 0;
      },
      async get(familyId, narrationId) {
        const r = await db
          .select()
          .from(narrations)
          .where(and(eq(narrations.familyId, familyId), eq(narrations.id, narrationId)))
          .get();
        return r ? toNarration(r) : null;
      },
      async findByRequestId(familyId, requestId) {
        const r = await db
          .select()
          .from(narrations)
          .where(and(eq(narrations.familyId, familyId), eq(narrations.requestId, requestId)))
          .get();
        return r ? toNarration(r) : null;
      },
      async listByPhoto(familyId, photoId) {
        const rows = await db
          .select()
          .from(narrations)
          .where(and(eq(narrations.familyId, familyId), eq(narrations.photoId, photoId)))
          .orderBy(asc(narrations.createdAt), asc(narrations.id))
          .all();
        return rows.map(toNarration);
      },
      async listAll(familyId) {
        const rows = await db
          .select()
          .from(narrations)
          .where(eq(narrations.familyId, familyId))
          .orderBy(asc(narrations.createdAt), asc(narrations.id))
          .all();
        return rows.map(toNarration);
      },
      async setTranscript(familyId, narrationId, status, transcript) {
        await db
          .update(narrations)
          .set({ transcriptStatus: status, transcript })
          .where(
            and(eq(narrations.familyId, familyId), eq(narrations.id, narrationId), eq(narrations.transcriptStatus, "pending")),
          );
      },
      async setCleaned(familyId, narrationId, cleaned) {
        const res = await db
          .update(narrations)
          .set({
            cleanedText: cleaned.cleanedText,
            cleanedModel: cleaned.cleanedModel,
            cleanedPromptVersion: cleaned.cleanedPromptVersion,
            uncertainSpans: JSON.stringify(cleaned.uncertainSpans),
          })
          .where(
            and(
              eq(narrations.familyId, familyId),
              eq(narrations.id, narrationId),
              eq(narrations.kind, "voice"),
              eq(narrations.transcriptStatus, "done"),
              isNull(narrations.cleanedText),
            ),
          );
        return changes(res) > 0;
      },
      async deleteForRetake(familyId, narrationId, speakerMemberId, createdSince) {
        const one = { one: sql`1` };
        const replies = alias(narrations, "retake_replies");
        // 入り口の入力（JSON の配列）。壊れた値は空として読む（json_each を失敗させない）
        const inputs = sql`${entrances}, json_each(CASE WHEN json_valid(${entrances.inputNarrationIds}) THEN ${entrances.inputNarrationIds} ELSE '[]' END) AS retake_input`;
        // 外部キーで指している表（records・record_extractions・musubi_photos）は家族で絞らない（どの行が指していても消すと違反になる）
        const rows = await db
          .delete(narrations)
          .where(
            and(
              eq(narrations.familyId, familyId),
              eq(narrations.id, narrationId),
              eq(narrations.speakerMemberId, speakerMemberId),
              eq(narrations.kind, "voice"),
              gte(narrations.createdAt, createdSince),
              notExists(db.select(one).from(replies).where(and(eq(replies.familyId, familyId), eq(replies.replyToId, narrationId)))),
              notExists(db.select(one).from(entrances).where(and(eq(entrances.familyId, familyId), eq(entrances.quoteNarrationId, narrationId)))),
              notExists(db.select(one).from(inputs).where(and(eq(entrances.familyId, familyId), sql`retake_input.value = ${narrationId}`))),
              notExists(db.select(one).from(records).where(eq(records.narrationId, narrationId))),
              notExists(db.select(one).from(recordExtractions).where(eq(recordExtractions.narrationId, narrationId))),
              notExists(db.select(one).from(musubiPhotos).where(eq(musubiPhotos.evidenceNarrationId, narrationId))),
            ),
          )
          .returning({ audioKey: narrations.audioKey, createdAt: narrations.createdAt });
        return rows[0] ?? null;
      },
    },

    entrances: {
      async get(familyId, memberId, forDate) {
        const r = await db
          .select()
          .from(entrances)
          .where(and(eq(entrances.familyId, familyId), eq(entrances.memberId, memberId), eq(entrances.forDate, forDate)))
          .get();
        return r ? toEntrance(r) : null;
      },
      async getById(familyId, entranceId) {
        const r = await db
          .select()
          .from(entrances)
          .where(and(eq(entrances.familyId, familyId), eq(entrances.id, entranceId)))
          .get();
        return r ? toEntrance(r) : null;
      },
      async listByMember(familyId, memberId) {
        const rows = await db
          .select()
          .from(entrances)
          .where(and(eq(entrances.familyId, familyId), eq(entrances.memberId, memberId)))
          .all();
        return rows.map(toEntrance);
      },
      async listByDate(familyId, forDate) {
        const rows = await db
          .select()
          .from(entrances)
          .where(and(eq(entrances.familyId, familyId), eq(entrances.forDate, forDate)))
          .all();
        return rows.map(toEntrance);
      },
      async insertFixedIfAbsent(row) {
        const res = await db
          .insert(entrances)
          .values({ ...row, kind: "fixed" })
          .onConflictDoNothing({ target: [entrances.memberId, entrances.forDate] });
        return changes(res) > 0;
      },
      async insertClaudeIfAbsent(row) {
        const res = await db
          .insert(entrances)
          .values({ ...row, kind: "claude" })
          .onConflictDoNothing({ target: [entrances.memberId, entrances.forDate] });
        return changes(res) > 0;
      },
      async markShown(familyId, entranceId, now) {
        await db
          .update(entrances)
          .set({ shownAt: now })
          .where(and(eq(entrances.familyId, familyId), eq(entrances.id, entranceId), isNull(entrances.shownAt)));
      },
      async setQuestionAudio(familyId, entranceId, audio) {
        const res = await db
          .update(entrances)
          .set({ questionAudioKey: audio.key, questionAudioModel: audio.model, questionAudioVoice: audio.voice })
          .where(
            and(
              eq(entrances.familyId, familyId),
              eq(entrances.id, entranceId),
              eq(entrances.kind, "claude"),
              isNull(entrances.questionAudioKey),
              isNull(entrances.shownAt),
            ),
          );
        return changes(res) > 0;
      },
    },

    photoGuesses: {
      async listCandidates(familyId, promptVersion, limit, opts) {
        const req = photoGuessRequests;
        const rows = await db
          .select({ photo: photos })
          .from(photos)
          .leftJoin(photoGuesses, and(eq(photoGuesses.photoId, photos.id), eq(photoGuesses.promptVersion, promptVersion)))
          .leftJoin(req, and(eq(req.photoId, photos.id), eq(req.promptVersion, promptVersion)))
          .where(
            and(
              eq(photos.familyId, familyId),
              isNull(photoGuesses.id),
              or(isNull(req.photoId), claimable(req, opts)),
            ),
          )
          .orderBy(asc(photos.createdAt), asc(photos.id))
          .limit(limit)
          .all();
        return rows.map((r) => r.photo as PhotoRow);
      },
      async claim(familyId, photoIds, promptVersion, { now, ...opts }) {
        if (photoIds.length === 0) return [];
        const claimed: string[] = [];
        // 一行ずつ（D1 の一文の変数の上限に当たらないように）。取れたかどうかは RETURNING で見る。
        // 説明がもうある写真は取らない: 候補を読んだ後に、ほかの処理が説明を入れて作業の行を消していると、
        // 行がないので取れてしまい、同じ写真を二度呼ぶ（並んだ登録の背景処理で起きた）。説明の有無は取る文の中で確かめる
        const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
        const noGuess = (photoId: SQLWrapper) =>
          notExists(
            db
              .select({ one: sql`1` })
              .from(photoGuesses)
              .where(and(eq(photoGuesses.photoId, photoId), eq(photoGuesses.promptVersion, promptVersion))),
          );
        for (const photoId of photoIds) {
          const r = await db
            .insert(photoGuessRequests)
            .select(
              // drizzle は insert … select の列を表の定義の順で書く。select のキーは schema.ts の photoGuessRequests の列の順に並べる
              db
                .select({
                  photoId: photos.id,
                  promptVersion: v(promptVersion, "prompt_version"),
                  familyId: photos.familyId,
                  state: v("working" as const, "state"),
                  batchId: v(null, "batch_id"),
                  attempts: v(1, "attempts"),
                  claimedAt: v(now, "claimed_at"),
                })
                .from(photos)
                .where(and(eq(photos.id, photoId), eq(photos.familyId, familyId), noGuess(photos.id))),
            )
            .onConflictDoUpdate({
              target: [photoGuessRequests.photoId, photoGuessRequests.promptVersion],
              set: { state: "working", batchId: null, attempts: sql`${photoGuessRequests.attempts} + 1`, claimedAt: now },
              setWhere: and(eq(photoGuessRequests.familyId, familyId), claimable(photoGuessRequests, opts), noGuess(photoGuessRequests.photoId)),
            })
            .returning({ photoId: photoGuessRequests.photoId })
            .all();
          if (r.length > 0) claimed.push(photoId);
        }
        return claimed;
      },
      async attachBatch(familyId, photoIds, promptVersion, batchId) {
        if (photoIds.length === 0) return;
        await db
          .update(photoGuessRequests)
          .set({ batchId })
          .where(
            and(
              eq(photoGuessRequests.familyId, familyId),
              eq(photoGuessRequests.promptVersion, promptVersion),
              eq(photoGuessRequests.state, "working"),
              inArray(photoGuessRequests.photoId, photoIds),
            ),
          );
      },
      async saveGuess(row: PhotoGuessRow) {
        await runBatch([
          db.insert(photoGuesses).values(row).onConflictDoNothing({ target: [photoGuesses.photoId, photoGuesses.promptVersion] }),
          db
            .delete(photoGuessRequests)
            .where(
              and(
                eq(photoGuessRequests.familyId, row.familyId),
                eq(photoGuessRequests.photoId, row.photoId),
                eq(photoGuessRequests.promptVersion, row.promptVersion),
              ),
            ),
        ]);
      },
      async release(familyId, photoIds, promptVersion) {
        if (photoIds.length === 0) return;
        // 取ったときに足した 1 を戻し、取り直せる状態（failed、回数は上限の内側）にする
        await db
          .update(photoGuessRequests)
          // 試していないので、待たずに取り直せるようにする（claimed_at を 0 に）
          .set({ state: "failed", batchId: null, attempts: sql`${photoGuessRequests.attempts} - 1`, claimedAt: 0 })
          .where(
            and(
              eq(photoGuessRequests.familyId, familyId),
              eq(photoGuessRequests.promptVersion, promptVersion),
              eq(photoGuessRequests.state, "working"),
              inArray(photoGuessRequests.photoId, photoIds),
            ),
          );
      },
      async markFailed(familyId, photoIds, promptVersion) {
        if (photoIds.length === 0) return;
        await db
          .update(photoGuessRequests)
          .set({ state: "failed", batchId: null })
          .where(
            and(
              eq(photoGuessRequests.familyId, familyId),
              eq(photoGuessRequests.promptVersion, promptVersion),
              eq(photoGuessRequests.state, "working"),
              inArray(photoGuessRequests.photoId, photoIds),
            ),
          );
      },
      async listOpenBatches(familyId) {
        const where = familyId
          ? and(isNotNull(photoGuessRequests.batchId), eq(photoGuessRequests.familyId, familyId))
          : isNotNull(photoGuessRequests.batchId);
        const rows = await db
          .selectDistinct({
            batchId: photoGuessRequests.batchId,
            familyId: photoGuessRequests.familyId,
            promptVersion: photoGuessRequests.promptVersion,
          })
          .from(photoGuessRequests)
          .where(and(where, eq(photoGuessRequests.state, "working")))
          .all();
        return rows.flatMap((r) => (r.batchId ? [{ batchId: r.batchId, familyId: r.familyId, promptVersion: r.promptVersion }] : []));
      },
      async listClaimsByBatch(batchId) {
        const rows = await db
          .select()
          .from(photoGuessRequests)
          .where(and(eq(photoGuessRequests.batchId, batchId), eq(photoGuessRequests.state, "working")))
          .all();
        return rows.map((r) => ({
          photoId: r.photoId,
          familyId: r.familyId,
          promptVersion: r.promptVersion,
          batchId: r.batchId,
          attempts: r.attempts,
        }));
      },
      async listByFamily(familyId) {
        return (await db
          .select()
          .from(photoGuesses)
          .where(eq(photoGuesses.familyId, familyId))
          .orderBy(asc(photoGuesses.createdAt), asc(photoGuesses.id))
          .all()) as PhotoGuessRow[];
      },
    },

    records: {
      async listByFamily(familyId) {
        return (await db
          .select()
          .from(records)
          .where(eq(records.familyId, familyId))
          .orderBy(asc(records.createdAt), asc(records.narrationId), asc(records.quoteStart), asc(records.id))
          .all()) as RecordRow[];
      },
    },

    recordExtractions: {
      async listPending(familyId, maxAttempts, limit) {
        const rows = await db
          .select()
          .from(narrations)
          .where(
            and(
              eq(narrations.familyId, familyId),
              // 引用の位置を数える文字があるものだけ（文字の語りは transcript、声の語りは整形済み）。整形がまだの声は翌朝に回る
              or(
                and(eq(narrations.kind, "text"), isNotNull(narrations.transcript)),
                and(eq(narrations.kind, "voice"), isNotNull(narrations.cleanedText)),
              ),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(recordExtractions)
                  .where(
                    and(
                      eq(recordExtractions.narrationId, narrations.id),
                      or(eq(recordExtractions.state, "done"), sql`${recordExtractions.attempts} >= ${maxAttempts}`),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(asc(narrations.createdAt), asc(narrations.id))
          .limit(limit)
          .all();
        return rows.map(toNarration);
      },
      async saveDone(attempt, rows) {
        const extractionOf = (state: "done" | "failed") => extractionSelect(attempt, state);
        const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
        // done の行がまだないときだけ（同じ語りの取り出しが重なっても、記録は一組だけ）。語りがその家族のものであることも確かめる
        const notDone = notExists(
          db
            .select({ one: sql`1` })
            .from(recordExtractions)
            .where(and(eq(recordExtractions.narrationId, attempt.narrationId), eq(recordExtractions.state, "done"))),
        );
        const items: BatchItem[] = rows.map((r) =>
          db.insert(records).select(
            db
              .select({
                id: v(r.id, "id"),
                familyId: narrations.familyId,
                photoId: narrations.photoId,
                kind: v(r.kind, "kind"),
                value: v(r.value, "value"),
                origin: v("told", "origin"),
                toldByMemberId: narrations.speakerMemberId,
                narrationId: narrations.id,
                quoteStart: v(r.quoteStart, "quoteStart"),
                quoteEnd: v(r.quoteEnd, "quoteEnd"),
                model: v<string | null>(null, "model"),
                promptVersion: v<string | null>(null, "promptVersion"),
                createdAt: v(r.createdAt, "createdAt"),
              })
              .from(narrations)
              .where(
                and(
                  eq(narrations.id, r.narrationId),
                  eq(narrations.id, attempt.narrationId),
                  eq(narrations.familyId, attempt.familyId),
                  eq(narrations.familyId, r.familyId),
                  eq(narrations.photoId, r.photoId),
                  eq(narrations.speakerMemberId, r.toldByMemberId),
                  notDone,
                ),
              ),
          ),
        );
        // 記録を先に入れ、作業の行を後で done にする（done になった後では not exists で入らなくなるため）
        await runBatch([
          ...items,
          db
            .insert(recordExtractions)
            .select(extractionOf("done"))
            .onConflictDoUpdate({
              target: recordExtractions.narrationId,
              set: {
                promptVersion: attempt.promptVersion,
                model: attempt.model,
                state: "done",
                attempts: sql`${recordExtractions.attempts} + 1`,
                inputTokens: attempt.inputTokens,
                outputTokens: attempt.outputTokens,
                createdAt: attempt.createdAt,
              },
              setWhere: and(eq(recordExtractions.familyId, attempt.familyId), ne(recordExtractions.state, "done")),
            }),
        ] as unknown as [BatchItem, ...BatchItem[]]);
      },
      async markFailed(attempt) {
        const extractionOf = (state: "done" | "failed") => extractionSelect(attempt, state);
        await db
          .insert(recordExtractions)
          .select(extractionOf("failed"))
          .onConflictDoUpdate({
            target: recordExtractions.narrationId,
            set: {
              promptVersion: attempt.promptVersion,
              model: attempt.model,
              attempts: sql`${recordExtractions.attempts} + 1`,
              inputTokens: attempt.inputTokens,
              outputTokens: attempt.outputTokens,
              createdAt: attempt.createdAt,
            },
            setWhere: and(eq(recordExtractions.familyId, attempt.familyId), eq(recordExtractions.state, "failed")),
          })
          .run();
      },
      async listByFamily(familyId) {
        return (await db
          .select()
          .from(recordExtractions)
          .where(eq(recordExtractions.familyId, familyId))
          .orderBy(asc(recordExtractions.createdAt), asc(recordExtractions.narrationId))
          .all()) as RecordExtractionRow[];
      },
    },

    musubi: {
      async linkByFamily(req, newPhoto) {
        const { familyId, withPhotoId, photoId } = req;
        if (withPhotoId === photoId) throw new Error("same_photo");
        if (newPhoto && (newPhoto.id !== photoId || newPhoto.familyId !== familyId)) throw new Error("photo_mismatch");
        // 既に同じ家族のむすびに X と Z がいれば、何も書かない（新しい写真は、まだどこにもいない）
        if (!newPhoto) {
          const prior = await sharedFamilyMusubi(familyId, withPhotoId, photoId);
          if (prior) return { photoInserted: false, link: { musubiId: prior, linked: false } };
        }
        const items = familyLinkItems(req);
        if (newPhoto) {
          await runBatch([
            db.insert(photos).values(newPhoto).onConflictDoNothing({ target: [photos.ownerMemberId, photos.contentHash] }),
            ...items,
          ] as unknown as [BatchItem, ...BatchItem[]]);
          const inserted = await db
            .select({ id: photos.id })
            .from(photos)
            .where(and(eq(photos.familyId, familyId), eq(photos.id, newPhoto.id)))
            .get();
          // 写真が入らなかった（同時に同じ写真が届いた）ときは、Z の行は入っていない（新しいむすびも作られない）
          if (!inserted) return { photoInserted: false, link: null };
        } else {
          await runBatch(items as unknown as [BatchItem, ...BatchItem[]]);
        }
        const musubiId = await sharedFamilyMusubi(familyId, withPhotoId, photoId);
        return { photoInserted: true, link: musubiId ? { musubiId, linked: true } : null };
      },
      async unlinkByFamily(familyId, musubiId, photoId, memberId) {
        const res = await db
          .delete(musubiPhotos)
          .where(
            and(
              eq(musubiPhotos.familyId, familyId),
              eq(musubiPhotos.musubiId, musubiId),
              eq(musubiPhotos.photoId, photoId),
              eq(musubiPhotos.status, "confirmed"),
              eq(musubiPhotos.decidedByMemberId, memberId),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(musubi)
                  .where(and(eq(musubi.id, musubiId), eq(musubi.familyId, familyId), eq(musubi.createdBy, "family"))),
              ),
            ),
          )
          .run();
        return changes(res) > 0;
      },
      async listByFamily(familyId) {
        const [ms, ps] = await Promise.all([
          db.select().from(musubi).where(eq(musubi.familyId, familyId)).orderBy(asc(musubi.createdAt), asc(musubi.id)).all(),
          db.select().from(musubiPhotos).where(eq(musubiPhotos.familyId, familyId)).orderBy(asc(musubiPhotos.createdAt), asc(musubiPhotos.photoId)).all(),
        ]);
        return ms.map(
          (m): MusubiRow => ({
            id: m.id,
            familyId: m.familyId,
            createdBy: m.createdBy,
            guessedReason: m.guessedReason,
            guessedEvidenceRecordIds: Array.isArray(m.guessedEvidenceRecordIds) ? m.guessedEvidenceRecordIds : null,
            model: m.model,
            promptVersion: m.promptVersion,
            createdAt: m.createdAt,
            photos: ps
              .filter((p) => p.musubiId === m.id)
              .map((p) => ({ photoId: p.photoId, status: p.status, decidedByMemberId: p.decidedByMemberId, decidedAt: p.decidedAt })),
          }),
        );
      },
      async getRun(familyId, inputKey) {
        const r = await db
          .select()
          .from(musubiGuessRuns)
          .where(and(eq(musubiGuessRuns.familyId, familyId), eq(musubiGuessRuns.inputKey, inputKey)))
          .get();
        return (r ?? null) as MusubiGuessRunRow | null;
      },
      async saveGuessed(attempt, rows) {
        // 推測には出所のモデルを必ず付ける。モデルが分からない応答のむすびは入れず、失敗として翌朝に取り直す（"unknown" で埋めない）
        if (!attempt.model) {
          await this.markFailed(attempt);
          return false;
        }
        const model = attempt.model;
        const v = <T>(x: T, as: string) => sql<T>`${x}`.as(as);
        // 同じ入力の done の行がまだないときだけ（同じ朝の処理が重なっても、むすびは一組だけ）
        const notDone = notExists(
          db
            .select({ one: sql`1` })
            .from(musubiGuessRuns)
            .where(and(eq(musubiGuessRuns.familyId, attempt.familyId), eq(musubiGuessRuns.inputKey, attempt.inputKey), eq(musubiGuessRuns.state, "done"))),
        );
        const items: BatchItem[] = [];
        for (const m of rows) {
          // むすびはその家族があるときだけ。写真はその家族のもので、むすびが入ったときだけ
          items.push(
            db.insert(musubi).select(
              db
                .select({
                  id: v(m.id, "id"),
                  familyId: families.id,
                  createdBy: v("guessed", "createdBy"),
                  guessedReason: v(m.reason, "guessedReason"),
                  guessedEvidenceRecordIds: v(JSON.stringify(m.evidenceRecordIds), "guessedEvidenceRecordIds"),
                  model: v(model, "model"),
                  promptVersion: v(attempt.promptVersion, "promptVersion"),
                  createdAt: v(m.createdAt, "createdAt"),
                })
                .from(families)
                .where(
                  and(
                    eq(families.id, m.familyId),
                    eq(families.id, attempt.familyId),
                    notDone,
                    // その家族の写真が 2 枚以上あるときだけ（写真の欠けたむすびの行を残さない）
                    sql`(${db
                      .select({ n: sql`count(*)` })
                      .from(photos)
                      .where(and(inArray(photos.id, m.photoIds), eq(photos.familyId, attempt.familyId)))}) >= 2`,
                  ),
                ),
            ) as unknown as BatchItem,
          );
          for (const photoId of m.photoIds) {
            items.push(
              db.insert(musubiPhotos).select(
                db
                  .select({
                    musubiId: v(m.id, "musubiId"),
                    photoId: photos.id,
                    familyId: photos.familyId,
                    status: v("guessed", "status"),
                    evidenceNarrationId: v<string | null>(null, "evidenceNarrationId"),
                    decidedByMemberId: v<string | null>(null, "decidedByMemberId"),
                    decidedAt: v<number | null>(null, "decidedAt"),
                    createdAt: v(m.createdAt, "createdAt"),
                  })
                  .from(photos)
                  .where(
                    and(
                      eq(photos.id, photoId),
                      eq(photos.familyId, attempt.familyId),
                      exists(db.select({ one: sql`1` }).from(musubi).where(and(eq(musubi.id, m.id), eq(musubi.familyId, attempt.familyId)))),
                    ),
                  ),
              ) as unknown as BatchItem,
            );
          }
        }
        // むすびを先に入れ、作業の行を後で done にする（done になった後では not exists で入らなくなるため）
        await runBatch([
          ...items,
          db
            .insert(musubiGuessRuns)
            .select(runSelect(attempt, "done"))
            .onConflictDoUpdate({
              target: [musubiGuessRuns.familyId, musubiGuessRuns.inputKey],
              set: {
                promptVersion: attempt.promptVersion,
                model: attempt.model,
                state: "done",
                attempts: sql`${musubiGuessRuns.attempts} + 1`,
                inputTokens: attempt.inputTokens,
                outputTokens: attempt.outputTokens,
                createdAt: attempt.createdAt,
              },
              setWhere: ne(musubiGuessRuns.state, "done"),
            }),
        ] as unknown as [BatchItem, ...BatchItem[]]);
        return true;
      },
      async markFailed(attempt) {
        await db
          .insert(musubiGuessRuns)
          .select(runSelect(attempt, "failed"))
          .onConflictDoUpdate({
            target: [musubiGuessRuns.familyId, musubiGuessRuns.inputKey],
            set: {
              promptVersion: attempt.promptVersion,
              model: attempt.model,
              attempts: sql`${musubiGuessRuns.attempts} + 1`,
              inputTokens: attempt.inputTokens,
              outputTokens: attempt.outputTokens,
              createdAt: attempt.createdAt,
            },
            setWhere: eq(musubiGuessRuns.state, "failed"),
          })
          .run();
      },
      async listRuns(familyId) {
        return (await db
          .select()
          .from(musubiGuessRuns)
          .where(eq(musubiGuessRuns.familyId, familyId))
          .orderBy(asc(musubiGuessRuns.createdAt), asc(musubiGuessRuns.inputKey))
          .all()) as MusubiGuessRunRow[];
      },
    },

    opsRecords: {
      async listEntrances(familyId) {
        const rows = await db
          .select()
          .from(entrances)
          .where(eq(entrances.familyId, familyId))
          .orderBy(desc(entrances.forDate), asc(entrances.memberId))
          .all();
        return rows.map(
          (r): OpsEntranceRow => ({
            ...toEntrance(r),
            reason: r.reason,
            model: r.model,
            promptVersion: r.promptVersion,
            inputNarrationIds: r.inputNarrationIds,
            inputTokens: r.inputTokens,
            outputTokens: r.outputTokens,
          }),
        );
      },
    },

    demoReset: {
      async snapshot(familyId) {
        const count = async (t: (typeof demoTables)[DemoResetTable]) => {
          const r = await db.select({ n: sql<number>`count(*)` }).from(t).where(eq(t.familyId, familyId)).get();
          return Number(r?.n ?? 0);
        };
        const rows = {} as Record<DemoResetTable, number>;
        for (const name of DEMO_RESET_TABLES) rows[name] = await count(demoTables[name]);
        const [p, n, e] = await Promise.all([
          db.select({ k: photos.storageKey }).from(photos).where(eq(photos.familyId, familyId)).all(),
          db
            .select({ k: narrations.audioKey })
            .from(narrations)
            .where(and(eq(narrations.familyId, familyId), isNotNull(narrations.audioKey)))
            .all(),
          db
            .select({ k: entrances.questionAudioKey })
            .from(entrances)
            .where(and(eq(entrances.familyId, familyId), isNotNull(entrances.questionAudioKey)))
            .all(),
        ]);
        const storedKeys = [...p, ...n, ...e].map((r) => r.k).filter((k): k is string => typeof k === "string");
        return { rows, storedKeys };
      },
      async replaceContent(familyId, seed, clock) {
        // 子から順に消す（外部キー）。続けて、写真 → 入り口 → 語りの順に入れる（語りが入り口を指す）。
        // 一行ずつ入れる（D1 の一文の変数の上限 100 に当たらないように）
        const deletes = DEMO_RESET_TABLES.map((name) => {
          const t = demoTables[name];
          return db.delete(t).where(eq(t.familyId, familyId));
        });
        const inserts = [
          ...seed.photos.map((r) => db.insert(photos).values(r)),
          ...seed.entrances.map((r) => db.insert(entrances).values(r)),
          ...seed.narrations.map((r) =>
            db.insert(narrations).values({ ...r, uncertainSpans: r.uncertainSpans === null ? null : JSON.stringify(r.uncertainSpans) }),
          ),
        ];
        const setClock = db.update(families).set({ clockDate: clock.date, clockSlot: clock.slot }).where(eq(families.id, familyId));
        const [first, ...rest] = deletes;
        await runBatch([first!, ...rest, ...inserts, setClock]);
      },
    },
  };
}
