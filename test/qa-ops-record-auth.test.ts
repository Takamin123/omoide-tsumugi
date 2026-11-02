// 運営の記録の入り口（/api/ops/*）の鍵を、パスの書き方を変えて素通りできないこと（qa-engineer、0024）。
// - 家族の合言葉の cookie だけでは、どの書き方でも ops のハンドラ（とデータベース）に届かない
// - 運営の鍵だけでは、どの書き方でも家族向けのハンドラに届かない
// - ops の確かめが、ほかの /api/* に掛かっていない
// - 本番では、鍵が合っていても、どの書き方でも 404 で、データベースに触れない
// 架空の値だけを使う。
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import type { FamilyRow, Repositories } from "../src/server/core/ports";
import { cookieOf, fakeDeps } from "./helpers";

const KEY = "qa-ops-key-fake";
const FAKE_FAMILY = { id: "fam-qa", isDemo: true, createdAt: 0 } as unknown as FamilyRow;

let touched: string[] = [];
const spyRepos = new Proxy({} as Repositories, {
  get(_t, table: string) {
    return new Proxy(
      {},
      {
        get(_t2, fn: string) {
          return async () => {
            touched.push(`${table}.${fn}`);
            // 合言葉の cookie は、どの値でも架空の家族として通す（ops に cookie で届かないことを確かめるため）
            if (table === "families" && fn === "findByActiveInviteHash") return FAKE_FAMILY;
            return null;
          };
        },
      },
    );
  },
});
const appFor = (appEnv = "development") =>
  createApp(() => fakeDeps({ repos: spyRepos, config: { appEnv, createFamilyToken: KEY } }));
const app = appFor();

const COOKIE = { Cookie: cookieOf("any-family-token") };
const BEARER = { Authorization: `Bearer ${KEY}` };
const beyondCookieCheck = () => touched.filter((x) => x !== "families.findByActiveInviteHash");

const variants = (p: string): string[] => [
  p,
  p.toUpperCase(),
  p.replace("/api/", "/aPi/"),
  p.replace("/ops/", "/OPS/"),
  p.replace("/ops/", "/Ops/"),
  p.replace("/ops/", "/%6fps/"),
  p.replace("/ops/", "/%4FPS/"),
  p.replace("/api/", "/%61pi/"),
  p.replace(/\/([a-z])/g, (_m, ch: string) => `/%${ch.charCodeAt(0).toString(16)}`),
  p + "/",
  "/" + p,
  p.replace("/api/", "/api//"),
  p.replace("/ops/", "/ops//"),
  p.replace("/api/", "/api/./"),
  p.replace("/api/", "/x/../api/"),
  p.replace("/ops/", "/x/../ops/"),
  p.replace("/api/", "/api%2f"),
  p.replace("/api/ops/", "/api/ops%2f"),
  p + "?x=1",
  p + "#frag",
  p + ";x",
];

const opsPaths = ["/api/ops/families/fam-qa/record", "/api/ops/families/fam-qa/photos/p1/image"];
const familyPaths: [string, string][] = [
  ["GET", "/api/family"],
  ["GET", "/api/photos"],
  ["GET", "/api/photos/p1/image"],
  ["GET", "/api/narrations"],
  ["GET", "/api/narrations/n1/audio"],
  ["GET", "/api/feed"],
  ["GET", "/api/entrances/today?memberId=m1"],
  ["POST", "/api/demo/clock/advance"],
  ["POST", "/api/invite/regenerate"],
];

describe("合言葉の cookie だけでは、どの書き方でも ops に届かない", () => {
  const cases = opsPaths.flatMap((p) => [...variants(p).map((v) => ["GET", v] as const), ["HEAD", p] as const]);
  it.each(cases)("%s %s", async (method, p) => {
    touched = [];
    const res = await app.request(new Request("http://localhost" + p, { method, headers: COOKIE }));
    expect([401, 404]).toContain(res.status);
    expect(beyondCookieCheck()).toEqual([]);
  });

  it("/api/ops そのもの、末尾なしも cookie では開かない", async () => {
    for (const p of ["/api/ops", "/api/OPS", "/api/ops/"]) {
      touched = [];
      const res = await app.request(p, { headers: COOKIE });
      expect([401, 404], p).toContain(res.status);
      expect(beyondCookieCheck(), p).toEqual([]);
    }
  });
});

