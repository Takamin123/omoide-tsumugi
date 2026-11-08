// 審査員の案内（0062）。POST /api/demo/guide は本文の鍵で守る。設定なし・不一致は区別せず 404。実際の家族のリンクは返さない。
// 架空の家族と架空の値だけを使う（本物の鍵とリンクを書かない）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoGuideKeyMisconfig } from "../src/server/routes/auth";
import { DEMO_GUIDE_FAMILY_LIMIT, DEMO_GUIDE_FAMILY_NAME } from "../src/server/routes/demo";
import { SEED_MEMBERS } from "../src/server/demo/seed";
import type { OpsFamilyRecord } from "../src/shared/ops";
import {
  addMember,
  addPhoto,
  cookieOf,
  CREATE_TOKEN,
  createFamily,
  DEMO_RESET_TOKEN,
  defaultMember,
  inviteCookieFrom,
  makeTestApp,
  OPS_TOKEN,
  startD1,
  type TestApp,
} from "./helpers";

const KEY = "k".repeat(40);

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

const post = (body: unknown) =>
  t.app.request("/api/demo/guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const linkToken = async (cookie: string, memberId: string) => {
  const res = await t.app.request(`/api/members/${memberId}/link`, { method: "POST", headers: { Cookie: cookie } });
  return ((await res.json()) as { token: string }).token;
};

/** 台本の 4 人の家族を作り、呼ばれ方 → 合言葉を返す */
async function seedLikeFamily(isDemo = true) {
  configure(null, null);
  const f = await createFamily(t, isDemo);
  const first = await addMember(t, f.cookie, { calledAs: "お母さん" });
  const ids: Record<string, string> = { お母さん: first.id };
  for (const { calledAs, role } of SEED_MEMBERS) {
    if (calledAs === "お母さん") continue;
    ids[calledAs] = (await addMember(t, first.cookie, { ...defaultMember, calledAs, role })).id;
  }
  const links: Record<string, string> = {};
  for (const { calledAs } of SEED_MEMBERS) {
    if (calledAs !== "お母さん") links[calledAs] = await linkToken(first.cookie, ids[calledAs]!);
  }
  // 自分のリンクは最後に作り直す（cookie が替わる）
  const momRes = await t.app.request(`/api/members/${first.id}/link`, { method: "POST", headers: { Cookie: first.cookie } });
  links["お母さん"] = ((await momRes.json()) as { token: string }).token;
  return { ids, links, cookie: `omoide_invite=${links["お母さん"]}` };
}

function configure(key: string | null, links: Record<string, string> | string | null) {
  t.deps.config = {
    ...t.deps.config,
    demoGuideKey: key,
    demoGuideLinks: links === null ? null : typeof links === "string" ? links : JSON.stringify(links),
  };
}

