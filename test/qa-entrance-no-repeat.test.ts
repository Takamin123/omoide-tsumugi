// QA が足した、前の日に出した写真を次の日に続けて出さない（0057）の確かめ。家族はすべて架空。Claude は偽物。
// 実装側のテスト（entrance-no-repeat.test.ts）で見ていない所: 毎朝の処理（ensureMorningEntrance）を手元の D1 で通したときの倒れ方、
// 境界（forDate-1 と forDate-2 の入り口が両方ある、forDate より後の入り口、同じ日に複数の入り口の行）、avoidPhotoIds と g0 の重なり、
// pickFixedPhoto を forDate なしで呼んだときに前と同じこと。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { ensureMorningEntrance, pickEntranceCandidates, type NarrationForEntrance } from "../src/server/core/entrance-claude";
import { pickFixedPhoto, shownSince } from "../src/server/core/entrances";
import type { ClaudeClient, PhotoRow } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, fakeClaude, makeTestApp, onlyPurpose, postForm, startD1, type FakeClaudeReply, type FakeClaudeRequest } from "./helpers";

const photo = (id: string, owner = "other", takenAt: string | null = null): PhotoRow => ({
  id, familyId: "f", ownerMemberId: owner, storageKey: `k-${id}`, contentHash: id, width: 10, height: 10, takenAt, latitude: null, longitude: null, createdAt: 0,
});
const narration = (over: Partial<NarrationForEntrance> & Pick<NarrationForEntrance, "id" | "photoId">): NarrationForEntrance => ({
  speakerMemberId: "other", replyToId: null, kind: "text", transcript: "架空の語り", cleanedText: null, uncertainSpans: null, forDate: "2026-11-04", createdAt: 1, ...over,
});
const me = "me";
const TODAY = "2026-11-05";
const ids = (r: ReturnType<typeof pickEntranceCandidates>) => r.map((c) => c.photo.id);

describe("QA shownSince の境界", () => {
  it("from ちょうどは入り、until ちょうどとその後は入らない", () => {
    const past = [
      { photoId: "d-2", forDate: "2026-11-03" },
      { photoId: "d-1", forDate: "2026-11-04" },
      { photoId: "d0", forDate: "2026-11-05" },
      { photoId: "d+1", forDate: "2026-11-06" },
    ];
    expect([...shownSince(past, "2026-11-04", TODAY)]).toEqual(["d-1"]);
  });
});

