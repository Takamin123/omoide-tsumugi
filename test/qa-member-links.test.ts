// 一人ずつのリンク（0036）を、閉じる側から確かめる（qa-engineer）。
// - 最初の人のリンクで、パスの書き方を変えても、ほかの入り口のハンドラに届かない
// - 人を指すリンクが別の家族の人を指していたら通さない
// - 「人がいないときだけ」の守りが、入り口の確認なしでもデータベースの文だけで効く
// - 同じ人のリンクを同時に作り直しても、有効なリンクは一つ
// - 一意の索引（人ごとに一つ、最初の人のリンクは家族ごとに一つ）
// - 人を指すリンクがあっても、scripts/delete-family.mjs で家族を消せる
// 架空の家族と架空の値だけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Repositories } from "../src/server/core/ports";
import { hashToken } from "../src/server/core/secrets";
import {
  addMember,
  cookieOf,
  createFamily,
  defaultMember,
  inviteCookieFrom,
  makeTestApp,
  startD1,
  type TestApp,
} from "./helpers";
import { path, repoRoot } from "./node";

let d1: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, bucket, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

const get = (p: string, cookie: string) => t.app.request(p, { headers: { Cookie: cookie } });

/** findActiveLink のほかに、リポジトリのどれが呼ばれたかを記録する包み */
function spyRepos(real: Repositories, touched: string[]): Repositories {
  return new Proxy(real, {
    get(target, table: string) {
      const inner = (target as unknown as Record<string, Record<string, unknown>>)[table]!;
      return new Proxy(inner, {
        get(t2, fn: string) {
          const f = t2[fn];
          if (typeof f !== "function") return f;
          return (...args: unknown[]) => {
            if (!(table === "families" && fn === "findActiveLink")) touched.push(`${table}.${fn}`);
            return (f as (...a: unknown[]) => unknown).apply(t2, args);
          };
        },
      });
    },
  });
}

describe("最初の人のリンクで、パスの書き方を変えても、ほかの入り口に届かない", () => {
  const guarded: [string, string][] = [
    ["GET", "/api/feed"],
    ["GET", "/api/photos"],
    ["GET", "/api/narrations"],
    ["GET", "/api/entrances/today"],
    ["POST", "/api/photos"],
    ["POST", "/api/narrations"],
    ["POST", "/api/demo/clock/advance"],
    ["POST", "/api/members/x/link"],
    ["PATCH", "/api/members/x"],
  ];
  const variants = (p: string): string[] => [
    p,
    p.toUpperCase(),
    p.replace("/api/", "/aPi/"),
    p.replace("/api/", "/%61pi/"),
    p.replace(/\/([a-z])/g, (_m, ch: string) => `/%${ch.charCodeAt(0).toString(16)}`),
    p + "/",
    "/" + p,
    p.replace("/api/", "/api//"),
    p.replace("/api/", "/api/./"),
    p.replace("/api/", "/api/family/../"),
    p.replace("/api/", "/api/members/../"),
    p.replace("/api/", "/api/family%2f..%2f"),
    p + "?x=/api/family",
    p + ";/api/family",
  ];
  const cases = guarded.flatMap(([m, p]) => [...variants(p).map((v) => [m, v] as const), ["HEAD", p] as const]);

  // 最初の人のリンクの入り口に似せた書き方（同じハンドラに届くなら問題ない。別のハンドラに届かないこと）
  const lookalikes: [string, string][] = [
    ["POST", "/api/members/x/link"],
    ["POST", "/api/members%2fx%2flink"],
    ["POST", "/api/members%2Fx%2Flink"],
    ["POST", "/api/members/"],
    ["POST", "/api/members/x"],
    ["PUT", "/api/members"],
    ["DELETE", "/api/members"],
    ["POST", "/api/family"],
    ["GET", "/api/family/x"],
    ["GET", "/api/familyx"],
  ];

  it("（記録の包みが効いていること）GET /api/family はリポジトリに触れたと記録される", async () => {
    const f = await createFamily(t);
    const touched: string[] = [];
    const real = t.deps.repos;
    t.deps.repos = spyRepos(real, touched);
    try {
      expect((await get("/api/family", f.cookie)).status).toBe(200);
    } finally {
      t.deps.repos = real;
    }
    expect(touched).toContain("members.list");
  });

  it.each([...cases, ...lookalikes])("%s %s → 403/404、リポジトリに触れない", async (method, p) => {
    const f = await createFamily(t);
    const touched: string[] = [];
    const real = t.deps.repos;
    t.deps.repos = spyRepos(real, touched);
    try {
      const res = await t.app.request(new Request("http://localhost" + p, { method, headers: { Cookie: f.cookie } }));
      expect([403, 404]).toContain(res.status);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(touched).toEqual([]);
    } finally {
      t.deps.repos = real;
    }
    // 最初の人のリンクはまだ使え、家族に人はいない
    const view = (await (await get("/api/family", f.cookie)).json()) as { me: unknown; members: unknown[] };
    expect(view.me).toBeNull();
    expect(view.members).toEqual([]);
  });
});

