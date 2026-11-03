// 毎朝の処理とデモの時計（docs/implementation-policy.md 5 の 4 番目: Cron とボタンが同じ関数を通る）。
// Cron（scheduled）が runMorning を呼ぶことは entry.test.ts で確かめる。ここではボタンも同じ runMorning を通ることと、中身を確かめる。
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../src/server/core/ports";

vi.mock("../src/server/core/morning", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/core/morning")>();
  const runMorning = vi.fn(actual.runMorning);
  return { ...actual, runMorning };
});

const { runMorning } = await import("../src/server/core/morning");
const { addMember, addPhoto, createFamily, makeTestApp, postForm, startD1 } = await import("./helpers");
type TestApp = ReturnType<typeof makeTestApp>;

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());
beforeEach(() => {
  vi.mocked(runMorning).mockClear();
});

const advance = (app: TestApp, cookie: string) => app.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: cookie } });
const today = async (app: TestApp, cookie: string) =>
  (await (await app.app.request("/api/entrances/today", { headers: { Cookie: cookie } })).json()) as {
    entrance: null | { id: string; memberId: string; forDate: string; photo: { id: string }; quote: null | { text: string; narrationId: string }; question: null | string };
  };
const entranceCount = async (familyId: string) =>
  (await d1.prepare("SELECT COUNT(*) AS n FROM entrances WHERE family_id = ?").bind(familyId).first<{ n: number }>())!.n;

describe("runMorning", () => {
  it("一人ひとりに固定の入り口を一つ作る。同じ日に二度呼んでも一つ", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    const b = await addMember(t, a.cookie, { relation: "孫", calledAs: "けん" });
    await addPhoto(t, a.cookie, 1);
    await addPhoto(t, b.cookie, 2);
    const now = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00
    const s1 = await runMorning(t.deps, now, { familyId: f.familyId });
    expect(s1).toMatchObject({ created: 2, existing: 0, failed: [] });
    const s2 = await runMorning(t.deps, now, { familyId: f.familyId });
    expect(s2).toMatchObject({ created: 0, existing: 2 });
    const rows = await d1.prepare("SELECT member_id, for_date, kind, question FROM entrances WHERE family_id = ?").bind(f.familyId).all();
    expect(rows.results).toHaveLength(2);
    for (const r of rows.results) expect(r).toMatchObject({ for_date: "2026-11-03", kind: "fixed", question: null });
  });

  it("写真はほかの家族のライブラリから。撮影日の古い順。添える言葉はその写真の最新の語り", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    const b = await addMember(t, a.cookie, { relation: "祖父", calledAs: "じいじ" });
    await addPhoto(t, a.cookie, 10, { takenAt: "1970-01-01T00:00:00" }); // 自分の、いちばん古い写真
    const newer = await addPhoto(t, b.cookie, 11, { takenAt: "1990-05-05T00:00:00" });
    const older = await addPhoto(t, b.cookie, 12, { takenAt: "1980-05-05T00:00:00" });
    const say = async (text: string, at: string) => {
      t.setNow(new Date(at));
      const form = new FormData();
      form.append("meta", JSON.stringify({ kind: "text", photoId: older.id, entranceId: null, replyToId: null, text }));
      await postForm(t, "/api/narrations", form, b.cookie);
    };
    await say("架空のはじめの語り", "2026-11-01T00:00:00Z");
    await say("架空のあとの語り", "2026-11-01T01:00:00Z");
    t.setNow(new Date("2026-11-02T00:00:00Z"));

    const e1 = (await today(t, a.cookie)).entrance!;
    expect(e1.photo.id).toBe(older.id);
    expect(e1.quote?.text).toBe("架空のあとの語り");
    expect(e1.question).toBeNull();

    // 次の日は、まだ使っていない写真
    t.setNow(new Date("2026-11-03T00:00:00Z"));
    expect((await today(t, a.cookie)).entrance!.photo.id).toBe(newer.id);
    t.setNow(new Date("2026-11-02T00:00:00Z"));
  });

  it("写真が一枚もなければ、入り口は null（作らない）", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    expect((await today(t, a.cookie)).entrance).toBeNull();
    expect(await runMorning(t.deps, new Date(), { familyId: f.familyId })).toMatchObject({ noPhoto: 1, created: 0 });
  });

  it("開いたときに入り口がなければその場で作り、一度見せたら同じものを返す", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    await addPhoto(t, a.cookie, 1);
    const first = (await today(t, a.cookie)).entrance!;
    const again = (await today(t, a.cookie)).entrance!;
    expect(again.id).toBe(first.id);
    const shown = await d1.prepare("SELECT shown_at FROM entrances WHERE id = ?").bind(first.id).first<{ shown_at: number }>();
    expect(shown?.shown_at).toBe(new Date("2026-11-02T00:00:00Z").getTime());
  });

  it("入り口は cookie の人のもの。memberId のクエリを付けても、ほかの人の入り口は引けない（0036）", async () => {
    const f = await createFamily(t);
    const ma = await addMember(t, f.cookie);
    const mb = await addMember(t, ma.cookie, { relation: "孫", calledAs: "けん" });
    await addPhoto(t, ma.cookie, 1);
    const res = await t.app.request(`/api/entrances/today?memberId=${ma.id}`, { headers: { Cookie: mb.cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { entrance: { memberId: string } }).entrance.memberId).toBe(mb.id);
    expect((await d1.prepare("SELECT member_id FROM entrances WHERE family_id = ?").bind(f.familyId).all()).results).toEqual([{ member_id: mb.id }]);
  });

  it("familyId を渡さないとき（Cron）は、時計を持たない家族だけを回す", async () => {
    const real = await createFamily(t);
    const demo = await createFamily(t, true);
    const rm = await addMember(t, real.cookie);
    const dm = await addMember(t, demo.cookie);
    await addPhoto(t, rm.cookie, 1);
    await addPhoto(t, dm.cookie, 1);
    await runMorning(t.deps, new Date("2026-11-02T21:00:00Z"));
    expect(await entranceCount(real.familyId)).toBe(1);
    expect(await entranceCount(demo.familyId)).toBe(0);
  });

  it("一人が失敗しても、残りの人は続ける。全員が失敗したら全体を失敗にする", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    const b = await addMember(t, a.cookie);
    await addPhoto(t, a.cookie, 1);
    const failing = (ids: string[]): AppDeps => ({
      ...t.deps,
      repos: {
        ...t.deps.repos,
        entrances: {
          ...t.deps.repos.entrances,
          get: async (fid, mid, d) => {
            if (ids.includes(mid)) throw new TypeError("boom");
            return t.deps.repos.entrances.get(fid, mid, d);
          },
        },
      },
    });
    const s = await runMorning(failing([a.id]), new Date("2026-11-05T00:00:00Z"), { familyId: f.familyId });
    expect(s).toMatchObject({ created: 1, failed: [{ memberId: a.id, kind: "TypeError" }] });
    await expect(runMorning(failing([a.id, b.id]), new Date("2026-11-06T00:00:00Z"), { familyId: f.familyId })).rejects.toThrow(
      "morning_all_failed",
    );
  });
});

