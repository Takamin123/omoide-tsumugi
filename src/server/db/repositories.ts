// リポジトリの実装。drizzle の SQLite 共通の書き方だけを使い、D1 でも better-sqlite3（VPS）でも同じものを使う。
// 実行環境ごとに違うのは「drizzle のデータベース」と「いくつかの文を一度に行う方法」だけで、入り口の層が渡す。
// - D1: db.batch()（対話的なトランザクションは使えない）
// - better-sqlite3: db.transaction() の中で順に run する
import { and, asc, eq, isNull } from "drizzle-orm";
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type {
  EntranceRow,
  FamilyRow,
  MemberRow,
  NarrationRow,
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

const { families, inviteLinks, members, photos, narrations, entrances } = schema;

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
  };
}
