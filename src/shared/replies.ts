// 「返事」のタブ（0058）。一覧と未読の数を、GET /api/feed の応答から作る。クライアントが使い、サーバーは数を返さない。
// その人（me）について、次の語りを一つずつ（重なりは一つに数える）:
//   (a) me の語りへの、ほかの人の返事（replyToId が me の語り）
//   (b) me が入れた写真（photo.ownerMemberId が me）への、ほかの人の語り（返事でないものも、返事も）
// 自分の語りは数えない。声の語りは文字起こしの状態（pending・failed）に関わらず数える。返事の返事は (a) の一段だけを見る
import type { FeedItem, FeedNarration, Photo } from "./api";

export type ReplyItem = {
  photo: Photo;
  narration: FeedNarration;
  /** narration が返事なら、返した先の語り（feed にあれば）。返事でなければ null */
  repliedTo: FeedNarration | null;
  /** (a) me の語りへの返事か */
  toMyNarration: boolean;
  /** (b) me が入れた写真への語りか */
  onMyPhoto: boolean;
};

/** me についての返事の一覧。新しい順（同じ時刻は ID の順で、毎回同じ並び） */
export function repliesFor(feed: readonly FeedItem[], meId: string): ReplyItem[] {
  const byId = new Map<string, FeedNarration>();
  for (const item of feed) for (const n of item.narrations) byId.set(n.id, n);
  const out: ReplyItem[] = [];
  for (const item of feed) {
    const onMyPhoto = item.photo.ownerMemberId === meId;
    for (const n of item.narrations) {
      if (n.speakerMemberId === meId) continue;
      const repliedTo = n.replyToId ? (byId.get(n.replyToId) ?? null) : null;
      const toMyNarration = repliedTo?.speakerMemberId === meId;
      if (!toMyNarration && !onMyPhoto) continue;
      out.push({ photo: item.photo, narration: n, repliedTo, toMyNarration, onMyPhoto });
    }
  }
  return out.sort((x, y) => y.narration.createdAt - x.narration.createdAt || (x.narration.id < y.narration.id ? -1 : x.narration.id > y.narration.id ? 1 : 0));
}

/** まだ見ていないもの（seenAt より後に作られたもの）。seenAt が null なら、すべて */
export function unseenReplies(items: readonly ReplyItem[], seenAt: number | null): ReplyItem[] {
  return seenAt === null ? [...items] : items.filter((r) => r.narration.createdAt > seenAt);
}