describe("デモの時計", () => {
  it("朝 → 昼 → 夜 → 翌朝。翌朝になったときだけ、Cron と同じ runMorning をその家族について呼ぶ", async () => {
    const f = await createFamily(t, true);
    const m = await addMember(t, f.cookie);
    await addPhoto(t, m.cookie, 1);
    const clocks = [];
    for (let i = 0; i < 3; i++) clocks.push(((await (await advance(t, m.cookie)).json()) as { clock: unknown }).clock);
    expect(clocks).toEqual([
      { date: "2026-11-02", slot: "noon" },
      { date: "2026-11-02", slot: "night" },
      { date: "2026-11-03", slot: "morning" },
    ]);
    expect(runMorning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runMorning).mock.calls[0]![2]).toEqual({ familyId: f.familyId });
    const row = await d1.prepare("SELECT for_date FROM entrances WHERE family_id = ?").bind(f.familyId).all();
    expect(row.results).toEqual([{ for_date: "2026-11-03" }]);
    // 時計の日付が「今日」になる
    expect((await today(t, m.cookie)).entrance!.forDate).toBe("2026-11-03");
  });

  it("時計を持たない家族（手元）は、今の日本時間を起点に進める", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    t.setNow(new Date("2026-11-02T09:00:00Z")); // 日本時間 18:00 = 夜
    const r = (await (await advance(t, m.cookie)).json()) as { clock: unknown };
    expect(r.clock).toEqual({ date: "2026-11-03", slot: "morning" });
    t.setNow(new Date("2026-11-02T00:00:00Z"));
    const view = (await (await t.app.request("/api/family", { headers: { Cookie: m.cookie } })).json()) as { family: { clock: unknown } };
    expect(view.family.clock).toEqual({ date: "2026-11-03", slot: "morning" });
  });

  it("本番では、デモでない家族は 404 not_demo（時計は変わらない）", async () => {
    const prod = makeTestApp(d1, { appEnv: "production" });
    const real = await createFamily(prod);
    const rm = await addMember(prod, real.cookie);
    const res = await advance(prod, rm.cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_demo" });
    const row = await d1.prepare("SELECT clock_date FROM families WHERE id = ?").bind(real.familyId).first();
    expect(row).toEqual({ clock_date: null });
    const demo = await createFamily(prod, true);
    const dm = await addMember(prod, demo.cookie);
    expect((await advance(prod, dm.cookie)).status).toBe(200);
  });
});
