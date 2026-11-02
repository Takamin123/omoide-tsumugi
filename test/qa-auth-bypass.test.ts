// 合言葉の確認を、パスの書き方を変えて素通りできないこと（qa-engineer）。
// 合言葉なしで、ハンドラ（とデータベース）に届いたら失敗にする。
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import type { Repositories } from "../src/server/core/ports";
import { fakeDeps } from "./helpers";

let touched: string[] = [];
const spyRepos = new Proxy({} as Repositories, {
  get(_t, table: string) {
    return new Proxy(
      {},
      {
        get(_t2, fn: string) {
          return async () => {
            touched.push(`${table}.${fn}`);
            return null;
          };
        },
      },
    );
  },
});
const app = createApp(() => fakeDeps({ repos: spyRepos }));

const guarded: [string, string][] = [
  ["GET", "/api/family"],
  ["GET", "/api/photos"],
  ["GET", "/api/photos/x/image"],
  ["GET", "/api/narrations/x/audio"],
  ["GET", "/api/feed"],
  ["POST", "/api/demo/clock/advance"],
  ["POST", "/api/invite/regenerate"],
];

const variants = (p: string): string[] => [
  p.toUpperCase(),
  p.replace("/api/", "/aPi/"),
  p.replace("/api/", "/%61pi/"), // パーセント符号化
  p.replace("/api/", "/%41PI/"),
  p.replace(/\/([a-z])/g, (_m, ch: string) => `/%${ch.charCodeAt(0).toString(16)}`), // 各区切りの先頭を符号化
  p + "/",
  "/" + p, // 先頭の二重スラッシュ
  p.replace("/api/", "/api//"),
  p.replace("/api/", "/api/./"),
  p.replace("/api/", "/x/../api/"),
  p.replace("/api/", "/api%2f"),
  p.replace("/api/", "/api%2F"),
  p + "?x=1",
  p + "#frag",
  p + ";x",
];

const cases = guarded.flatMap(([m, p]) => [...variants(p).map((v) => [m, v] as const), ["HEAD", p] as const]);

describe("パスの書き方を変えても、合言葉なしではハンドラに届かない", () => {
  it.each(cases)("%s %s", async (method, p) => {
    touched = [];
    const res = await app.request(new Request("http://localhost" + p, { method }));
    expect([401, 404]).toContain(res.status);
    expect(touched).toEqual([]);
  });

  it("公開の入り口を名乗っても、別の入り口には届かない", async () => {
    for (const p of ["/api/health/../family", "/api/session/../family", "/API/HEALTH/../photos"]) {
      touched = [];
      const res = await app.request(new Request("http://localhost" + p));
      expect([401, 404]).toContain(res.status);
      expect(touched).toEqual([]);
    }
  });
});
