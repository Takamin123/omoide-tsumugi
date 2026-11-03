// 合言葉の確認は一か所で、既定で閉じる（docs/implementation-policy.md 4、5 の 1 番目）。
// 確認しない入り口の一覧をここで固定する。入り口を足したら、ここが気づく。
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { isOpsPath, PUBLIC_ROUTES } from "../src/server/routes/auth";
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
  it("確認しない入り口は、この 3 つだけ", () => {
    expect(PUBLIC_ROUTES.map(([m, p]) => `${m} ${p}`).sort()).toEqual([
      "GET /api/health",
      "POST /api/families",
      "POST /api/session",
    ]);
  });

  it("登録されている入り口の一覧（増えたら、確認の要否を考えてからここを直す）", () => {
    expect(apiRoutes).toEqual([
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
      "POST /api/families",
      "POST /api/invite/regenerate",
      "POST /api/members",
      "POST /api/narrations",
      "POST /api/photos",
      "POST /api/session",
    ]);
  });

  it("合言葉の代わりに運営の鍵で守る入り口は、/api/ops/ の下の読み取り 2 つだけ（0025）", () => {
    expect(apiRoutes.filter((r) => isOpsPath(r.split(" ")[1]!))).toEqual([
      "GET /api/ops/families/:familyId/photos/:photoId/image",
      "GET /api/ops/families/:familyId/record",
    ]);
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
    ["POST", "/api/Invite/regenerate"],
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
