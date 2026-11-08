// デモの初期化の入り口（0038）。POST /api/demo/families/:familyId/reset
// 合言葉の cookie ではなく、デモの初期化の鍵（DEMO_RESET_TOKEN の Bearer）で守る。鍵の確かめは auth.ts の一か所（requireInvite）で行い、
// ここでも重ねて確かめる（パスの書き方で一か所目を外れても開かない）。環境では分けない（本番でもデモの家族だけを戻せる）。
// デモでない家族・ない家族は、存在しないものとして 404。返すのは ID と件数だけ。
// 審査員の案内の入り口（0062）。POST /api/demo/guide。本文の鍵（DEMO_GUIDE_KEY）が合えば、デモの家族の 4 人のリンクの合言葉を返す。
// 設定なし・鍵の不一致・形の違いは、区別せず 404。鍵とリンクはログに出さない。実際の家族のリンクを誤って返さないよう、一つずつ確かめる。
// 審査員が見る Claude の記録（0062 の追記 2026-11-08）。GET /api/demo/guide/record と写真。案内の鍵（Bearer）で守り、
// 家族は要求から受け取らず、案内のリンクをたどった台本の家族だけ。読み取りだけ。中身は運営の記録（/api/ops/*）と同じ形。
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { demoGuideInputSchema, type DemoGuideResult, type DemoResetResult } from "../../shared/api";
import { jstDate } from "../core/clock";
import { resetDemoFamily } from "../core/demo-reset";
import type { AppConfig, FamilyRow } from "../core/ports";
import { hashToken, newInviteToken } from "../core/secrets";
import { SEED_MEMBERS } from "../demo/seed";
import { hasDemoGuideKey, hasDemoResetKey, matchesDemoGuideKey, setInviteCookie } from "./auth";
import type { AppEnv } from "./env";
import { fail, parseJsonString, parseWith, readJson } from "./http";
import { buildOpsRecord, opsPhotoImage, opsRecordCounts } from "./ops";

const inviteToken = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);
/** 台本の 4 人の呼ばれ方 → 合言葉。一人でも欠ける・余る・形が違うなら、設定の誤り */
const demoGuideLinksSchema = z.strictObject(Object.fromEntries(SEED_MEMBERS.map((m) => [m.calledAs, inviteToken])));

function readDemoGuideLinks(config: AppConfig): Record<string, string> | null {
  return parseWith(demoGuideLinksSchema, parseJsonString(config.demoGuideLinks)) as Record<string, string> | null;
}

/**
 * 審査員の案内から作った家族の印（families.name。名前としては使っていない列）。数える・見分ける・審査の後に消す家族を引く、に使う。
 * 移行を足さないための形で、家族の名前を画面に出すようになったら列を分ける（0062）
 */
export const DEMO_GUIDE_FAMILY_NAME = "demo-guide";
/** 審査員の案内から作れる家族の合計 */
export const DEMO_GUIDE_FAMILY_LIMIT = 20;

/**
 * 案内の鍵が設定されている間、デモの家族（案内から作った家族を除く）の人とリンクを変えられない（routes/members.ts）。
 * 初期化（0038）は人とリンクに触れず、審査員が壊すと戻せないため。鍵やリンクの設定が読めなくても、鍵があれば閉じる側に倒す。
 * 読み取りを足さない。鍵を消せば、運営は従来どおり直せる（0062）
 */
export function lockedByDemoGuide(config: AppConfig, family: { isDemo: boolean; name: string | null }): boolean {
  return config.demoGuideKey !== null && family.isDemo && family.name !== DEMO_GUIDE_FAMILY_NAME;
}

type Deps = AppEnv["Variables"]["deps"];

/**
 * 案内のリンクのうち、デモの家族の、その呼ばれ方の人を指す有効なものだけを、台本の並びで返す。
 * 実際の家族のリンクを誤って載せても返さない。使えないリンクは種類だけをログに残す（合言葉は残さない）
 */
