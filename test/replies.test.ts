// 「返事」のタブの一覧と未読（src/shared/replies.ts。0058）。家族はすべて架空
import { describe, expect, it } from "vitest";
import type { FeedItem, FeedNarration, Photo } from "../src/shared/api";
import { repliesFor, unseenReplies } from "../src/shared/replies";

const photo = (id: string, owner: string): Photo => ({
  id,
  ownerMemberId: owner,
  width: 1,
  height: 1,
  takenAt: null,
  hasLocation: false,
  place: null,
  imageUrl: `/api/photos/${id}/image`,
});
const n = (id: string, photoId: string, speaker: string, createdAt: number, extra: Partial<FeedNarration> = {}): FeedNarration => ({
  id,
  speakerMemberId: speaker,
  photoId,
  entranceId: null,
  replyToId: null,
  kind: "text",
  audioUrl: null,
  durationMs: null,
  transcriptStatus: "done",
  text: "架空の語り",
  forDate: "2026-11-05",
  createdAt,
  quotedFrom: null,
  ...extra,
});
const item = (p: Photo, narrations: FeedNarration[]): FeedItem => ({ photo: p, narrations, addedPhotos: [] });

// me = ばあば。P1 はばあばの写真、P2 はまごの写真
const P1 = photo("P1", "me");
const P2 = photo("P2", "gc");
const feed: FeedItem[] = [
  item(P2, [
    n("mine-on-p2", "P2", "me", 10), // 自分の語り（数えない）
    n("reply-to-me", "P2", "mom", 20, { replyToId: "mine-on-p2" }), // (a)
    n("other-on-p2", "P2", "mom", 30), // ほかの人の写真へのほかの人の語り（数えない）
    n("reply-to-other", "P2", "gc", 40, { replyToId: "other-on-p2" }), // ほかの人への返事（数えない）
    n("self-reply", "P2", "me", 45, { replyToId: "mine-on-p2" }), // 自分で自分に返した（数えない）
  ]),
  item(P1, [
    n("on-my-photo", "P1", "gc", 50), // (b) 返事でない
    n("mine-on-p1", "P1", "me", 55),
    n("both", "P1", "mom", 60, { replyToId: "mine-on-p1" }), // (a)(b) の重なり。一つに数える
    n("voice-pending", "P1", "gc", 70, { kind: "voice", text: null, transcriptStatus: "pending", audioUrl: "/a" }), // 声は文字起こし前でも数える
    n("voice-failed", "P1", "mom", 80, { kind: "voice", text: null, transcriptStatus: "failed", audioUrl: "/b" }),
    n("reply-on-my-photo", "P1", "gc", 90, { replyToId: "on-my-photo" }), // (b) 返事でも
  ]),
];

describe("repliesFor", () => {
  it("(a) 自分の語りへの返事と (b) 自分の写真への語りを、重なりは一つにして、新しい順に返す。自分の語りは入れない", () => {
    const got = repliesFor(feed, "me");
    expect(got.map((r) => r.narration.id)).toEqual(["reply-on-my-photo", "voice-failed", "voice-pending", "both", "on-my-photo", "reply-to-me"]);
    const both = got.find((r) => r.narration.id === "both")!;
    expect(both).toMatchObject({ toMyNarration: true, onMyPhoto: true, photo: P1 });
    expect(both.repliedTo?.id).toBe("mine-on-p1");
    expect(got.find((r) => r.narration.id === "reply-to-me")).toMatchObject({ toMyNarration: true, onMyPhoto: false, photo: P2 });
    expect(got.find((r) => r.narration.id === "on-my-photo")).toMatchObject({ toMyNarration: false, onMyPhoto: true, repliedTo: null });
    expect(got.find((r) => r.narration.id === "reply-on-my-photo")).toMatchObject({ toMyNarration: false, onMyPhoto: true });
  });

  it("返した先が feed にない返事は (a) にならない（写真が自分のものなら (b) で入る）", () => {
    const f = [item(P2, [n("x", "P2", "mom", 1, { replyToId: "missing" })]), item(P1, [n("y", "P1", "mom", 2, { replyToId: "missing" })])];
    expect(repliesFor(f, "me").map((r) => [r.narration.id, r.repliedTo])).toEqual([["y", null]]);
  });

  it("人によって一覧が違う。何もなければ空", () => {
    expect(repliesFor(feed, "gc").map((r) => r.narration.id)).toEqual(["self-reply", "other-on-p2", "reply-to-me", "mine-on-p2"]);
    expect(repliesFor([], "me")).toEqual([]);
    expect(repliesFor(feed, "nobody")).toEqual([]);
  });

  it("同じ時刻は ID の順で、毎回同じ並び", () => {
    const f = [item(P1, [n("b", "P1", "gc", 5), n("a", "P1", "mom", 5)])];
    expect(repliesFor(f, "me").map((r) => r.narration.id)).toEqual(["a", "b"]);
  });
});

describe("unseenReplies", () => {
  const all = repliesFor(feed, "me");
  it("seenAt が null なら、すべて未読", () => {
    expect(unseenReplies(all, null)).toHaveLength(6);
  });
  it("seenAt より後に作られたものだけ（ちょうど同じ時刻は見たことにする）", () => {
    expect(unseenReplies(all, 60).map((r) => r.narration.id)).toEqual(["reply-on-my-photo", "voice-failed", "voice-pending"]);
    expect(unseenReplies(all, 90)).toEqual([]);
  });
});