describe("審査員の案内の入り口", () => {
  it("鍵が合えば、台本の並びで 4 人のリンクを返す。保存させない", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await post({ key: KEY });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { people: { calledAs: string; token: string }[] };
    expect(body.people).toEqual(SEED_MEMBERS.map(({ calledAs }) => ({ calledAs, token: links[calledAs] })));
  });

  it("開いたリンクで入れる（案内が返す合言葉は /api/session で使える）", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const body = (await (await post({ key: KEY })).json()) as { people: { token: string }[] };
    const res = await t.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: body.people[0]!.token }),
    });
    expect(res.status).toBe(204);
  });

  it.each([
    ["鍵の不一致", { key: "x".repeat(40) }],
    ["鍵が短い", { key: "short" }],
    ["鍵が長すぎる", { key: "k".repeat(201) }],
    ["URL に載らない文字", { key: `${"k".repeat(39)}/` }],
    ["鍵がない", {}],
    ["形が違う", { key: 1 }],
  ])("%s は 404 で、本文も見出しも同じ", async (_name, input) => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await post(input);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("本文が JSON でなくても 404", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await t.app.request("/api/demo/guide", { method: "POST", body: "{" });
    expect(res.status).toBe(404);
  });

  it("秘密の値を消せば閉じる（鍵なし・リンクなしは 404）", async () => {
    const { links } = await seedLikeFamily();
    configure(null, links);
    expect((await post({ key: KEY })).status).toBe(404);
    configure(KEY, null);
    expect((await post({ key: KEY })).status).toBe(404);
  });

  it("鍵が使えない設定（短い・URL に載らない・ほかの鍵と同じ）なら、合っていても閉じ、値をログに出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { links } = await seedLikeFamily();
    const base = t.deps.config;
    for (const bad of ["s".repeat(31), `${"p".repeat(39)}+`]) {
      configure(bad, links);
      expect((await post({ key: bad })).status).toBe(404);
    }
    for (const field of ["createFamilyToken", "opsRecordToken", "demoResetToken"] as const) {
      t.deps.config = { ...base, [field]: KEY, demoGuideKey: KEY, demoGuideLinks: JSON.stringify(links) };
      expect((await post({ key: KEY })).status).toBe(404);
    }
    t.deps.config = base;
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("demo_guide_key_misconfigured");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("s".repeat(31));
    warn.mockRestore();
  });

  it.each([
    ["JSON でない", "{"],
    ["一人足りない", JSON.stringify({ じいちゃん: "a".repeat(43) })],
    ["合言葉の形が違う", JSON.stringify({ じいちゃん: "x", お母さん: "x", まさとおじさん: "x", ゆい: "x" })],
  ])("リンクの設定が %s なら閉じ、値をログに出さない", async (_name, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    configure(KEY, raw);
    expect((await post({ key: KEY })).status).toBe(404);
    expect(warn.mock.calls.flat().join(" ")).toBe(JSON.stringify({ event: "demo_guide_links_misconfigured" }));
    warn.mockRestore();
  });

  it("実際の家族のリンクは、設定に載っていても返さない。合言葉をログに出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const demo = await seedLikeFamily();
    const real = await seedLikeFamily(false);
    configure(KEY, { ...demo.links, じいちゃん: real.links["じいちゃん"]! });
    const body = (await (await post({ key: KEY })).json()) as { people: { calledAs: string }[] };
    expect(body.people.map((p) => p.calledAs)).toEqual(["お母さん", "まさとおじさん", "ゆい"]);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain('"reason":"not_demo"');
    expect(logged).not.toContain(real.links["じいちゃん"]!);
    warn.mockRestore();
  });

  it("呼ばれ方が違う人のリンクは返さない。全員だめなら 404", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { links } = await seedLikeFamily();
    configure(KEY, { ...links, ゆい: links["お母さん"]! });
    const body = (await (await post({ key: KEY })).json()) as { people: { calledAs: string }[] };
    expect(body.people.map((p) => p.calledAs)).toEqual(["じいちゃん", "お母さん", "まさとおじさん"]);
    configure(KEY, { じいちゃん: "a".repeat(43), お母さん: "b".repeat(43), まさとおじさん: "c".repeat(43), ゆい: "d".repeat(43) });
    expect((await post({ key: KEY })).status).toBe(404);
    warn.mockRestore();
  });
});

