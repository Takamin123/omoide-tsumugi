// 合言葉の確認は一か所で、既定で閉じる（docs/implementation-policy.md 4、5 の 1 番目）。
// 確認しない入り口の一覧をここで固定する。入り口を足したら、ここが気づく。
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { FIRST_PERSON_ROUTES, isDemoResetPath, isFirstPersonRoute, isOpsPath, PUBLIC_ROUTES } from "../src/server/routes/auth";
import { fakeDeps } from "./helpers";

const app = createApp(() => fakeDeps());

/** アプリに登録された /api/* の入り口（ミドルウェアを除く） */
const apiRoutes = [
  ...new Set(
    app.routes
      .filter((r) => r.method !== "ALL" && r.path.startsWith("/api/"))
      .map((r) => `${r.method} ${r.path}`),
  ),
].sort();

describe("合言葉の確認", () => {
  it("確認しない入り口は、この 5 つだけ", () => {
    expect(PUBLIC_ROUTES.map(([m, p]) => `${m} ${p}`).sort()).toEqual([
      "GET /api/health",
      "POST /api/demo/guide", // 審査員の案内。合言葉の代わりに本文の鍵で守り、合わなければ 404（0062。test/demo-guide.test.ts）
      "POST /api/demo/guide/families", // 審査員が新しい家族を作る。同じ鍵（0062）
      "POST /api/families",
      "POST /api/session",
    ]);
  });

  it("登録されている入り口の一覧（増えたら、確認の要否を考えてからここを直す）", () => {
    expect(apiRoutes).toEqual([
      "DELETE /api/musubi/:musubiId/photos/:photoId", // はずす（0048）。合言葉を確かめる
      "DELETE /api/narrations/:id", // とりなおす（0050）。合言葉を確かめる
      "GET /api/entrances/:id/question-audio",
      "GET /api/entrances/today",
      "GET /api/family",
      "GET /api/feed",
      "GET /api/health",
      "GET /api/narrations",
      "GET /api/narrations/:id/audio",
      "GET /api/ops/families/:familyId/photos/:photoId/image",
      "GET /api/ops/families/:familyId/record",
      "GET /api/photos",
      "GET /api/photos/:id/image",
      "PATCH /api/members/:id",
      "POST /api/check/speech",
      "POST /api/check/transcribe",
      "POST /api/demo/clock/advance",
      "POST /api/demo/families/:familyId/reset",
      "POST /api/demo/guide",
      "POST /api/demo/guide/families",
      "POST /api/families",
      "POST /api/members",
      "POST /api/members/:id/link",
      "POST /api/narrations",
      "POST /api/photos",
      "POST /api/replies/seen", // 返事のタブを開いた（0058）。合言葉を確かめる
      "POST /api/session",
    ]);
  });

  it("最初の人のリンク（人を指さないリンク）で通せる入り口は、この 2 つだけ（0036）", () => {
    expect(FIRST_PERSON_ROUTES.map(([m, p]) => `${m} ${p}`).sort()).toEqual(["GET /api/family", "POST /api/members"]);
    // 一覧の入り口は、どれも登録されている（消したのに一覧に残っていない）
    for (const [m, p] of FIRST_PERSON_ROUTES) expect(apiRoutes).toContain(`${m} ${p}`);
  });

  it.each([
    ["GET", "/api/family", true],
    ["get", "/API/Family", true],
    ["POST", "/api/members", true],
    ["POST", "/api/members/x/link", false],
    ["PATCH", "/api/members/x", false],
    ["GET", "/api/members", false],
    ["POST", "/api/family", false],
    ["GET", "/api/family/", false],
    ["GET", "/api/feed", false],
  ])("最初の人のリンクで通すか: %s %s → %s", (method, p, expected) => {
    expect(isFirstPersonRoute(method, p)).toBe(expected);
  });

  it("合言葉の代わりに運営の鍵で守る入り口、/api/ops/ の下の読み取り 2 つだけ（0025）", () => {
    expect(apiRoutes.filter((r) => isOpsPath(r.split(" ")[1]!))).toEqual([
      "GET /api/ops/families/:familyId/photos/:photoId/image",
      "GET /api/ops/families/:familyId/record",
    ]);
  });

  it("合言葉の代わりにデモの初期化の鍵で守る入り口は、初期化 1 つだけ。デモの時計は合言葉のまま（0038）", () => {
    expect(apiRoutes.filter((r) => isDemoResetPath(r.split(" ")[1]!))).toEqual(["POST /api/demo/families/:familyId/reset"]);
    expect(isDemoResetPath("/api/demo/clock/advance")).toBe(false);
    expect(isDemoResetPath("/API/Demo/Families/x/reset")).toBe(true);
  });

  const guarded = apiRoutes.filter((r) => !PUBLIC_ROUTES.some(([m, p]) => `${m} ${p}` === r));
  it.each(guarded)("%s は合言葉なしで 401（データベースに触れる前に止まる）", async (route) => {
    const [method, path] = route.split(" ") as [string, string];
    const res = await app.request(path.replace(":id", "x"), { method });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("知らない /api/* も、合言葉なしなら 401（既定で閉じる）", async () => {
    expect((await app.request("/api/nope")).status).toBe(401);
  });

  it.each([
    ["GET", "/API/family"],
    ["GET", "/Api/photos"],
    ["GET", "/API/photos/x/image"],
    ["POST", "/Api/demo/clock/advance"],
    ["POST", "/api/Members/x/link"],
    ["GET", "/api"],
  ])("大文字・小文字を変えても素通りしない: %s %s → 401", async (method, p) => {
    const res = await app.request(p, { method });
    expect(res.status).toBe(401);
  });

  it("合言葉の cookie が長すぎれば、データベースを引かずに 401", async () => {
    const res = await app.request("/api/family", { headers: { Cookie: `omoide_invite=${"a".repeat(300)}` } });
    expect(res.status).toBe(401);
  });
});
