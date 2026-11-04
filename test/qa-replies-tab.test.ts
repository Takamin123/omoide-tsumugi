// qa: 「返事」のタブのサーバー側（0058）の抜けを確かめる。test/replies-api.test.ts を補う。
// 二度呼び、本文の無視、人の直し・リンクの作り直しで時刻が消えないこと、PATCH から時刻を書けないこと。家族はすべて架空
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FeedResult } from "../src/shared/api";
import { addMember, createFamily, makeTestApp, memberLinkCookie, startD1, type TestApp } from "./helpers";

const NOW = new Date("2026-11-05T01:00:00Z");

describe("返事のタブ（qa）", () => {
  let d1: D1Database;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ d1, dispose } = await startD1());
  }, 60_000);
  afterAll(() => dispose());

  const seenAt = async (t: TestApp, cookie: string) => {
    const res = await t.app.request("/api/feed", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as FeedResult).repliesSeenAt;
  };
  const seen = (t: TestApp, cookie: string, init: RequestInit = {}) =>
    t.app.request("/api/replies/seen", { method: "POST", ...init, headers: { Cookie: cookie, ...(init.headers ?? {}) } });
  const row = async (id: string) => d1.prepare("SELECT * FROM members WHERE id = ?").bind(id).first<Record<string, unknown>>();

  async function setup() {
    const t = makeTestApp(d1, { now: NOW });
    const f = await createFamily(t);
    const mom = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のおかあさん" });
    const elder = await addMember(t, mom.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
    return { t, mom, elder };
  }

  it("同じ時刻に二度呼んでも 204 で、値は同じ。人の行のほかの列は変わらない", async () => {
    const s = await setup();
    const before = await row(s.elder.id);
    expect((await seen(s.t, s.elder.cookie)).status).toBe(204);
    expect((await seen(s.t, s.elder.cookie)).status).toBe(204);
    expect(await seenAt(s.t, s.elder.cookie)).toBe(NOW.getTime());
    expect(await row(s.elder.id)).toEqual({ ...before, replies_seen_at: NOW.getTime() });
  });

  it("壊れた本文・JSON でない本文でも、本文は読まずに 204 でサーバーの時刻を入れる", async () => {
    const s = await setup();
    const a = await seen(s.t, s.mom.cookie, { headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(a.status).toBe(204);
    const b = await seen(s.t, s.mom.cookie, { headers: { "Content-Type": "text/plain" }, body: "4102444800000" });
    expect(b.status).toBe(204);
    expect(await seenAt(s.t, s.mom.cookie)).toBe(NOW.getTime());
  });

  it("feed の repliesSeenAt はこの端末の人の値だけ（ほかの人の値は出ない）", async () => {
    const s = await setup();
    expect((await seen(s.t, s.mom.cookie)).status).toBe(204);
    expect(await seenAt(s.t, s.elder.cookie)).toBeNull();
    // 家族のこと（人の一覧）にも出ない
    const res = await s.t.app.request("/api/family", { headers: { Cookie: s.mom.cookie } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toMatch(/repliesSeenAt|replies_seen_at/);
  });

  it("人を直しても（PATCH）、リンクを作り直しても、見た時刻は消えない。PATCH の本文に時刻を入れても書けない", async () => {
    const s = await setup();
    expect((await seen(s.t, s.elder.cookie)).status).toBe(204);
    const patch = await s.t.app.request(`/api/members/${s.elder.id}`, {
      method: "PATCH",
      headers: { Cookie: s.mom.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "elder",
        relation: "祖母",
        calledAs: "架空のおばあちゃん",
        speechStyle: "dialect",
        dialectRegion: "架空の地方",
        setUpByMemberId: null,
        repliesSeenAt: 1,
        replies_seen_at: 1,
      }),
    });
    expect(patch.status).toBe(200);
    expect(JSON.stringify(await patch.json())).not.toMatch(/repliesSeenAt|replies_seen_at/);
    expect((await row(s.elder.id))!.replies_seen_at).toBe(NOW.getTime());

    const newCookie = await memberLinkCookie(s.t, s.mom.cookie, s.elder.id);
    expect(await seenAt(s.t, newCookie)).toBe(NOW.getTime());
  });

  it("前のリンク（作り直して使えなくなったもの）では呼べず、時刻は変わらない", async () => {
    const s = await setup();
    await memberLinkCookie(s.t, s.mom.cookie, s.elder.id);
    s.t.setNow(new Date(NOW.getTime() + 1000));
    const res = await seen(s.t, s.elder.cookie);
    expect([401, 403]).toContain(res.status);
    expect((await row(s.elder.id))!.replies_seen_at).toBeNull();
  });
});
