// デモの初期化の入り口（0038）。POST /api/demo/families/:familyId/reset
// 合言葉の cookie ではなく、デモの初期化の鍵（DEMO_RESET_TOKEN の Bearer）で守る。鍵の確かめは auth.ts の一か所（requireInvite）で行い、
// ここでも重ねて確かめる（パスの書き方で一か所目を外れても開かない）。環境では分けない（本番でもデモの家族だけを戻せる）。
// デモでない家族・ない家族は、存在しないものとして 404。返すのは ID と件数だけ。
// 審査員の案内の入り口（0062）。POST /api/demo/guide。本文の鍵（DEMO_GUIDE_KEY）が合えば、デモの家族の 4 人のリンクの合言葉を返す。
// 設定なし・鍵の不一致・形の違いは、区別せず 404。鍵とリンクはログに出さない。実際の家族のリンクを誤って返さないよう、一つずつ確かめる。
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { demoGuideInputSchema, type DemoGuideResult, type DemoResetResult } from "../../shared/api";
import { resetDemoFamily } from "../core/demo-reset";
import type { AppConfig } from "../core/ports";
import { hashToken } from "../core/secrets";
import { SEED_MEMBERS } from "../demo/seed";
import { demoGuideKeyUsable, hasDemoResetKey, matchesDemoGuideKey } from "./auth";
import type { AppEnv } from "./env";
import { fail, parseJsonString, parseWith, readJson } from "./http";

const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);
/** 台本の 4 人の呼ばれ方 → 合言葉。一人でも欠ける・余る・形が違うなら、設定の誤り */
const demoGuideLinksSchema = z.strictObject(Object.fromEntries(SEED_MEMBERS.map((m) => [m.calledAs, inviteToken])));

function readDemoGuideLinks(config: AppConfig): Record<string, string> | null {
  return parseWith(demoGuideLinksSchema, parseJsonString(config.demoGuideLinks)) as Record<string, string> | null;
}

/**
 * 審査員の案内が開いているか（鍵とリンクの設定がどちらも使える）。開いている間は、デモの家族の人とリンクを変えられない（routes/members.ts）。
 * 初期化（0038）は人とリンクに触れず、審査員が壊すと戻せないため。秘密の値を消せば、運営は従来どおり直せる（0062）
 */
export function demoGuideOpen(config: AppConfig): boolean {
  return demoGuideKeyUsable(config) && readDemoGuideLinks(config) !== null;
}

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
  })
  .post("/demo/guide", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const deps = c.get("deps");
    const input = parseWith(demoGuideInputSchema, await readJson(c));
    if (!input || !(await matchesDemoGuideKey(deps.config, input.key))) return fail(c, "not_found");
    const links = readDemoGuideLinks(deps.config);
    if (!links) {
      console.warn(JSON.stringify({ event: "demo_guide_links_misconfigured" }));
      return fail(c, "not_found");
    }
    const people: DemoGuideResult["people"] = [];
    for (const { calledAs } of SEED_MEMBERS) {
      const token = links[calledAs]!;
      const found = await deps.repos.families.findActiveLink(await hashToken(token));
      // デモの家族の、その呼ばれ方の人のリンクだけを返す（実際の家族のリンクを誤って載せても返さない）
      if (found?.family.isDemo && found.member?.calledAs === calledAs) people.push({ calledAs, token });
      else {
        const reason = !found ? "inactive" : !found.family.isDemo ? "not_demo" : "other_member";
        console.warn(JSON.stringify({ event: "demo_guide_link_unusable", reason, memberId: found?.member?.id ?? null }));
      }
    }
    if (people.length === 0) return fail(c, "not_found");
    return c.json({ people } satisfies DemoGuideResult);
  });
