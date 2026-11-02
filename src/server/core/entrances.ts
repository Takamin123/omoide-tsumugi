// 入り口。初日は Claude を使わない「固定の入り口」だけを作る（選び方は docs/decisions/0009）。
import { displayText } from "./clean-transcript";
import type { AppDeps, EntranceRow, FamilyRow, MemberRow, NarrationRow, PhotoRow } from "./ports";

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
  const photo = pickFixedPhoto(photos, past, member.id);
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
 */
export function pickFixedPhoto(photos: PhotoRow[], past: Pick<EntranceRow, "photoId" | "forDate">[], memberId: string): PhotoRow | null {
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
  // すべて使った: 最後に出した日がいちばん古いもの（同じなら撮影日の古い順）
  return byTaken.reduce((best, p) => (lastUsed.get(p.id)! < lastUsed.get(best.id)! ? p : best));
}

/** 撮影日の古い順。撮影日がないものは後ろ。同じなら登録順。 */
function compareTaken(a: PhotoRow, b: PhotoRow): number {
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
