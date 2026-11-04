// 前の日にこの人の入り口に出した写真を、次の日に続けて出さない（0057）。
// 家族はすべて架空（実在の人のことではない）。
import { describe, expect, it } from "vitest";
import { buildSeedRows } from "../src/server/core/demo-reset";
import { pickEntranceCandidates, type NarrationForEntrance } from "../src/server/core/entrance-claude";
import { ENTRANCE_NO_REPEAT_DAYS, pickFixedPhoto } from "../src/server/core/entrances";
import type { MemberRow, PhotoRow } from "../src/server/core/ports";
import { SEED_MEMBERS, SEED_PHOTOS } from "../src/server/demo/seed";

const photo = (id: string, owner = "other", takenAt: string | null = null): PhotoRow => ({
  id, familyId: "f", ownerMemberId: owner, storageKey: `k-${id}`, contentHash: id, width: 10, height: 10, takenAt, latitude: null, longitude: null, createdAt: 0,
});
const narration = (over: Partial<NarrationForEntrance> & Pick<NarrationForEntrance, "id" | "photoId">): NarrationForEntrance => ({
  speakerMemberId: "other", replyToId: null, kind: "text", transcript: "架空の語り", cleanedText: null, uncertainSpans: null, forDate: "2026-11-04", createdAt: 1, ...over,
});
const me = "me";
const TODAY = "2026-11-05";
const YESTERDAY = "2026-11-04";
// 前の日の入り口（3:00 に作った）と、その後のほかの家族の語り
const shownYesterday = (photoId: string) => ({ photoId, forDate: YESTERDAY, createdAt: 100 });
const ids = (r: ReturnType<typeof pickEntranceCandidates>) => r.map((c) => c.photo.id);

describe("Claude の入り口の候補: 前の日に出した写真を続けない（0057）", () => {
  it("日数は 1", () => expect(ENTRANCE_NO_REPEAT_DAYS).toBe(1));

  it("前の日に出した写真は、その後にほかの家族が語って g1 の条件を満たしても外す", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", speakerMemberId: "aunt", createdAt: 200 }), narration({ id: "n2", photoId: "A", speakerMemberId: "uncle", createdAt: 300 })];
    expect(ids(pickEntranceCandidates(photos, ns, [shownYesterday("A")], me, TODAY))).toEqual(["B"]);
  });

  it("2 日前に出した写真は、g1 の条件を満たせば候補に入る（外すのは前の日だけ）", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 200 })];
    expect(ids(pickEntranceCandidates(photos, ns, [{ photoId: "A", forDate: "2026-11-03", createdAt: 100 }], me, TODAY))).toEqual(["A", "B"]);
  });

  it("g0（この人の語りへの返事が、前の日に出した後に来た写真）は前の日に出していても残る", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [
      narration({ id: "mine", photoId: "A", speakerMemberId: me, createdAt: 150 }),
      narration({ id: "reply", photoId: "A", speakerMemberId: "aunt", replyToId: "mine", createdAt: 200 }),
    ];
    expect(ids(pickEntranceCandidates(photos, ns, [shownYesterday("A")], me, TODAY))).toEqual(["A", "B"]);
  });

  it("家族の写真がそれしかなければ外さない（写真が 1 枚の家族でも入り口を作る）", () => {
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 200 })];
    expect(ids(pickEntranceCandidates([photo("A")], ns, [shownYesterday("A")], me, TODAY))).toEqual(["A"]);
  });

  it("ほかに写真があれば、外して候補が 0 枚でも外す（固定の入り口がほかの写真を出す）", () => {
    // B は 3 日前に出したので 7 日の除外で候補にない。A だけが g1 に残るはずだったが、前の日に出したので外す
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 200 })];
    const past = [shownYesterday("A"), { photoId: "B", forDate: "2026-11-02", createdAt: 50 }];
    expect(pickEntranceCandidates(photos, ns, past, me, TODAY)).toEqual([]);
    expect(pickFixedPhoto(photos, past, me, TODAY)?.id).toBe("B");
  });

  it("前の日の写真を外すのが先。今日ほかの人に出した写真を外すと 0 枚なら、そちらは外さない（0042 のまま）", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 200 })];
    expect(ids(pickEntranceCandidates(photos, ns, [shownYesterday("A")], me, TODAY, new Set(["B"])))).toEqual(["B"]);
  });

  it("今日以降の入り口は前の日として数えない", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 200 })];
    expect(ids(pickEntranceCandidates(photos, ns, [{ photoId: "A", forDate: TODAY, createdAt: 100 }], me, TODAY))).toEqual(["A", "B"]);
  });
});

describe("固定の入り口の写真: 前の日に出した写真を続けない（0057）", () => {
  const ps = [photo("x", "other", "1980-01-01T00:00:00"), photo("y", "other", "1990-01-01T00:00:00")];

  it("最後に出した日がいちばん古いものが前の日の写真なら、ほかの写真を選ぶ", () => {
    // y は今日より後の日付の入り口がある（デモの時計を戻したときなど）。それでも前の日の x は続けない
    const past = [{ photoId: "x", forDate: YESTERDAY }, { photoId: "y", forDate: "2026-11-08" }];
    expect(pickFixedPhoto(ps, past, me)?.id).toBe("x");
    expect(pickFixedPhoto(ps, past, me, TODAY)?.id).toBe("y");
  });

  it("家族の写真がそれしかなければ、前の日の写真でも出す", () => {
    expect(pickFixedPhoto([photo("x")], [{ photoId: "x", forDate: YESTERDAY }], me, TODAY)?.id).toBe("x");
  });

  it("ふだんの並び（まだ使っていない写真が先）は変わらない", () => {
    expect(pickFixedPhoto([...ps, photo("z", "other", "2000-01-01T00:00:00")], [{ photoId: "x", forDate: YESTERDAY }], me, TODAY)?.id).toBe("y");
  });
});

describe("デモの家族の撮影の朝の候補は 0057 の前と同じ（0038 の追記の筋）", () => {
  it("4 人の候補の並びが変わらない。じいちゃんの先頭は P8、前の日に出した Y1 と 3 日前の P5 は入らない", () => {
    const AS_OF = "2026-11-02";
    const people = new Map(SEED_MEMBERS.map((m, i) => [m.calledAs, { id: `m${i}`, calledAs: m.calledAs, role: m.role } as MemberRow]));
    const rows = buildSeedRows("11111111-0000-4000-8000-000000000001", AS_OF, people);
    const label = new Map(rows.photos.map((p, i) => [p.row.id, SEED_PHOTOS[i]!.label]));
    const photos = rows.photos.map((p) => p.row);
    const narrations = rows.narrations.map((n) => n.row);
    const out: Record<string, string[]> = {};
    for (const m of SEED_MEMBERS) {
      const id = people.get(m.calledAs)!.id;
      const past = rows.entrances.filter((e) => e.memberId === id);
      out[m.calledAs] = pickEntranceCandidates(photos, narrations, past, id, AS_OF).map((c) => label.get(c.photo.id)!);
    }
    // 0057 の前のコードで同じ種から出した並び（2026-11-05）
    expect(out).toEqual({
      じいちゃん: ["P8", "P4", "P1", "P2", "P3", "P7"],
      お母さん: ["Y1", "Y2", "P6", "P4", "P5", "Y3"],
      まさとおじさん: ["Y1", "P8", "Y2", "P6", "P4", "P5"],
      ゆい: ["P4", "P8", "Y1", "Y2", "P6", "P1"],
    });
  });
});
