// リポジトリの実装。drizzle の SQLite 共通の書き方だけを使い、D1 でも better-sqlite3（VPS）でも同じものを使う。
// 実行環境ごとに違うのは「drizzle のデータベース」と「いくつかの文を一度に行う方法」だけで、入り口の層が渡す。
// - D1: db.batch()（対話的なトランザクションは使えない）
// - better-sqlite3: db.transaction() の中で順に run する
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import { alias, type BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type {
  ClaimOpts,
  EntranceRow,
  FamilyRow,
  MemberRow,
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

const { families, inviteLinks, members, photos, narrations, entrances, photoGuesses, photoGuessRequests, records, recordExtractions } = schema;

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
        // 一行ずつ（D1 の一文の変数の上限に当たらないように）。取れたかどうかは RETURNING で見る
        for (const photoId of photoIds) {
          const r = await db
            .insert(photoGuessRequests)
            .values({ photoId, promptVersion, familyId, state: "working", batchId: null, attempts: 1, claimedAt: now })
            .onConflictDoUpdate({
              target: [photoGuessRequests.photoId, photoGuessRequests.promptVersion],
              set: { state: "working", batchId: null, attempts: sql`${photoGuessRequests.attempts} + 1`, claimedAt: now },
              setWhere: and(eq(photoGuessRequests.familyId, familyId), claimable(photoGuessRequests, opts)),
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
  };
}