describe("案内が開いている間、デモの家族の人とリンクは変えられない", () => {
  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    t.app.request(path, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const input = { ...defaultMember, calledAs: "架空のおば" };

  it("開いている間は 403。リンクはそのまま使え、閉じれば（秘密の値を消せば）変えられる", async () => {
    const { ids, links, cookie } = await seedLikeFamily();
    configure(KEY, links);
    const target = ids["ゆい"]!;
    expect((await send("POST", "/api/members", cookie, input)).status).toBe(403);
    expect((await send("PATCH", `/api/members/${target}`, cookie, input)).status).toBe(403);
    expect((await send("POST", `/api/members/${target}/link`, cookie)).status).toBe(403);
    const body = (await (await post({ key: KEY })).json()) as { people: unknown[] };
    expect(body.people).toHaveLength(4);
    configure(null, null);
    expect((await send("PATCH", `/api/members/${target}`, cookie, input)).status).toBe(200);
    expect((await send("POST", `/api/members/${target}/link`, cookie)).status).toBe(200);
    expect((await send("POST", "/api/members", cookie, input)).status).toBe(201);
  });

  it("開いていても、デモでない家族は変えられる", async () => {
    const demo = await seedLikeFamily();
    const real = await seedLikeFamily(false);
    configure(KEY, demo.links);
    expect((await send("POST", "/api/members", real.cookie, input)).status).toBe(201);
    expect((await send("POST", `/api/members/${real.ids["ゆい"]}/link`, real.cookie)).status).toBe(200);
  });

  it("鍵かリンクの設定が使えなくても、鍵があれば守る（閉じる側に倒す）。鍵を消せば変えられる", async () => {
    const { ids, links, cookie } = await seedLikeFamily();
    configure("short", links);
    expect((await send("POST", `/api/members/${ids["ゆい"]}/link`, cookie)).status).toBe(403);
    configure(KEY, "{");
    expect((await send("PATCH", `/api/members/${ids["ゆい"]}`, cookie, input)).status).toBe(403);
    configure(null, links);
    expect((await send("PATCH", `/api/members/${ids["ゆい"]}`, cookie, input)).status).toBe(200);
  });
});

describe("審査員が新しい家族を作る", () => {
  const create = (body: unknown) =>
    t.app.request("/api/demo/guide/families", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const clearJudgeFamilies = async () => {
    await d1.prepare("DELETE FROM invite_links WHERE family_id IN (SELECT id FROM families WHERE name = ?)").bind(DEMO_GUIDE_FAMILY_NAME).run();
    await d1.prepare("DELETE FROM members WHERE family_id IN (SELECT id FROM families WHERE name = ?)").bind(DEMO_GUIDE_FAMILY_NAME).run();
    await d1.prepare("DELETE FROM families WHERE name = ?").bind(DEMO_GUIDE_FAMILY_NAME).run();
  };
  const judgeCount = async () =>
    (await d1.prepare("SELECT count(*) AS n FROM families WHERE name = ?").bind(DEMO_GUIDE_FAMILY_NAME).first<{ n: number }>())!.n;
  const send = (method: string, path: string, cookie: string, body?: unknown) =>
    t.app.request(path, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("鍵が合えば、デモの家族で時計つきの家族ができ、cookie は最初の人のリンク。本文に合言葉を返さない。保存させない", async () => {
    await clearJudgeFamilies();
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await create({ key: KEY });
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.text()).toBe("");
    const cookie = inviteCookieFrom(res)!;
    const view = (await (await t.app.request("/api/family", { headers: { Cookie: cookie } })).json()) as {
      family: { isDemo: boolean; clock: { slot: string } | null; canAdvanceClock: boolean };
      members: unknown[];
      me: unknown;
    };
    expect(view.family.isDemo).toBe(true);
    expect(view.family.clock?.slot).toBe("morning");
    expect(view.family.canAdvanceClock).toBe(true);
    expect(view.members).toEqual([]);
    expect(view.me).toBeNull();
    // Cron の対象外
    expect(await t.deps.repos.families.listIdsWithoutClock()).not.toContain(
      (await d1.prepare("SELECT id FROM families WHERE name = ?").bind(DEMO_GUIDE_FAMILY_NAME).first<{ id: string }>())!.id,
    );
  });

  it.each([
    ["鍵の不一致", { key: "x".repeat(40) }],
    ["鍵がない", {}],
    ["形が違う", { key: 1 }],
  ])("%s は 404 で、何も作らない", async (_name, input) => {
    await clearJudgeFamilies();
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await create(input);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(inviteCookieFrom(res)).toBeNull();
    expect(await judgeCount()).toBe(0);
  });

  it("設定なし・リンクの設定が読めない・本番と同じ鍵なしは 404（閉じている）", async () => {
    await clearJudgeFamilies();
    const { links } = await seedLikeFamily();
    configure(null, links);
    expect((await create({ key: KEY })).status).toBe(404);
    configure(KEY, "{");
    expect((await create({ key: KEY })).status).toBe(404);
    configure(KEY, null);
    expect((await create({ key: KEY })).status).toBe(404);
    expect(await judgeCount()).toBe(0);
  });

  it("ふつうの家族を作る入り口は、案内の鍵では開かない", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const res = await t.app.request("/api/families", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ isDemo: true }),
    });
    expect(res.status).toBe(401);
  });

  it("合計 20 まで。超えたら 409 family_limit で何も作らず、cookie も置かない。同時に押しても超えない。ほかの家族は数えない", async () => {
    await clearJudgeFamilies();
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const results = await Promise.all(Array.from({ length: DEMO_GUIDE_FAMILY_LIMIT + 3 }, () => create({ key: KEY })));
    expect(results.filter((r) => r.status === 204)).toHaveLength(DEMO_GUIDE_FAMILY_LIMIT);
    const over = results.filter((r) => r.status === 409);
    expect(over).toHaveLength(3);
    expect(await over[0]!.json()).toEqual({ error: "family_limit" });
    expect(inviteCookieFrom(over[0]!)).toBeNull();
    expect(await judgeCount()).toBe(DEMO_GUIDE_FAMILY_LIMIT);
    // 宙に浮いたリンクを残さない
    const orphan = await d1.prepare("SELECT count(*) AS n FROM invite_links WHERE family_id NOT IN (SELECT id FROM families)").first<{ n: number }>();
    expect(orphan!.n).toBe(0);
    await clearJudgeFamilies();
  });

  it("審査員の家族は、案内が開いている間も人を足せてリンクを作れる。4 人の家族は変えられないまま", async () => {
    await clearJudgeFamilies();
    const script = await seedLikeFamily();
    configure(KEY, script.links);
    const judge = inviteCookieFrom(await create({ key: KEY }))!;
    const first = await send("POST", "/api/members", judge, { ...defaultMember, calledAs: "架空のはは" });
    expect(first.status).toBe(201);
    const me = inviteCookieFrom(first)!;
    const added = await send("POST", "/api/members", me, { ...defaultMember, role: "elder", calledAs: "架空のそふ" });
    expect(added.status).toBe(201);
    const { id } = (await added.json()) as { id: string };
    const link = await send("POST", `/api/members/${id}/link`, me);
    expect(link.status).toBe(200);
    expect((await send("PATCH", `/api/members/${id}`, me, { ...defaultMember, role: "elder", calledAs: "架空のじいじ" })).status).toBe(200);
    // 4 人の家族
    expect((await send("POST", "/api/members", script.cookie, { ...defaultMember, calledAs: "架空のおば" })).status).toBe(403);
    expect((await send("POST", `/api/members/${script.ids["ゆい"]}/link`, script.cookie)).status).toBe(403);
    expect((await send("PATCH", `/api/members/${script.ids["ゆい"]}`, script.cookie, { ...defaultMember, calledAs: "架空のおば" })).status).toBe(403);
    // 審査員の家族の cookie で、4 人の家族の人は触れない（ほかの家族として 404）
    expect((await send("POST", `/api/members/${script.ids["ゆい"]}/link`, me)).status).toBe(404);
    await clearJudgeFamilies();
  });
});