describe("運営の鍵だけでは、どの書き方でも家族向けの入り口に届かない", () => {
  const cases = familyPaths.flatMap(([m, p]) => variants(p).map((v) => [m, v] as const));
  it.each(cases)("%s %s", async (method, p) => {
    touched = [];
    const res = await app.request(new Request("http://localhost" + p, { method, headers: BEARER }));
    expect([401, 404]).toContain(res.status);
    expect(touched).toEqual([]);
  });

  it("ops を名乗って家族の入り口へ抜けない", async () => {
    for (const p of [
      "/api/ops/../family",
      "/api/ops/%2e%2e/family",
      "/api/ops/%2E%2E/feed",
      "/api/ops%2f..%2ffamily",
      "/api/ops/families/../../family",
    ]) {
      touched = [];
      const res = await app.request(new Request("http://localhost" + p, { headers: BEARER }));
      expect([401, 404], p).toContain(res.status);
      expect(touched, p).toEqual([]);
    }
  });
});

describe("ops の確かめは、ほかの /api/* に掛かっていない", () => {
  it.each(familyPaths.filter(([m]) => m === "GET"))("%s %s は、合言葉の cookie でハンドラに届く（鍵を求めない）", async (method, p) => {
    touched = [];
    const res = await app.request(new Request("http://localhost" + p, { method, headers: COOKIE }));
    expect(res.status).not.toBe(401);
    // 引数の確かめで止まる入り口（photoId のない /api/narrations など）は 400 で、データベースに触れない
    if (res.status !== 400) expect(beyondCookieCheck().length).toBeGreaterThan(0);
  });

  it("/api/opsx や /api/ops-x は ops の扱いにならない（cookie の確認を通って 404）", async () => {
    for (const p of ["/api/opsx", "/api/ops-x/families/fam-qa/record", "/api/opsfamilies/fam-qa/record"]) {
      touched = [];
      const res = await app.request(p, { headers: COOKIE });
      expect(res.status, p).toBe(404);
      expect(touched, p).toEqual(["families.findByActiveInviteHash"]);
    }
  });
});

describe("鍵の書き方", () => {
  it.each([
    ["bearer " + KEY],
    ["BEARER " + KEY],
    ["Bearer  " + KEY],
    // 末尾の空白は Headers が値を整えるときに落ちるので、ここには入れない
    ["Bearer " + KEY.toUpperCase()],
    ["Bearer " + KEY.slice(0, -1)],
    ["Bearer " + KEY + "x"],
    ["Bearer " + KEY.padEnd(501, "x")],
    ["Basic " + KEY],
    [KEY],
    ["Bearer "],
  ])("Authorization: %s は 401 で、データベースに触れない", async (h) => {
    touched = [];
    const res = await app.request(opsPaths[0]!, { headers: { Authorization: h } });
    expect(res.status).toBe(401);
    expect(touched).toEqual([]);
  });

  it("鍵と cookie を両方付けても、鍵が違えば 401", async () => {
    touched = [];
    const res = await app.request(opsPaths[0]!, { headers: { ...COOKIE, Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
    expect(beyondCookieCheck()).toEqual([]);
  });

  it("正しい鍵なら、ops のハンドラに届く（確かめが効いている側の対照）", async () => {
    touched = [];
    const res = await app.request(opsPaths[0]!, { headers: BEARER });
    expect(res.status).toBe(404); // 架空のデータベースは家族を返さない
    expect(touched).toEqual(["families.get"]);
  });
});

describe("本番では、鍵が合っていても、どの書き方でも 404", () => {
  const prod = appFor("production");
  const cases = opsPaths.flatMap((p) => variants(p).map((v) => ["GET", v] as const));
  it.each(cases)("%s %s", async (method, p) => {
    touched = [];
    const res = await prod.request(new Request("http://localhost" + p, { method, headers: BEARER }));
    // ops と見なされない書き方（/api//ops/ など）は、合言葉の確認で 401。どちらでも中身は出ない
    expect([401, 404]).toContain(res.status);
    expect(touched).toEqual([]);
  });

  it("APP_ENV が production 以外の値でも、手元とプレビューの扱い（開く）。production だけ閉じる", async () => {
    touched = [];
    const res = await appFor("preview").request(opsPaths[0]!, { headers: BEARER });
    expect(res.status).toBe(404);
    expect(touched).toEqual(["families.get"]);
  });
});
