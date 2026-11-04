// 入り口。固定の入り口（Claude を使わない。選び方は docs/decisions/0009）。Claude の入り口は entrance-claude.ts。
import { displayText } from "./clean-transcript";
import { addDays } from "./clock";
import type { AppDeps, EntranceRow, FamilyRow, MemberRow, NarrationRow, PhotoRow } from "./ports";

/**
 * 前のこの日数のあいだにこの人の入り口に出した写真は、次の日に続けて出さない（0057）。
 * 本番の親の試しで、前の日に出した写真に家族が語りを足したため、Claude の入り口の候補（g1）で翌日も先頭に来て、
 * 受け取る人には「昨日と同じ写真」に見えた。Claude の入り口では g0（自分の語りへの返事）だけは残す。
 * 家族の写真がそれしかないときは出してよい
 */
export const ENTRANCE_NO_REPEAT_DAYS = 1;

/** from 以上 until 未満の日に、その人の入り口に出した写真の ID */
export function shownSince(past: readonly Pick<EntranceRow, "photoId" | "forDate">[], from: string, until: string): Set<string> {
  const ids = new Set<string>();
  for (const e of past) if (e.forDate >= from && e.forDate < until) ids.add(e.photoId);
  return ids;
}

export type EnsureResult = { entrance: EntranceRow; created: boolean } | null;

/**
 * その人のその日の入り口がなければ、固定の入り口を作って保存する。あればそれを返す。
 * 家族に写真が一枚もなければ null。同じ日に何度呼んでも一つ（(member_id, for_date) が一意）。
 */
export async function ensureFixedEntrance(
  deps: Pick<AppDeps, "repos">,
  family: Pick<FamilyRow, "id">,
  member: Pick<MemberRow, "id">,
  forDate: string,
  now: number,
): Promise<EnsureResult> {
  const { repos } = deps;
  const existing = await repos.entrances.get(family.id, member.id, forDate);
  if (existing) return { entrance: existing, created: false };

  const [photos, past] = await Promise.all([
    repos.photos.list(family.id),
    repos.entrances.listByMember(family.id, member.id),
  ]);
  const photo = pickFixedPhoto(photos, past, member.id, forDate);
  if (!photo) return null;

  const narrations = await repos.narrations.listByPhoto(family.id, photo.id);
  const quote = latestWithText(narrations);

  const inserted = await repos.entrances.insertFixedIfAbsent({
    id: crypto.randomUUID(),
    familyId: family.id,
    memberId: member.id,
    forDate,
    photoId: photo.id,
    quoteNarrationId: quote?.id ?? null,
    createdAt: now,
  });
  const entrance = await repos.entrances.get(family.id, member.id, forDate);
  if (!entrance) throw new Error("entrance_missing_after_insert");
  return { entrance, created: inserted };
}

/**
 * 固定の入り口の写真を選ぶ。
 * 1. ほかの家族のライブラリから、その人の入り口にまだ使っていないものを、撮影日の古い順に
 * 2. なければ自分の写真も含めて、まだ使っていないもの
 * 3. それもなければ、その人に最後に出したのがいちばん古い写真（docs/decisions/0009）
 * forDate を渡すと、前の ENTRANCE_NO_REPEAT_DAYS 日に出した写真は 3 で選ばない（0057）。それしかなければ選ぶ
 */
export function pickFixedPhoto(
  photos: PhotoRow[],
  past: Pick<EntranceRow, "photoId" | "forDate">[],
  memberId: string,
  forDate?: string,
): PhotoRow | null {
  if (photos.length === 0) return null;
  const lastUsed = new Map<string, string>();
  for (const e of past) {
    const prev = lastUsed.get(e.photoId);
    if (!prev || e.forDate > prev) lastUsed.set(e.photoId, e.forDate);
  }
  const byTaken = [...photos].sort(compareTaken);
  const unused = byTaken.filter((p) => !lastUsed.has(p.id));
  const fromOthers = unused.find((p) => p.ownerMemberId !== memberId);
  if (fromOthers) return fromOthers;
  if (unused[0]) return unused[0];
  // すべて使った: 最後に出した日がいちばん古いもの（同じなら撮影日の古い順）。前の日に出した写真は、ほかにあれば選ばない
  const noRepeat = forDate ? shownSince(past, addDays(forDate, -ENTRANCE_NO_REPEAT_DAYS), forDate) : new Set<string>();
  const pool = byTaken.filter((p) => !noRepeat.has(p.id));
  return (pool.length > 0 ? pool : byTaken).reduce((best, p) => (lastUsed.get(p.id)! < lastUsed.get(best.id)! ? p : best));
}

/** 撮影日の古い順。撮影日がないものは後ろ。同じなら登録順。 */
export function compareTaken(a: PhotoRow, b: PhotoRow): number {
  if (a.takenAt !== b.takenAt) {
    if (a.takenAt === null) return 1;
    if (b.takenAt === null) return -1;
    return a.takenAt < b.takenAt ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : 1;
}

function latestWithText(narrations: NarrationRow[]): NarrationRow | null {
  let best: NarrationRow | null = null;
  for (const n of narrations) {
    if (displayText(n) === null) continue;
    if (!best || n.createdAt > best.createdAt) best = n;
  }
  return best;
}
