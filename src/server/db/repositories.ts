// リポジトリの実装。drizzle の SQLite 共通の書き方だけを使い、D1 でも better-sqlite3（VPS）でも同じものを使う。
// 実行環境ごとに違うのは「drizzle のデータベース」と「いくつかの文を一度に行う方法」だけで、入り口の層が渡す。
// - D1: db.batch()（対話的なトランザクションは使えない）
// - better-sqlite3: db.transaction() の中で順に run する
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type {
  ClaimOpts,
  EntranceRow,
  FamilyRow,
  MemberRow,
  NarrationRow,
  OpsEntranceRow,
  PhotoGuessRow,
  PhotoRow,
  Repositories,
  UncertainSpan,
} from "../core/ports";
import * as schema from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SqliteDb = BaseSQLiteDatabase<"async" | "sync", any, typeof schema>;
export type BatchItem = DrizzleBatchItem<"sqlite">;
/** いくつかの書き込みを、すべて行うか、どれも行わないかで行う。 */
export type RunBatch = (items: [BatchItem, ...BatchItem[]]) => Promise<void>;

const { families, inviteLinks, members, photos, narrations, entrances, photoGuesses, photoGuessRequests } = schema;

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
  return {
    families: {
      async create(family, invite, now) {
        await runBatch([
          db.insert(families).values({
            id: family.id,
            name: family.name,
            isDemo: family.isDemo,
            clockDate: family.clock?.date ?? null,
            clockSlot: family.clock?.slot ?? null,
            createdAt: now,
          }),
          db.insert(inviteLinks).values({ id: invite.id, familyId: family.id, tokenHash: invite.tokenHash, createdAt: now }),
        ]);
      },
      async get(familyId) {
        const r = await db.select().from(families).where(eq(families.id, familyId)).get();
        return r ? toFamily(r) : null;
      },
      async findByActiveInviteHash(tokenHash) {
        const r = await db
          .select({ family: families })
          .from(inviteLinks)
          .innerJoin(families, eq(families.id, inviteLinks.familyId))
          .where(and(eq(inviteLinks.tokenHash, tokenHash), isNull(inviteLinks.revokedAt)))
          .get();
        return r ? toFamily(r.family) : null;
      },
      async regenerateInvite(familyId, invite, now) {
        await runBatch([
          db
            .update(inviteLinks)
            .set({ revokedAt: now })
            .where(and(eq(inviteLinks.familyId, familyId), isNull(inviteLinks.revokedAt))),
          db.insert(inviteLinks).values({ id: invite.id, familyId, tokenHash: invite.tokenHash, createdAt: now }),
        ]);
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
        const res = await db
          .update(members)
          .set(fields)
          .where(and(eq(members.familyId, familyId), eq(members.id, memberId)));
        if (changes(res) === 0) return null;
        return this.get(familyId, memberId);
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
      async markShown(familyId, entranceId, now) {
        await db
          .update(entrances)
          .set({ shownAt: now })
          .where(and(eq(entrances.familyId, familyId), eq(entrances.id, entranceId), isNull(entrances.shownAt)));
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
