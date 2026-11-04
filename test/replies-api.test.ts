// 「返事」のタブのサーバー側（0058）: members.replies_seen_at の移行、GET /api/feed の repliesSeenAt、POST /api/replies/seen。
// 家族はすべて架空。Claude と文字起こしは偽物
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FeedResult } from "../src/shared/api";
import { repliesFor, unseenReplies } from "../src/shared/replies";
import { createD1Repositories } from "../src/server/platform/cloudflare/d1-repositories";
import { addMember, addPhoto, applyMigration, createFamily, makeTestApp, migrationFiles, postForm, startD1, type TestApp } from "./helpers";

const MIGRATION = "0007_replies_seen.sql";
const NOW = new Date("2026-11-05T01:00:00Z");

describe(`移行 ${MIGRATION}`, () => {
  let d1: D1Database;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ d1, dispose } = await startD1({ before: MIGRATION }));
  }, 60_000);
  afterAll(() => dispose());

  it("前からある人の行は残り、replies_seen_at は null。リポジトリから読み書きできる", async () => {
    expect(migrationFiles()).toContain(MIGRATION);
    await d1.batch([
      d1.prepare("INSERT INTO families (id, is_demo, created_at) VALUES ('f', 1, 0)"),
      d1.prepare("INSERT INTO members (id, family_id, role, relation, called_as, speech_style, created_at) VALUES ('m', 'f', 'elder', '祖母', '架空のばあば', 'standard', 0)"),
    ]);
    for (const f of migrationFiles().filter((f) => f >= MIGRATION)) await applyMigration(d1, f);
    expect((await d1.prepare("SELECT id, replies_seen_at FROM members").all()).results).toEqual([{ id: "m", replies_seen_at: null }]);
    const repos = createD1Repositories(d1);
    expect(await repos.members.get("f", "m")).toMatchObject({ id: "m", calledAs: "架空のばあば" });
    expect(await repos.members.getRepliesSeenAt("f", "m")).toBeNull();
    expect(await repos.members.markRepliesSeen("f", "m", 123)).toBe(true);
    expect(await repos.members.getRepliesSeenAt("f", "m")).toBe(123);
    // ほかの家族の ID では読めず、書けない
    expect(await repos.members.markRepliesSeen("other", "m", 456)).toBe(false);
    expect(await repos.members.getRepliesSeenAt("other", "m")).toBeNull();
    expect(await repos.members.getRepliesSeenAt("f", "m")).toBe(123);
    expect((await d1.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });
});