describe("人を指すリンクの確かめ", () => {
  it("別の家族の人を指すリンクは、使えないリンクとして 401（cookie を消す）", async () => {
    const a = await createFamily(t);
    const aMom = await addMember(t, a.cookie);
    const b = await createFamily(t);
    await addMember(t, b.cookie);
    const token = "qa-cross-link-".padEnd(43, "x");
    // b の家族の行なのに、a の人を指す（入り口からは作れない形。データの誤りを想定）
    await d1
      .prepare("INSERT INTO invite_links (id, family_id, token_hash, member_id, created_at) VALUES (?, ?, ?, ?, 0)")
      .bind(crypto.randomUUID(), b.familyId, await hashToken(token), aMom.id)
      .run();
    const res = await get("/api/family", cookieOf(token));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/omoide_invite=;/);
    expect((await get("/api/feed", cookieOf(token))).status).toBe(401);
  });

  it("POST /api/session: その人のリンクの合言葉で入ると、その人になる。作り直した前の合言葉では入れない", async () => {
    const f = await createFamily(t);
    const mom = await addMember(t, f.cookie);
    const res = await t.app.request(`/api/members/${mom.id}/link`, { method: "POST", headers: { Cookie: mom.cookie } });
    const { token } = (await res.json()) as { token: string };
    const s = await t.app.request("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    expect(s.status).toBe(204);
    const c = inviteCookieFrom(s)!;
    expect(((await (await get("/api/family", c)).json()) as { me: { id: string } }).me.id).toBe(mom.id);
    const old = mom.cookie.split("=")[1];
    const s2 = await t.app.request("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: old }) });
    expect(s2.status).toBe(401);
    expect(inviteCookieFrom(s2)).toBeNull();
  });
});

describe("リポジトリの守り（入り口の確認なしでも効く）", () => {
  const row = (familyId: string, calledAs: string) => ({
    id: crypto.randomUUID(),
    familyId,
    createdAt: 1,
    ...defaultMember,
    calledAs,
  });
  const link = async (s: string) => ({ id: crypto.randomUUID(), tokenHash: await hashToken(`qa-${s}-${crypto.randomUUID()}`) });

  it("addFirst を続けて二度呼んでも、入るのは一人。二度目は false で、リンクも足さない", async () => {
    const f = await createFamily(t);
    const repos = t.deps.repos;
    const r = await Promise.all([
      repos.members.addFirst(row(f.familyId, "ひとり"), await link("a"), 1),
      repos.members.addFirst(row(f.familyId, "ふたり"), await link("b"), 1),
      repos.members.addFirst(row(f.familyId, "さんにん"), await link("c"), 1),
    ]);
    expect(r.filter(Boolean)).toHaveLength(1);
    expect((await repos.members.list(f.familyId)).length).toBe(1);
    const rows = await d1
      .prepare("SELECT member_id, revoked_at FROM invite_links WHERE family_id = ?")
      .bind(f.familyId)
      .all<{ member_id: string | null; revoked_at: number | null }>();
    expect(rows.results.filter((x) => x.revoked_at === null)).toEqual([{ member_id: expect.any(String), revoked_at: null }]);
    expect(rows.results.filter((x) => x.member_id === null).every((x) => x.revoked_at !== null)).toBe(true);
    expect(rows.results).toHaveLength(2);
  });

  it("addFirst: 家族がなければ何も入らない（false）", async () => {
    const familyId = crypto.randomUUID();
    expect(await t.deps.repos.members.addFirst(row(familyId, "x"), await link("n"), 1)).toBe(false);
    expect((await d1.prepare("SELECT count(*) AS n FROM invite_links WHERE family_id = ?").bind(familyId).first<{ n: number }>())?.n).toBe(0);
  });

  it("同じ人のリンクを同時に作り直しても、有効なリンクは一つで、それが返したどれか一つ", async () => {
    const f = await createFamily(t);
    const mom = await addMember(t, f.cookie);
    const grandma = await addMember(t, mom.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島" });
    const results = await Promise.all(
      [0, 1, 2].map(() => t.app.request(`/api/members/${grandma.id}/link`, { method: "POST", headers: { Cookie: mom.cookie } })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const tokens = await Promise.all(results.map(async (r) => ((await r.json()) as { token: string }).token));
    const active = await d1
      .prepare("SELECT count(*) AS n FROM invite_links WHERE member_id = ? AND revoked_at IS NULL")
      .bind(grandma.id)
      .first<{ n: number }>();
    expect(active?.n).toBe(1);
    const ok = [];
    for (const tk of tokens) ok.push((await get("/api/family", cookieOf(tk))).status);
    expect(ok.filter((s) => s === 200)).toHaveLength(1);
    expect((await get("/api/family", grandma.cookie)).status).toBe(401);
  });

  it("一意の索引: 同じ人に有効なリンクを二つ、家族に有効な最初の人のリンクを二つは入れられない", async () => {
    const f = await createFamily(t);
    const ins = (memberId: string | null) =>
      d1
        .prepare("INSERT INTO invite_links (id, family_id, token_hash, member_id, created_at) VALUES (?, ?, ?, ?, 0)")
        .bind(crypto.randomUUID(), f.familyId, crypto.randomUUID(), memberId)
        .run();
    await expect(ins(null)).rejects.toThrow(/UNIQUE/);
    const mom = await addMember(t, f.cookie);
    await expect(ins(mom.id)).rejects.toThrow(/UNIQUE/);
    // 取り消した行は、いくつあってもよい
    await t.app.request(`/api/members/${mom.id}/link`, { method: "POST", headers: { Cookie: mom.cookie } });
  });
});

describe("scripts/delete-family.mjs（人を指すリンクがあっても消せる）", () => {
  it("一人ずつのリンク・取り消したリンクごと消え、ほかの家族は残る", async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const lib: any = await import(path.join(repoRoot, "scripts/delete-family.mjs") as string);
    const make = async () => {
      const f = await createFamily(t);
      const mom = await addMember(t, f.cookie);
      const gm = await addMember(t, mom.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島" });
      await t.app.request(`/api/members/${gm.id}/link`, { method: "POST", headers: { Cookie: mom.cookie } });
      return f;
    };
    const a = await make();
    const b = await make();
    const env = { DB: d1, BUCKET: bucket };
    const before = await lib.countFamily(env, a.familyId);
    // 最初の人のリンク（取り消し済み）、母、祖母（作り直しで 2 行）
    expect(before.tables.invite_links).toBe(4);
    const r = await lib.deleteFamily(env, a.familyId);
    expect(lib.isEmpty(r.after)).toBe(true);
    const kept = await lib.countFamily(env, b.familyId);
    expect(kept.tables.invite_links).toBe(4);
    expect(kept.tables.members).toBe(2);
  });
});