describe("QA pickEntranceCandidates の境界（0057）", () => {
  it("同じ写真を 2 日前と前の日に出していれば、前の日の分で外れる", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 500 })];
    const past = [
      { photoId: "A", forDate: "2026-11-03", createdAt: 10 },
      { photoId: "A", forDate: "2026-11-04", createdAt: 20 },
    ];
    expect(ids(pickEntranceCandidates(photos, ns, past, me, TODAY))).toEqual(["B"]);
  });

  it("forDate より後の入り口（デモの時計を戻したときなど）は前の日として数えない", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 500 })];
    expect(ids(pickEntranceCandidates(photos, ns, [{ photoId: "A", forDate: "2026-11-06", createdAt: 10 }], me, TODAY))).toEqual(["A", "B"]);
  });

  it("前の日の g0 と、ほかの写真の g1 が両方あれば g0 が先", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [
      narration({ id: "mine", photoId: "A", speakerMemberId: me, createdAt: 150 }),
      narration({ id: "reply", photoId: "A", speakerMemberId: "aunt", replyToId: "mine", createdAt: 200 }),
      narration({ id: "nb", photoId: "B", speakerMemberId: "aunt", createdAt: 300 }),
    ];
    expect(ids(pickEntranceCandidates(photos, ns, [{ photoId: "A", forDate: "2026-11-04", createdAt: 100 }], me, TODAY))).toEqual(["A", "B"]);
  });

  it("前の日に出した後の返事が、前の日に出す前のもの（g0 にならない）なら外す", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [
      narration({ id: "mine", photoId: "A", speakerMemberId: me, createdAt: 50 }),
      narration({ id: "reply", photoId: "A", speakerMemberId: "aunt", replyToId: "mine", createdAt: 60 }),
    ];
    expect(ids(pickEntranceCandidates(photos, ns, [{ photoId: "A", forDate: "2026-11-04", createdAt: 100 }], me, TODAY))).toEqual(["B"]);
  });

  it("前の日の g0 だけが候補で、それを今日ほかの人に出していても、外すと 0 枚なので残る（0042）", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [
      narration({ id: "mine", photoId: "A", speakerMemberId: me, createdAt: 150 }),
      narration({ id: "reply", photoId: "A", speakerMemberId: "aunt", replyToId: "mine", createdAt: 200 }),
    ];
    // B は 3 日前に出して、その後の語りがない（7 日の除外）
    const past = [{ photoId: "A", forDate: "2026-11-04", createdAt: 100 }, { photoId: "B", forDate: "2026-11-02", createdAt: 10 }];
    expect(ids(pickEntranceCandidates(photos, ns, past, me, TODAY, new Set(["A"])))).toEqual(["A"]);
  });

  it("avoidPhotoIds で 0 枚に戻っても、前の日の写真は戻らない", () => {
    const photos = [photo("A"), photo("B"), photo("C")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 500 })];
    const past = [{ photoId: "A", forDate: "2026-11-04", createdAt: 10 }, { photoId: "C", forDate: "2026-11-03", createdAt: 5 }];
    // 候補は B だけ。B を避けると 0 枚なので B を残す。A は入らない
    expect(ids(pickEntranceCandidates(photos, ns, past, me, TODAY, new Set(["B"])))).toEqual(["B"]);
  });

  it("写真が 1 枚の家族で、その写真を今日ほかの人に出していても候補にする", () => {
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 500 })];
    expect(ids(pickEntranceCandidates([photo("A")], ns, [{ photoId: "A", forDate: "2026-11-04", createdAt: 10 }], me, TODAY, new Set(["A"])))).toEqual(["A"]);
  });

  it("写真が 2 枚で、2 枚とも前の日の入り口の行があれば（同じ日に行が二つ）外さない", () => {
    const photos = [photo("A"), photo("B")];
    const ns = [narration({ id: "n1", photoId: "A", createdAt: 500 })];
    const past = [{ photoId: "A", forDate: "2026-11-04", createdAt: 10 }, { photoId: "B", forDate: "2026-11-04", createdAt: 11 }];
    expect(ids(pickEntranceCandidates(photos, ns, past, me, TODAY))).toEqual(["A"]);
  });

  it("写真が 0 枚なら 0 枚", () => {
    expect(pickEntranceCandidates([], [], [], me, TODAY)).toEqual([]);
  });
});

describe("QA pickFixedPhoto の境界（0057）", () => {
  const x = photo("x", "other", "1980-01-01T00:00:00");
  const y = photo("y", "other", "1990-01-01T00:00:00");

  it("写真 2 枚で両方使った: 前の日が x、2 日前が y なら y（もとの選び方と同じ）", () => {
    const past = [{ photoId: "x", forDate: "2026-11-04" }, { photoId: "y", forDate: "2026-11-03" }];
    expect(pickFixedPhoto([x, y], past, me, TODAY)?.id).toBe("y");
  });

  it("forDate を渡さなければ前のとおり（前の日の写真でも、最後に出した日がいちばん古ければ選ぶ）", () => {
    const past = [{ photoId: "x", forDate: "2026-11-04" }, { photoId: "y", forDate: "2026-11-09" }];
    expect(pickFixedPhoto([x, y], past, me)?.id).toBe("x");
  });

  it("今日の入り口の行（forDate ちょうど）は前の日として数えない", () => {
    const past = [{ photoId: "x", forDate: TODAY }, { photoId: "y", forDate: "2026-11-09" }];
    expect(pickFixedPhoto([x, y], past, me, TODAY)?.id).toBe("x");
  });

  it("2 日前の写真は避けない", () => {
    const past = [{ photoId: "x", forDate: "2026-11-03" }, { photoId: "y", forDate: "2026-11-09" }];
    expect(pickFixedPhoto([x, y], past, me, TODAY)?.id).toBe("x");
  });
});

// ---- 毎朝の処理を手元の D1 で通す ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
});
afterAll(() => dispose());

const MODEL = "claude-sonnet-qa-fake";
const QUESTION = "この日のことを、聞かせてください";
const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00
const FOR_DATE = "2026-11-03";
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");
const reply = (photoId: string): FakeClaudeReply => ({
  kind: "json",
  value: { receiver_present: "yes", reason: "架空", photo_id: photoId, focus: null, quote: null, question: QUESTION },
  model: MODEL,
  inputTokens: 100,
  outputTokens: 10,
});

