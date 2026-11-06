// 審査員の案内（0062）。POST /api/demo/guide は本文の鍵で守る。設定なし・不一致は区別せず 404。実際の家族のリンクは返さない。
// 架空の家族と架空の値だけを使う（本物の鍵とリンクを書かない）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { demoGuideKeyMisconfig } from "../src/server/routes/auth";
import { SEED_MEMBERS } from "../src/server/demo/seed";
import {
  addMember,
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

  it("鍵かリンクの設定が使えないときは、開いていないとみなす", async () => {
    const { ids, links, cookie } = await seedLikeFamily();
    configure("short", links);
    expect((await send("POST", `/api/members/${ids["ゆい"]}/link`, cookie)).status).toBe(200);
    configure(KEY, "{");
    expect((await send("PATCH", `/api/members/${ids["ゆい"]}`, cookie, input)).status).toBe(200);
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