async function usableGuideLinks(deps: Deps, links: Record<string, string>) {
  const usable: { calledAs: string; token: string; family: FamilyRow }[] = [];
  for (const { calledAs } of SEED_MEMBERS) {
    const token = links[calledAs]!;
    const found = await deps.repos.families.findActiveLink(await hashToken(token));
    if (found?.family.isDemo && found.member?.calledAs === calledAs) usable.push({ calledAs, token, family: found.family });
    else {
      const reason = !found ? "inactive" : !found.family.isDemo ? "not_demo" : "other_member";
      console.warn(JSON.stringify({ event: "demo_guide_link_unusable", reason, memberId: found?.member?.id ?? null }));
    }
  }
  return usable;
}

/**
 * 審査員が記録を見てよい、台本の家族。案内のリンクをたどって決める（要求から家族 ID を受け取らない）。
 * 案内から作った家族は外す。リンクの設定が読めない・使えるリンクがない・リンクが別々の家族を指すなら null（どれも 404）
 */
async function guideScriptFamily(deps: Deps): Promise<FamilyRow | null> {
  const links = readDemoGuideLinks(deps.config);
  if (!links) {
    console.warn(JSON.stringify({ event: "demo_guide_links_misconfigured" }));
    return null;
  }
  const families = (await usableGuideLinks(deps, links))
    .map((l) => l.family)
    .filter((f) => f.name !== DEMO_GUIDE_FAMILY_NAME);
  const ids = new Set(families.map((f) => f.id));
  if (ids.size !== 1) {
    if (ids.size > 1) console.warn(JSON.stringify({ event: "demo_guide_record_families_differ", count: ids.size }));
    return null;
  }
  return families[0]!;
}

const guideImageUrl = (photoId: string) => `/api/demo/guide/record/photos/${encodeURIComponent(photoId)}/image`;

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
    const people: DemoGuideResult["people"] = (await usableGuideLinks(deps, links)).map(({ calledAs, token }) => ({ calledAs, token }));
    if (people.length === 0) return fail(c, "not_found");
    return c.json({ people } satisfies DemoGuideResult);
  })
  // 審査員が新しい家族を作る（0062）。案内の鍵を合言葉の代わりにする。デモの家族で時計つき（Cron の対象外）。
  // 最初の人のリンクの合言葉は cookie にだけ置く（リンクの画面を挟まず、最初の人を入れる画面へ進む）
  .post("/demo/guide/families", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const deps = c.get("deps");
    const input = parseWith(demoGuideInputSchema, await readJson(c));
    if (!input || !(await matchesDemoGuideKey(deps.config, input.key)) || !readDemoGuideLinks(deps.config)) return fail(c, "not_found");
    const now = deps.now();
    const token = newInviteToken();
    const familyId = crypto.randomUUID();
    const created = await deps.repos.families.createWithinLimit(
      { id: familyId, name: DEMO_GUIDE_FAMILY_NAME, isDemo: true, clock: { date: jstDate(now), slot: "morning" } },
      { id: crypto.randomUUID(), tokenHash: await hashToken(token) },
      now.getTime(),
      DEMO_GUIDE_FAMILY_LIMIT,
    );
    if (!created) return fail(c, "family_limit");
    setInviteCookie(c, token);
    return c.body(null, 204);
  })
  // 審査員が見る Claude の記録（0062 の追記 2026-11-08）。鍵は auth.ts の一か所（requireInvite）で確かめ、ここでも重ねて確かめる
  .get("/demo/guide/record", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const deps = c.get("deps");
    if (!(await hasDemoGuideKey(c))) return fail(c, "not_found");
    const family = await guideScriptFamily(deps);
    if (!family) return fail(c, "not_found");
    const record = await buildOpsRecord(deps, family, guideImageUrl);
    console.log(JSON.stringify({ event: "demo_guide_record", familyId: family.id, ...opsRecordCounts(record) }));
    return c.json(record);
  })
  .get("/demo/guide/record/photos/:photoId/image", async (c) => {
    c.header("Cache-Control", "private, no-store");
    const deps = c.get("deps");
    if (!(await hasDemoGuideKey(c))) return fail(c, "not_found");
    const family = await guideScriptFamily(deps);
    if (!family) return fail(c, "not_found");
    return (await opsPhotoImage(deps, family.id, c.req.param("photoId"))) ?? fail(c, "not_found");
  });
