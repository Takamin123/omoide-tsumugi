// 返事のタブ（0058）の画面の側の決まり。何が届いたもの（(a) 自分の語りへの返事、(b) 自分の写真への語り、(c) 自分の言葉を引用した入り口への答え）か・まだ見ていないかは
// src/shared/replies.ts（repliesFor・unseenReplies）に従う。ここではそれを写真ごとにまとめ、出す語りを決める。DOM に頼らない。
// 写真ごとに出すのは、届いたものを含む糸（根の語りから下の返事まで）まるごと。自分の語りへの返事なら自分の語りが根として上に出る。
// 届いた語りにこのタブで返事をしたら、その返事も糸の中に残る（送った返事が消えないように）。自分だけの語りの糸は出さない。
// 自分の言葉を引用した入り口への答え（(c)）なら、引用元の自分の語りの糸も出す（同じ写真の一覧の順のまま。自分の言葉が上、答えが下）。
import type { FeedItem, FeedNarration } from "../../shared/api";
import { repliesFor, unseenReplies } from "../../shared/replies";

export type ReplyGroup = {
  item: FeedItem;
  /** 出す語り（届いたものを含む糸。一覧の順のまま） */
  narrations: FeedNarration[];
  /** この写真に届いたものの一番新しい時刻 */
  latestAt: number;
};

/** 写真ごとのまとまり。届いたものの一番新しい時刻の新しい順（repliesFor の順） */
export function replyGroups(feed: readonly FeedItem[], meId: string): ReplyGroup[] {
  const incoming = repliesFor(feed, meId);
  const groups: ReplyGroup[] = [];
  const seen = new Set<string>();
  for (const r of incoming) {
    if (seen.has(r.photo.id)) continue;
    seen.add(r.photo.id);
    const item = feed.find((it) => it.photo.id === r.photo.id)!;
    const byId = new Map(item.narrations.map((n) => [n.id, n]));
    // 糸の根: 返した先をたどり、一覧にないところで止まる（輪になっていても止まる）
    const rootOf = (n: FeedNarration): string => {
      const passed = new Set<string>();
      let at = n;
      while (at.replyToId && byId.has(at.replyToId) && !passed.has(at.id)) {
        passed.add(at.id);
        at = byId.get(at.replyToId)!;
      }
      return at.id;
    };
    const here = incoming.filter((x) => x.photo.id === item.photo.id);
    const roots = new Set(here.map((x) => rootOf(x.narration)));
    for (const x of here) {
      const q = x.answeredMine && byId.get(x.answeredMine.id);
      if (q) roots.add(rootOf(q));
    }
    groups.push({ item, narrations: item.narrations.filter((n) => roots.has(rootOf(n))), latestAt: r.narration.createdAt });
  }
  return groups;
}

/** まだ見ていない数 */
export const unseenCount = (feed: readonly FeedItem[], meId: string, seenAt: number | null) =>
  unseenReplies(repliesFor(feed, meId), seenAt).length;

/** 届いたものの一番新しい時刻（なければ null） */
export function latestIncomingAt(feed: readonly FeedItem[], meId: string): number | null {
  return repliesFor(feed, meId)[0]?.narration.createdAt ?? null;
}

/** 見た時刻を合わせる。サーバーの記録と、この画面で開いたときの手元の記録の新しい方 */
export function mergeSeenAt(server: number | null, local: number | null): number | null {
  if (server === null) return local;
  if (local === null) return server;
  return Math.max(server, local);
}

/**
 * 開いている間の並び。order（開いたときの写真の ID の並び）を保ち、order にない新しい写真は上に足す
 * （新しく届いた順のため）。消えた写真は除く
 */
export function keepOrderNewFirst<T>(order: readonly string[], items: readonly T[], idOf: (t: T) => string): T[] {
  const byId = new Map(items.map((t) => [idOf(t), t]));
  const known = new Set(order);
  const kept = order.flatMap((id) => {
    const t = byId.get(id);
    return t ? [t] : [];
  });
  return [...items.filter((t) => !known.has(idOf(t))), ...kept];
}

/** バッジの数字（99 を超えたら「99+」） */
export const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