/** 母（家族の画面）と祖母。母の写真 n 枚。replies は写真の ID の並びから作る */
async function setup(nPhotos: number, replies: (photoIds: string[]) => FakeClaudeReply[]) {
  let inner: ClaudeClient = notConfiguredClaude;
  const late: ClaudeClient = {
    call: (req) => inner.call(req),
    createBatch: (req) => inner.createBatch(req),
    getBatch: (id) => inner.getBatch(id),
    getBatchResults: (req) => inner.getBatchResults(req),
  };
  const t = makeTestApp(d1, { claude: late });
  const f = await createFamily(t);
  const mother = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のはは" });
  const elder = await addMember(t, mother.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば", speechStyle: "dialect", dialectRegion: "架空の地方" });
  const photoIds: string[] = [];
  for (let i = 0; i < nPhotos; i++) photoIds.push((await addPhoto(t, mother.cookie, 100 + i, { takenAt: `199${i}-05-01T08:00:00` })).id);
  const fake = fakeClaude({ replies: replies(photoIds) });
  inner = onlyPurpose(fake.claude, "entrance");
  const showToElder = (photoId: string, forDate: string, at: number) =>
    t.deps.repos.entrances.insertFixedIfAbsent({ id: crypto.randomUUID(), familyId: f.familyId, memberId: elder.id, forDate, photoId, quoteNarrationId: null, createdAt: at });
  const motherSays = async (photoId: string) => {
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text: "架空の母の語り" }));
    const res = await postForm(t, "/api/narrations", form, mother.cookie);
    expect([201, 202]).toContain(res.status);
    await t.flush();
  };
  return { t, familyId: f.familyId, elder: elder.id, photoIds, requests: fake.requests, showToElder, motherSays };
}

describe("QA 毎朝の処理: 前の日の写真しか Claude の候補がないとき（0057）", () => {
  it("Claude を呼ばずに固定の入り口に倒れ、固定は前の日でない写真を出す", async () => {
    const s = await setup(2, () => []);
    const [a, b] = s.photoIds as [string, string];
    // B は 3 日前に出した（7 日の除外。その後の語りなし）。A は前の日に出した
    await s.showToElder(b, "2026-10-31", 1);
    await s.showToElder(a, "2026-11-02", 2);
    // 前の日に出した後に、母が A に語った（g1 の条件を満たす）
    await s.motherSays(a);
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, FOR_DATE, NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ via: "fixed", fallback: "no_candidates" });
    expect(r.result?.entrance).toMatchObject({ kind: "fixed", photoId: b, forDate: FOR_DATE });
    expect(messageCalls(s.requests)).toHaveLength(0);
  });

  it("その次の日は、前の日の前に出した写真（A）が g1 で Claude の候補に戻る", async () => {
    const s = await setup(2, (p) => [reply(p[0]!)]);
    const [a, b] = s.photoIds as [string, string];
    await s.showToElder(b, "2026-10-31", 1);
    await s.showToElder(a, "2026-11-02", 2);
    await s.motherSays(a);
    // 11/3 に固定で B を出した翌日
    await s.showToElder(b, "2026-11-03", 3);
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, "2026-11-04", NOW.getTime() + 86_400_000, { useClaude: true });
    expect(r).toMatchObject({ via: "claude" });
    expect(r.result?.entrance.photoId).toBe(a);
    const sent = JSON.stringify(messageCalls(s.requests)[0]!.body);
    expect(sent).toContain(a);
    expect(sent).not.toContain(b);
  });

  it("写真が 1 枚の家族は、前の日の写真でも Claude の入り口を作る", async () => {
    const s = await setup(1, (p) => [reply(p[0]!)]);
    const [a] = s.photoIds as [string];
    await s.showToElder(a, "2026-11-02", 2);
    await s.motherSays(a);
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, FOR_DATE, NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ via: "claude" });
    expect(r.result?.entrance.photoId).toBe(a);
    expect(messageCalls(s.requests)).toHaveLength(1);
  });

  it("キーがなくても（固定だけ）、前の日の写真を避ける", async () => {
    const s = await setup(2, () => []);
    const t2 = makeTestApp(d1, { claude: notConfiguredClaude });
    const [a, b] = s.photoIds as [string, string];
    await s.showToElder(b, "2026-10-31", 1);
    await s.showToElder(a, "2026-11-02", 2);
    const r = await ensureMorningEntrance(t2.deps, { id: s.familyId }, { id: s.elder }, FOR_DATE, NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ via: "fixed", fallback: "not_configured" });
    expect(r.result?.entrance.photoId).toBe(b);
  });
});