describe("返事のタブの API", () => {
  let d1: D1Database;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ d1, dispose } = await startD1());
  }, 60_000);
  afterAll(() => dispose());
  afterEach(() => vi.restoreAllMocks());

  const text = async (t: TestApp, cookie: string, photoId: string, replyToId: string | null = null) => {
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId, text: "架空の語り" }));
    const res = await postForm(t, "/api/narrations", form, cookie);
    if (res.status !== 202) throw new Error(`text ${res.status}`);
    return ((await res.json()) as { narration: { id: string } }).narration.id;
  };
  const voice = async (t: TestApp, cookie: string, photoId: string) => {
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "voice", photoId, entranceId: null, replyToId: null, text: null }));
    form.append("audio", new File([new Uint8Array([1, 2, 3])], "a", { type: "audio/webm" }));
    const res = await postForm(t, "/api/narrations", form, cookie);
    if (res.status !== 202) throw new Error(`voice ${res.status}`);
    return ((await res.json()) as { narration: { id: string } }).narration.id;
  };
  const feed = async (t: TestApp, cookie: string) => {
    const res = await t.app.request("/api/feed", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    return (await res.json()) as FeedResult;
  };
  const seen = (t: TestApp, cookie: string, init: RequestInit = {}) =>
    t.app.request("/api/replies/seen", { method: "POST", ...init, headers: { Cookie: cookie, ...(init.headers ?? {}) } });

  /** 母（家族の画面）とばあば（祖父母の画面）。ばあばの写真一枚と、母の写真一枚 */
  async function setup() {
    const t = makeTestApp(d1, { now: NOW });
    const f = await createFamily(t);
    const mom = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のおかあさん" });
    const elder = await addMember(t, mom.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
    const elderPhoto = await addPhoto(t, elder.cookie, 7001);
    const momPhoto = await addPhoto(t, mom.cookie, 7002);
    return { t, familyId: f.familyId, mom, elder, elderPhoto: elderPhoto.id, momPhoto: momPhoto.id };
  }

  it("まだ一度も開いていなければ repliesSeenAt は null。feed に一覧の材料（持ち主・返事の先・話した人・時刻）がある", async () => {
    const s = await setup();
    const mine = await text(s.t, s.elder.cookie, s.momPhoto);
    s.t.setNow(new Date(NOW.getTime() + 1000));
    const reply = await text(s.t, s.mom.cookie, s.momPhoto, mine);
    s.t.setNow(new Date(NOW.getTime() + 2000));
    const onElderPhoto = await voice(s.t, s.mom.cookie, s.elderPhoto); // 声の語りも数える（文字起こしの状態によらないことは test/replies.test.ts）

    const f = await feed(s.t, s.elder.cookie);
    expect(f.repliesSeenAt).toBeNull();
    const items = repliesFor(f.items, s.elder.id);
    expect(items.map((r) => r.narration.id)).toEqual([onElderPhoto, reply]);
    expect(items[0]!.narration.kind).toBe("voice");
    expect(unseenReplies(items, f.repliesSeenAt)).toHaveLength(2);
    // 母の側: ばあばの語り（母の写真への語り）が一つ
    expect(repliesFor((await feed(s.t, s.mom.cookie)).items, s.mom.id).map((r) => r.narration.id)).toEqual([mine]);
  });

  it("POST /api/replies/seen は 204・本文なしで、サーバーの今の時刻を入れる。クライアントの時刻は使わない。人ごと", async () => {
    const s = await setup();
    await text(s.t, s.mom.cookie, s.elderPhoto);
    const log = vi.spyOn(console, "log");
    const seenAtMs = NOW.getTime() + 5000;
    s.t.setNow(new Date(seenAtMs));
    const res = await seen(s.t, s.elder.cookie, {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seenAt: 9_999_999_999_999 }),
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    const f = await feed(s.t, s.elder.cookie);
    expect(f.repliesSeenAt).toBe(seenAtMs);
    expect(unseenReplies(repliesFor(f.items, s.elder.id), f.repliesSeenAt)).toEqual([]);
    // 母はまだ開いていない
    expect((await feed(s.t, s.mom.cookie)).repliesSeenAt).toBeNull();
    // ログは ID だけ
    const lines = log.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("replies_seen"));
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ event: "replies_seen", familyId: s.familyId, memberId: s.elder.id }]);

    // 見た後の語りは未読になる。もう一度開けば時刻が進む
    s.t.setNow(new Date(seenAtMs + 1000));
    const later = await text(s.t, s.mom.cookie, s.elderPhoto);
    const f2 = await feed(s.t, s.elder.cookie);
    expect(unseenReplies(repliesFor(f2.items, s.elder.id), f2.repliesSeenAt).map((r) => r.narration.id)).toEqual([later]);
    s.t.setNow(new Date(seenAtMs + 2000));
    expect((await seen(s.t, s.elder.cookie)).status).toBe(204);
    expect((await feed(s.t, s.elder.cookie)).repliesSeenAt).toBe(seenAtMs + 2000);
  });

  it("ほかの家族の人が開いても、この家族の人の時刻は変わらない。合言葉なしは 401、最初の人のリンクの端末は 403", async () => {
    const s = await setup();
    const other = await createFamily(s.t);
    const otherMember = await addMember(s.t, other.cookie, { calledAs: "架空のよその人" });
    expect((await seen(s.t, otherMember.cookie)).status).toBe(204);
    expect((await feed(s.t, s.elder.cookie)).repliesSeenAt).toBeNull();
    expect((await feed(s.t, s.mom.cookie)).repliesSeenAt).toBeNull();
    const row = await d1.prepare("SELECT replies_seen_at FROM members WHERE id = ?").bind(otherMember.id).first<{ replies_seen_at: number }>();
    expect(row!.replies_seen_at).toBe(NOW.getTime());
    // よその家族の feed には、この家族の語りも時刻も出ない
    expect((await feed(s.t, otherMember.cookie)).items).toEqual([]);

    expect((await s.t.app.request("/api/replies/seen", { method: "POST" })).status).toBe(401);
    const empty = await createFamily(s.t);
    expect((await seen(s.t, empty.cookie)).status).toBe(403);
    expect((await d1.prepare("SELECT COUNT(*) AS n FROM members WHERE family_id = ?").bind(empty.familyId).first<{ n: number }>())!.n).toBe(0);
  });

  it("GET では開けない（POST だけ）", async () => {
    const s = await setup();
    const res = await s.t.app.request("/api/replies/seen", { headers: { Cookie: s.elder.cookie } });
    expect(res.status).toBe(404);
    expect((await feed(s.t, s.elder.cookie)).repliesSeenAt).toBeNull();
  });
});