describe("案内の鍵の規則", () => {
  const base = {
    appEnv: "preview",
    createFamilyToken: null,
    opsRecordToken: null,
    opsRecordFamilies: [],
    demoResetToken: null,
    demoGuideKey: null,
    demoGuideLinks: null,
  };
  it("設定がないのは誤りではない。短い・URL に載らない・ほかの鍵と同じは誤り", () => {
    expect(demoGuideKeyMisconfig(base)).toBeNull();
    expect(demoGuideKeyMisconfig({ ...base, demoGuideKey: KEY })).toBeNull();
    expect(demoGuideKeyMisconfig({ ...base, demoGuideKey: "a".repeat(31) })).toBe("too_short");
    expect(demoGuideKeyMisconfig({ ...base, demoGuideKey: `${"a".repeat(40)}=` })).toBe("not_url_safe");
    expect(demoGuideKeyMisconfig({ ...base, createFamilyToken: KEY, demoGuideKey: KEY })).toBe("same_as_create_family_token");
    expect(demoGuideKeyMisconfig({ ...base, opsRecordToken: KEY, demoGuideKey: KEY })).toBe("same_as_ops_record_token");
    expect(demoGuideKeyMisconfig({ ...base, demoResetToken: KEY, demoGuideKey: KEY })).toBe("same_as_demo_reset_token");
  });
});

