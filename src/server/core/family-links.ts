// 家族の手のむすび（「この写真に追加する」。0048）から、写真ごとの「追加した写真」を引く。
// 推測のむすび（created_by = guessed）と、confirmed でない写真は一切使わない（0044: 推測は家族向けの API に出さない）
import type { MusubiRow } from "./ports";

/**
 * 写真 ID → 同じ家族の手のむすびにいる、confirmed のほかの写真の ID（古く追加した順。同じなら ID の順）。
 * familyPhotoIds にないもの（ほかの家族の写真など）は入れない。一枚が複数のむすびにいれば、まとめて重ねない
 */
export function addedPhotoIds(musubi: readonly MusubiRow[], familyPhotoIds: ReadonlySet<string>): Map<string, string[]> {
  const found = new Map<string, Map<string, number>>();
  for (const m of musubi) {
    if (m.createdBy !== "family") continue;
    const live = m.photos.filter((p) => p.status === "confirmed" && familyPhotoIds.has(p.photoId));
    for (const a of live) {
      for (const b of live) {
        if (a.photoId === b.photoId) continue;
        const map = found.get(a.photoId) ?? new Map<string, number>();
        const at = b.decidedAt ?? 0;
        const prev = map.get(b.photoId);
        if (prev === undefined || at < prev) map.set(b.photoId, at);
        found.set(a.photoId, map);
      }
    }
  }
  const out = new Map<string, string[]>();
  for (const [photoId, map] of found) {
    out.set(
      photoId,
      [...map.entries()].sort(([ia, a], [ib, b]) => a - b || (ia < ib ? -1 : ia > ib ? 1 : 0)).map(([id]) => id),
    );
  }
  return out;
}
