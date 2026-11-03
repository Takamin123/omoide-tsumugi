// デモの初期化の入り口（0038）。POST /api/demo/families/:familyId/reset
// 合言葉の cookie ではなく、デモの初期化の鍵（DEMO_RESET_TOKEN の Bearer）で守る。鍵の確かめは auth.ts の一か所（requireInvite）で行い、
// ここでも重ねて確かめる（パスの書き方で一か所目を外れても開かない）。環境では分けない（本番でもデモの家族だけを戻せる）。
// デモでない家族・ない家族は、存在しないものとして 404。返すのは ID と件数だけ。
import { Hono, type MiddlewareHandler } from "hono";
import type { DemoResetResult } from "../../shared/api";
import { resetDemoFamily } from "../core/demo-reset";
import { hasDemoResetKey } from "./auth";
import type { AppEnv } from "./env";
import { fail } from "./http";

const requireDemoResetKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await hasDemoResetKey(c))) return fail(c, "unauthorized");
  return next();
};

export const demo = new Hono<AppEnv>()
  // ここで "*" に掛けると、同じ "/" に載るほかの入り口にも掛かるので、/demo/families の下だけにする
  .use("/demo/families/*", requireDemoResetKey)
  .post("/demo/families/:familyId/reset", async (c) => {
    const r = await resetDemoFamily(c.get("deps"), c.req.param("familyId"));
    if (!r.ok) return fail(c, r.reason);
    c.header("Cache-Control", "private, no-store");
    return c.json(r.summary satisfies DemoResetResult);
  });