// ここから下は qa-engineer が足した（既存の入り口の守りに穴がないこと、最初の一人、取り消されたリンク、ログ）
describe("案内の鍵は、ほかの入り口を開かない", () => {
  const bearer = (path: string, key: string, init: RequestInit = {}) =>
    t.app.request(path, { method: "POST", ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers } });

  it("Bearer でも cookie でも、初期化・運営・家族を作る入り口・合言葉の入り口は開かない", async () => {
    const f = await createFamily(t, true);
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    for (const path of [`/api/demo/families/${f.familyId}/reset`, `/API/demo/FAMILIES/${f.familyId}/reset`]) {
      expect((await bearer(path, KEY)).status).toBe(401);
      expect((await t.app.request(path, { method: "POST", body: JSON.stringify({ key: KEY }) })).status).toBe(401);
    }
    expect((await t.app.request(`/api/ops/families/${f.familyId}/record`, { headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(401);
    expect((await bearer("/api/families", KEY, { body: JSON.stringify({ isDemo: true }) })).status).toBe(401);
    expect((await t.app.request("/api/family", { headers: { Authorization: `Bearer ${KEY}`, Cookie: cookieOf(KEY) } })).status).toBe(401);
    // 案内の鍵は合言葉にならない
    const session = await t.app.request("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: KEY }) });
    expect(session.status).toBe(401);
  });

  it("初期化の鍵・運営の鍵・家族を作る鍵では、案内は開かない", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    for (const other of [DEMO_RESET_TOKEN, OPS_TOKEN, CREATE_TOKEN]) {
      expect((await post({ key: other })).status).toBe(404);
    }
  });

  it("書き方を変えた道でも、鍵なしではリンクを返さない", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    const json = { "Content-Type": "application/json" };
    for (const path of ["/API/demo/guide", "/api/DEMO/Guide"]) {
      for (const key of ["x".repeat(40), KEY]) {
        const res = await t.app.request(path, { method: "POST", headers: json, body: JSON.stringify({ key }) });
        expect(res.status).toBe(404);
        const text = await res.text();
        for (const token of Object.values(links)) expect(text).not.toContain(token);
      }
    }
    // 公開なのは POST の /api/demo/guide ちょうどだけ。ほかの動詞・頭だけ合う道は、合言葉の確認で止まる
    expect((await t.app.request("/api/demo/guide")).status).toBe(401);
    expect((await t.app.request("/api/demo/guide/", { method: "POST", headers: json, body: JSON.stringify({ key: KEY }) })).status).toBe(401);
    expect((await t.app.request("/api/demo/guide/x", { method: "POST", headers: json, body: JSON.stringify({ key: KEY }) })).status).toBe(401);
    // 検索語の鍵は受け取らない
    expect((await t.app.request(`/api/demo/guide?key=${KEY}`, { method: "POST" })).status).toBe(404);
  });

  it("案内の応答は cookie を置かない（この端末は誰にもならない）", async () => {
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    expect((await post({ key: KEY })).headers.get("set-cookie")).toBeNull();
    expect((await post({ key: "x".repeat(40) })).headers.get("set-cookie")).toBeNull();
  });
});

describe("案内が返すリンクの確かめ（足りなかった場合）", () => {
  it("作り直して取り消されたリンクは返さない。ログに合言葉を出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ids, links, cookie } = await seedLikeFamily();
    configure(null, null); // 閉じている間に作り直す
    const res = await t.app.request(`/api/members/${ids["ゆい"]}/link`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    configure(KEY, links); // 古い合言葉のまま開く
    const body = (await (await post({ key: KEY })).json()) as { people: { calledAs: string }[] };
    expect(body.people.map((p) => p.calledAs)).toEqual(["じいちゃん", "お母さん", "まさとおじさん"]);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain('"reason":"inactive"');
    expect(logged).not.toContain(links["ゆい"]!);
    warn.mockRestore();
  });

  it("人を指さない最初の人のリンクは返さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { links } = await seedLikeFamily();
    const fresh = await createFamily(t, true);
    configure(KEY, { ...links, ゆい: fresh.token });
    const body = (await (await post({ key: KEY })).json()) as { people: { calledAs: string; token: string }[] };
    expect(body.people.map((p) => p.calledAs)).toEqual(["じいちゃん", "お母さん", "まさとおじさん"]);
    expect(JSON.stringify(body)).not.toContain(fresh.token);
    warn.mockRestore();
  });

  it("通ったときも落ちたときも、鍵と合言葉をログに出さない", async () => {
    const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { links } = await seedLikeFamily();
    configure(KEY, links);
    await post({ key: KEY });
    await post({ key: "x".repeat(40) });
    await post({ key: "short" });
    const logged = spies.flatMap((s) => s.mock.calls.flat()).map(String).join(" ");
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("x".repeat(40));
    for (const token of Object.values(links)) expect(logged).not.toContain(token);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("案内が開いている間の、守りの範囲（足りなかった場合）", () => {
  const firstMember = { ...defaultMember, calledAs: "架空の最初の人" };

  it("最初の一人の登録は、デモの家族でも通る。二人目からは 403", async () => {
    const { links } = await seedLikeFamily();
    const fresh = await createFamily(t, true);
    configure(KEY, links);
    const first = await t.app.request("/api/members", {
      method: "POST",
      headers: { Cookie: fresh.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(firstMember),
    });
    expect(first.status).toBe(201);
    const cookie = inviteCookieFrom(first)!;
    const second = await t.app.request("/api/members", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ...defaultMember, calledAs: "架空の二人目" }),
    });
    expect(second.status).toBe(403);
  });

  it("デモでない家族は、最初の一人から変わらず足せる", async () => {
    const { links } = await seedLikeFamily();
    const real = await createFamily(t, false);
    configure(KEY, links);
    const first = await addMember(t, real.cookie, firstMember);
    await addMember(t, first.cookie, { ...defaultMember, calledAs: "架空の二人目" });
  });

  it("禁じられても、語り・時計・読み出しは変わらず通る（守りは人とリンクだけ）", async () => {
    const { links, cookie } = await seedLikeFamily();
    configure(KEY, links);
    expect((await t.app.request("/api/family", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: cookie } })).status).toBe(200);
  });
});

// 審査員が見る Claude の記録（0062 の追記 2026-11-08）。GET /api/demo/guide/record と写真。
// 案内の鍵（Bearer）で守り、家族は案内のリンクをたどった台本の家族だけ。読み取りだけ。運営の鍵での動き（0030）は変えない
describe("審査員が見る Claude の記録", () => {
  const RECORD = "/api/demo/guide/record";
  const get = (path: string, key: string | null = KEY, init: RequestInit = {}) =>
    t.app.request(path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...init.headers } });
  let photoN = 900;
  /** 台本の家族を作り、写真を一枚足す（鍵は足した後で設定する。開いている間は人を足せないため） */
  async function seedWithPhoto() {
    const s = await seedLikeFamily();
    const photo = await addPhoto(t, s.cookie, photoN++);
    const familyId = (await d1
      .prepare("SELECT family_id AS id FROM members WHERE id = ?")
      .bind(s.ids["お母さん"])
      .first<{ id: string }>())!.id;
    return { ...s, photo, familyId };
  }

  it("鍵が合えば、台本の家族の記録を運営の記録と同じ形で返す。写真は案内の道で、同じ鍵で読める。保存させない", async () => {
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    const res = await get(RECORD);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    const record = (await res.json()) as OpsFamilyRecord;
    expect(record.family).toMatchObject({ id: s.familyId, isDemo: true });
    expect(record.members.map((m) => m.calledAs).sort()).toEqual(SEED_MEMBERS.map((m) => m.calledAs).sort());
    expect(record.photos.map((p) => p.id)).toEqual([s.photo.id]);
    expect(record.photos[0]!.imageUrl).toBe(`${RECORD}/photos/${s.photo.id}/image`);
    // 運営の鍵で読んだ記録と、写真の道のほかは同じ
    const ops = (await (await get(`/api/ops/families/${s.familyId}/record`, OPS_TOKEN)).json()) as OpsFamilyRecord;
    expect({ ...record, photos: record.photos.map(({ imageUrl: _, ...p }) => p) }).toEqual({
      ...ops,
      photos: ops.photos.map(({ imageUrl: _, ...p }) => p),
    });
    const img = await get(record.photos[0]!.imageUrl);
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toBe("private, no-store");
    expect(img.headers.get("content-type")).toBe("image/jpeg");
  });

  it.each([
    ["鍵がない", null],
    ["鍵の不一致", "x".repeat(40)],
    ["鍵が短い", "short"],
    ["運営の鍵", OPS_TOKEN],
    ["初期化の鍵", DEMO_RESET_TOKEN],
    ["家族を作る鍵", CREATE_TOKEN],
  ])("%s は、記録も写真も 404 で、本文も見出しも同じ", async (_name, key) => {
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    for (const path of [RECORD, `${RECORD}/photos/${s.photo.id}/image`]) {
      const res = await get(path, key);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("鍵は Bearer だけで受け取る。検索語・本文・合言葉の cookie では開かない。書き方を変えた道も、鍵なしでは開かない", async () => {
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    expect((await get(`${RECORD}?key=${KEY}`, null)).status).toBe(404);
    expect((await get(RECORD, null, { headers: { Authorization: KEY } })).status).toBe(404);
    expect((await get(RECORD, null, { headers: { Cookie: s.cookie } })).status).toBe(404);
    expect((await get(RECORD, null, { headers: { Cookie: cookieOf(KEY) } })).status).toBe(404);
    for (const path of ["/API/demo/guide/record", "/api/DEMO/Guide/Record", `/Api/demo/guide/RECORD/photos/${s.photo.id}/image`]) {
      expect((await get(path, null)).status).toBe(404);
    }
  });

  it("読み取りだけ。書き込みの動詞は、鍵が合っていても開かない", async () => {
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect((await get(RECORD, KEY, { method })).status).toBe(404);
      expect((await get(`${RECORD}/photos/${s.photo.id}/image`, KEY, { method })).status).toBe(404);
    }
  });

  it("秘密の値を消せば閉じる（鍵なし・リンクなし・リンクの設定が読めない・本番のように何も設定がない）", async () => {
    const s = await seedWithPhoto();
    for (const [key, links] of [
      [null, s.links],
      [KEY, null],
      [KEY, "{"],
      [null, null],
    ] as const) {
      configure(key, links);
      expect((await get(RECORD)).status).toBe(404);
      expect((await get(`${RECORD}/photos/${s.photo.id}/image`)).status).toBe(404);
    }
    // 本番（APP_ENV=production）には DEMO_GUIDE_KEY がない。運営の鍵ではデモの家族が開くが、案内の道は閉じている
    const prod = makeTestApp(d1, { appEnv: "production" });
    expect(prod.deps.config.demoGuideKey).toBeNull();
    expect((await prod.app.request(RECORD, { headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(404);
    expect((await prod.app.request(`/api/ops/families/${s.familyId}/record`, { headers: { Authorization: `Bearer ${OPS_TOKEN}` } })).status).toBe(200);
  });

  it("鍵が使えない設定（短い・ほかの鍵と同じ）なら、合っていても閉じる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await seedWithPhoto();
    configure("s".repeat(31), s.links);
    expect((await get(RECORD, "s".repeat(31))).status).toBe(404);
    t.deps.config = { ...t.deps.config, demoGuideKey: OPS_TOKEN };
    expect((await get(RECORD, OPS_TOKEN)).status).toBe(404);
    configure(null, null);
    warn.mockRestore();
  });

  it("家族は要求から受け取らない。ほかのデモの家族の写真を案内の道で引いても 404。検索語の家族 ID は無視する", async () => {
    const other = await seedWithPhoto();
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    expect((await get(`${RECORD}/photos/${other.photo.id}/image`)).status).toBe(404);
    const r = (await (await get(`${RECORD}?family=${other.familyId}`)).json()) as OpsFamilyRecord;
    expect(r.family.id).toBe(s.familyId);
    // 運営の鍵での動き（0030）は変わらない: デモの家族ならどれも開く
    expect((await get(`/api/ops/families/${other.familyId}/record`, OPS_TOKEN)).status).toBe(200);
  });

  it("案内から作った家族（印つき）を指すリンクでは開かない。デモの印があっても 404", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await seedWithPhoto();
    await d1.prepare("UPDATE families SET name = ? WHERE id = ?").bind(DEMO_GUIDE_FAMILY_NAME, s.familyId).run();
    try {
      configure(KEY, s.links);
      expect((await get(RECORD)).status).toBe(404);
      expect((await get(`${RECORD}/photos/${s.photo.id}/image`)).status).toBe(404);
    } finally {
      await d1.prepare("UPDATE families SET name = NULL WHERE id = ?").bind(s.familyId).run();
      warn.mockRestore();
    }
  });

  it("実際の家族は、リンクが設定に載っていても開かない。リンクが別々の家族を指すときも開かない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const real = await seedLikeFamily(false);
    configure(KEY, real.links);
    expect((await get(RECORD)).status).toBe(404);
    // 一人だけ実際の家族を混ぜても、開くのはデモの家族
    const demo = await seedWithPhoto();
    configure(KEY, { ...demo.links, じいちゃん: real.links["じいちゃん"]! });
    expect(((await (await get(RECORD)).json()) as OpsFamilyRecord).family.id).toBe(demo.familyId);
    // 二つのデモの家族を混ぜれば、どちらとも決めない
    const another = await seedWithPhoto();
    configure(KEY, { ...demo.links, ゆい: another.links["ゆい"]! });
    expect((await get(RECORD)).status).toBe(404);
    expect(warn.mock.calls.flat().join(" ")).toContain("demo_guide_record_families_differ");
    warn.mockRestore();
  });

  it("鍵と合言葉をログに出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await seedWithPhoto();
    configure(KEY, s.links);
    await get(RECORD);
    await get(RECORD, "x".repeat(40));
    const logged = [...log.mock.calls, ...warn.mock.calls].flat().join(" ");
    expect(logged).toContain("demo_guide_record");
    expect(logged).not.toContain(KEY);
    for (const token of Object.values(s.links)) expect(logged).not.toContain(token);
    log.mockRestore();
    warn.mockRestore();
  });
});

describe("審査員が見る Claude の記録の道の書き方（足りなかった場合）", () => {
  it("鍵なしでは、末尾の / ・二重の / ・百分率で書いた道でも記録を返さない", async () => {
    const s = await seedLikeFamily();
    configure(KEY, s.links);
    for (const path of [
      "/api/demo/guide/record/",
      "/api/demo/guide//record",
      "/api/demo/guide/%72ecord",
      "/api/demo/%67uide/record",
      "/api/demo/guide/record%2F",
      "/api/demo/guide/record/photos/x/image/",
      "/api/demo/guide/record/./",
    ]) {
      const res = await t.app.request(path);
      expect([401, 404]).toContain(res.status);
      expect(await res.text()).not.toContain("members");
    }
    configure(null, null);
  });

  it("案内の鍵があっても、家族の入り口（合言葉の道）は開かない", async () => {
    const s = await seedLikeFamily();
    configure(KEY, s.links);
    for (const path of ["/api/family", "/api/entrances/today", `/api/ops/families/x/record`]) {
      const res = await t.app.request(path, { headers: { Authorization: `Bearer ${KEY}` } });
      expect(res.status).toBe(401);
    }
    configure(null, null);
  });
});
