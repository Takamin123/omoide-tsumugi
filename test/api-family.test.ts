// 家族の場: 作る、合言葉で入る、家族の様子、一人ひとり。一人ずつのリンクは member-links.test.ts（0036）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, CREATE_TOKEN, createFamily, makeTestApp, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("POST /api/families", () => {
  it("正しい Bearer で家族を作り、合言葉と cookie（HttpOnly, Secure, SameSite=Lax）を返す", async () => {
    const res = await t.app.request("/api/families", json({}, { Authorization: `Bearer ${CREATE_TOKEN}` }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { familyId: string; token: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`omoide_invite=${body.token}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it("合言葉は平文で保存しない", async () => {
    const { token } = await createFamily(t);
    const rows = await d1.prepare("SELECT token_hash FROM invite_links").all<{ token_hash: string }>();
    expect(rows.results.some((r) => r.token_hash === token)).toBe(false);
    expect(rows.results.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash))).toBe(true);
  });

  it.each([
    ["Bearer がない", {}],
    ["違う Bearer", { Authorization: `Bearer ${CREATE_TOKEN}x` }],
    ["Bearer の形でない", { Authorization: CREATE_TOKEN }],
  ])("%s → 401", async (_name, headers) => {
    const res = await t.app.request("/api/families", json({}, headers as Record<string, string>));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("CREATE_FAMILY_TOKEN が設定されていなければ、誰も作れない", async () => {
    const t2 = makeTestApp(d1);
    t2.deps.config.createFamilyToken = null;
    const res = await t2.app.request("/api/families", json({}, { Authorization: "Bearer " }));
    expect(res.status).toBe(401);
  });
});

describe("合言葉", () => {
  it("POST /api/session: 有効な合言葉で 204 と cookie、無効なら 401", async () => {
    const { token } = await createFamily(t);
    const ok = await t.app.request("/api/session", json({ token }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("set-cookie")).toContain(`omoide_invite=${token}`);
    const bad = await t.app.request("/api/session", json({ token: "x".repeat(43) }));
    expect(bad.status).toBe(401);
    const invalid = await t.app.request("/api/session", json({ token: 1 }));
    expect(invalid.status).toBe(400);
  });

  it("家族単位の作り直し（POST /api/invite/regenerate）はもうない（0036）", async () => {
    const { cookie } = await createFamily(t);
    const mom = await addMember(t, cookie);
    const res = await t.app.request("/api/invite/regenerate", { method: "POST", headers: { Cookie: mom.cookie } });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/family", () => {
  it("本当の家族: 時計は今の日本時間から作る。手元では時計を進められる", async () => {
    const { cookie } = await createFamily(t);
    t.setNow(new Date("2026-11-02T14:30:00Z")); // 日本時間 23:30
    const res = await t.app.request("/api/family", { headers: { Cookie: cookie } });
    const body = (await res.json()) as { family: Record<string, unknown>; members: unknown[]; me: unknown };
    expect(body.family).toMatchObject({ isDemo: false, clock: { date: "2026-11-02", slot: "night" }, canAdvanceClock: true });
    expect(body.members).toEqual([]);
    // 最初の人のリンクで開いた端末は、まだ誰でもない
    expect(body.me).toBeNull();
    t.setNow(new Date("2026-11-02T00:00:00Z"));
  });

  it("デモの家族は、作った日の朝の時計を持つ", async () => {
    const { cookie } = await createFamily(t, true);
    const body = (await (await t.app.request("/api/family", { headers: { Cookie: cookie } })).json()) as {
      family: Record<string, unknown>;
    };
    expect(body.family).toMatchObject({ isDemo: true, clock: { date: "2026-11-02", slot: "morning" } });
  });

  it("本番では、デモの家族だけが時計を進められる", async () => {
    const prod = makeTestApp(d1, { appEnv: "production" });
    const real = await createFamily(prod);
    const demo = await createFamily(prod, true);
    const view = async (cookie: string) =>
      ((await (await prod.app.request("/api/family", { headers: { Cookie: cookie } })).json()) as { family: { canAdvanceClock: boolean } })
        .family.canAdvanceClock;
    expect(await view(real.cookie)).toBe(false);
    expect(await view(demo.cookie)).toBe(true);
  });
});

describe("一人ひとり", () => {
  it("作って、直して、家族の様子に出る。代わりに設定した人はほかの家族の人ではいけない", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const mom = await addMember(t, a.cookie);
    const grandma = await addMember(t, mom.cookie, {
      role: "elder",
      relation: "祖母",
      calledAs: "ばあば",
      speechStyle: "dialect",
      dialectRegion: "鹿児島",
      setUpByMemberId: mom.id,
    });
    const patch = await t.app.request(`/api/members/${grandma.id}`, {
      method: "PATCH",
      headers: { Cookie: mom.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "elder", relation: "祖母", calledAs: "おばあちゃん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: mom.id }),
    });
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ calledAs: "おばあちゃん", dialectRegion: null });

    const view = (await (await t.app.request("/api/family", { headers: { Cookie: mom.cookie } })).json()) as {
      members: { id: string; hasLink: boolean }[];
      me: { id: string } | null;
    };
    expect(view.members.map((m) => m.id).sort()).toEqual([mom.id, grandma.id].sort());
    expect(view.me?.id).toBe(mom.id);
    // addMember はどちらのリンクも作っている
    expect(view.members.every((m) => m.hasLink)).toBe(true);

    // ほかの家族の人を、代わりに設定した人にできない
    const dad = await addMember(t, b.cookie, { relation: "父", calledAs: "おとうさん" });
    const cross = await t.app.request("/api/members", json({ role: "family", relation: "孫", calledAs: "けん", speechStyle: "standard", dialectRegion: null, setUpByMemberId: mom.id }, { Cookie: dad.cookie }));
    expect(cross.status).toBe(404);
    // ほかの家族の人は直せない
    const patchOther = await t.app.request(`/api/members/${mom.id}`, {
      method: "PATCH",
      headers: { Cookie: dad.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ role: "family", relation: "母", calledAs: "x", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null }),
    });
    expect(patchOther.status).toBe(404);
  });

  it("方言なのに地域がない、などは 400（受け取った値は返さない）", async () => {
    const a = await createFamily(t);
    const res = await t.app.request("/api/members", json({ role: "family", relation: "母", calledAs: "秘密の呼び名", speechStyle: "dialect", dialectRegion: null, setUpByMemberId: null }, { Cookie: a.cookie }));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe(JSON.stringify({ error: "invalid_request" }));
  });
});
