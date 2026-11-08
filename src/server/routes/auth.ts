// 合言葉の確認。ここ一か所で行い、既定で閉じる（docs/implementation-policy.md 4）。
// 確認しない入り口は PUBLIC_ROUTES に明示的に並べる。それ以外の /api/* はすべて確認を通す。
// 一覧が変わったら test/auth.test.ts が気づく。
// 合言葉の代わりに別の鍵で守る入り口: 運営の記録（/api/ops/*、OPS_RECORD_TOKEN）と、デモの初期化（/api/demo/families/*、DEMO_RESET_TOKEN）。
// 審査員の案内（POST /api/demo/guide、DEMO_GUIDE_KEY）は PUBLIC_ROUTES に置き、入り口の中で本文の鍵を確かめる（0062）
// 審査員が見る Claude の記録（/api/demo/guide/record の下、DEMO_GUIDE_KEY の Bearer）は、合言葉の代わりに案内の鍵で守る。合わなければ 404（0062）
// リンクは一人ずつ（0036）。合言葉から家族と人を引き、人のいない「最初の人のリンク」で通せる入り口は FIRST_PERSON_ROUTES に並べる。
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { DEMO_GUIDE_KEY_PATTERN } from "../../shared/api";
import { hashToken, timingSafeEqual } from "../core/secrets";
import type { AppConfig, MemberRow } from "../core/ports";
import type { AppEnv } from "./env";
import { fail } from "./http";

export const INVITE_COOKIE = "omoide_invite";

/** 合言葉を確かめない入り口（メソッドとパスの完全一致） */
export const PUBLIC_ROUTES: readonly (readonly [method: string, path: string])[] = [
  ["GET", "/api/health"], // ヘルスチェック（秘密の値を使わず、通ったことだけを返す）
  ["POST", "/api/session"], // 合言葉の入力
  ["POST", "/api/families"], // 家族を作る。合言葉の代わりに CREATE_FAMILY_TOKEN（Bearer）で守る
  ["POST", "/api/demo/guide"], // 審査員の案内。合言葉の代わりに本文の鍵（DEMO_GUIDE_KEY）で守る。合わなければ 404（0062）
  ["POST", "/api/demo/guide/families"], // 審査員が新しい家族を作る。同じ鍵で守る。合わなければ 404（0062）
];

/**
 * 「最初の人のリンク」（人を指さないリンク。家族を作ったときの一度きり）で通せる入り口。
 * それ以外は、合言葉が有効でも 403 forbidden（cookie は消さない）。0036
 */
export const FIRST_PERSON_ROUTES: readonly (readonly [method: string, path: string])[] = [
  ["GET", "/api/family"], // 家族の様子（me は null）
  ["POST", "/api/members"], // 最初の一人を入れる（家族に人がいないときだけ。routes/members.ts）
];

// Hono のルーターはパスの大文字・小文字を区別しないので、ここでも小文字にそろえて比べる（/API/... で素通りさせない）
function inRoutes(routes: typeof PUBLIC_ROUTES, method: string, path: string): boolean {
  const p = path.toLowerCase();
  return routes.some(([m, r]) => m === method.toUpperCase() && r === p);
}

export function isPublicRoute(method: string, path: string): boolean {
  return inRoutes(PUBLIC_ROUTES, method, path);
}

export function isFirstPersonRoute(method: string, path: string): boolean {
  return inRoutes(FIRST_PERSON_ROUTES, method, path);
}

/** 合言葉を確かめる対象か。/api の下は大文字・小文字によらずすべて */
function isApiPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === "/api" || p.startsWith("/api/");
}

/**
 * 合言葉ではなく、運営の鍵（OPS_RECORD_TOKEN の Bearer）で守る入り口の頭。運営の記録の画面だけ（0025、0030）。
 * 家族の合言葉の cookie でも、家族を作る鍵（CREATE_FAMILY_TOKEN）でも開かない。
 * PUBLIC_ROUTES とは違い、確認を飛ばすのではなく、別の鍵で確かめる
 */
export const OPS_PATH_PREFIX = "/api/ops/";

/** 運営の鍵で守る入り口か（大文字・小文字によらない） */
export function isOpsPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === "/api/ops" || p.startsWith(OPS_PATH_PREFIX);
}

/** 運営の鍵の長さの下限。人間がランダムに作る（例: openssl rand -base64 32 は 44 文字）。0030 */
export const OPS_KEY_MIN_LENGTH = 32;

export type OpsKeyMisconfig = "too_short" | "same_as_create_family_token";

/**
 * 設定された運営の鍵が使えるか。短すぎる・家族を作る鍵と同じ値なら、設定なしとみなす（0027 の「別の鍵」を設定の誤りからも守る）。
 * 設定がないときは null（誤りではない）
 */
export function opsKeyMisconfig(config: AppConfig): OpsKeyMisconfig | null {
  const key = config.opsRecordToken;
  if (!key) return null;
  if (key.length < OPS_KEY_MIN_LENGTH) return "too_short";
  if (config.createFamilyToken && key === config.createFamilyToken) return "same_as_create_family_token";
  return null;
}

/** Authorization: Bearer の値が、運営の鍵と同じか。鍵の設定がない・使えない設定なら誰も通さない */
export async function hasOpsKey(c: Context<AppEnv>): Promise<boolean> {
  const config = c.get("deps").config;
  const expected = config.opsRecordToken;
  if (!expected) return false;
  const misconfig = opsKeyMisconfig(config);
  if (misconfig) {
    // 「鍵の打ち間違い」と「設定が弾かれた」を運営が見分けられるよう、種類だけを残す（値は残さない）
    console.warn(JSON.stringify({ event: "ops_key_misconfigured", reason: misconfig }));
    return false;
  }
  return bearerEquals(c, expected);
}

/** Authorization: Bearer の値が expected と同じか（時間が一定の比較） */
async function bearerEquals(c: Context<AppEnv>, expected: string): Promise<boolean> {
  const header = c.req.header("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!given || given.length > 500) return false;
  return timingSafeEqual(given, expected);
}

/**
 * 合言葉ではなく、デモの初期化の鍵（DEMO_RESET_TOKEN の Bearer）で守る入り口の頭（0038）。
 * POST /api/demo/families/:familyId/reset だけ。家族の合言葉の cookie でも、ほかの鍵でも開かない。
 * デモの時計（/api/demo/clock/advance）は家族の合言葉で守る入り口のまま（この頭の外）
 */
export const DEMO_RESET_PATH_PREFIX = "/api/demo/families/";

/** デモの初期化の鍵で守る入り口か（大文字・小文字によらない） */
export function isDemoResetPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === "/api/demo/families" || p.startsWith(DEMO_RESET_PATH_PREFIX);
}

export type DemoResetKeyMisconfig = "too_short" | "same_as_create_family_token" | "same_as_ops_record_token";

/**
 * 設定されたデモの初期化の鍵が使えるか。短すぎる・ほかの鍵と同じ値なら、設定なしとみなす（0030 と同じ規則。0038）。
 * 設定がないときは null（誤りではない）
 */
export function demoResetKeyMisconfig(config: AppConfig): DemoResetKeyMisconfig | null {
  const key = config.demoResetToken;
  if (!key) return null;
  if (key.length < OPS_KEY_MIN_LENGTH) return "too_short";
  if (config.createFamilyToken && key === config.createFamilyToken) return "same_as_create_family_token";
  if (config.opsRecordToken && key === config.opsRecordToken) return "same_as_ops_record_token";
  return null;
}

/** Authorization: Bearer の値が、デモの初期化の鍵と同じか。鍵の設定がない・使えない設定なら誰も通さない */
export async function hasDemoResetKey(c: Context<AppEnv>): Promise<boolean> {
  const config = c.get("deps").config;
  const expected = config.demoResetToken;
  if (!expected) return false;
  const misconfig = demoResetKeyMisconfig(config);
  if (misconfig) {
    console.warn(JSON.stringify({ event: "demo_reset_key_misconfigured", reason: misconfig }));
    return false;
  }
  return bearerEquals(c, expected);
}

export type DemoGuideKeyMisconfig =
  | "too_short"
  | "not_url_safe"
  | "same_as_create_family_token"
  | "same_as_ops_record_token"
  | "same_as_demo_reset_token";

/**
 * 設定された審査員の案内の鍵が使えるか。ほかの鍵と同じ規則（0030）に、URL の道に載せられることを足す（0062）。
 * 設定がないときは null（誤りではない）
 */
export function demoGuideKeyMisconfig(config: AppConfig): DemoGuideKeyMisconfig | null {
  const key = config.demoGuideKey;
  if (!key) return null;
  if (key.length < OPS_KEY_MIN_LENGTH) return "too_short";
  if (!DEMO_GUIDE_KEY_PATTERN.test(key)) return "not_url_safe";
  if (config.createFamilyToken && key === config.createFamilyToken) return "same_as_create_family_token";
  if (config.opsRecordToken && key === config.opsRecordToken) return "same_as_ops_record_token";
  if (config.demoResetToken && key === config.demoResetToken) return "same_as_demo_reset_token";
  return null;
}

/** 渡された鍵が案内の鍵と同じか（時間が一定の比較）。設定がない・使えない設定なら誰も通さない */
export async function matchesDemoGuideKey(config: AppConfig, given: string): Promise<boolean> {
  const expected = config.demoGuideKey;
  if (!expected) return false;
  const misconfig = demoGuideKeyMisconfig(config);
  if (misconfig) {
    console.warn(JSON.stringify({ event: "demo_guide_key_misconfigured", reason: misconfig }));
    return false;
  }
  return timingSafeEqual(given, expected);
}

/**
 * 合言葉ではなく、審査員の案内の鍵（DEMO_GUIDE_KEY の Bearer）で守る入り口の頭（0062 の追記 2026-11-08）。
 * 台本のデモの家族の記録を読み取りだけで返す。GET /api/demo/guide/record と、その写真だけ。
 * 家族の合言葉の cookie でも、ほかの鍵でも開かない。合わなければ（設定なしも）区別せず 404
 */
export const DEMO_GUIDE_RECORD_PATH = "/api/demo/guide/record";

/** 審査員の記録の入り口か（大文字・小文字によらない） */
export function isDemoGuideRecordPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === DEMO_GUIDE_RECORD_PATH || p.startsWith(`${DEMO_GUIDE_RECORD_PATH}/`);
}

/** Authorization: Bearer の値が、案内の鍵と同じか。鍵の設定がない・使えない設定なら誰も通さない。検索語の鍵は見ない */
export async function hasDemoGuideKey(c: Context<AppEnv>): Promise<boolean> {
  const header = c.req.header("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!DEMO_GUIDE_KEY_PATTERN.test(given)) return false;
  return matchesDemoGuideKey(c.get("deps").config, given);
}

/**
 * すべての要求に掛ける（app.use("*")）。/api の下で PUBLIC_ROUTES にないものは、合言葉がなければ 401。
 * 合言葉が人を指さない（最初の人のリンク）なら、FIRST_PERSON_ROUTES のほかは 403
 */
export const requireInvite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isApiPath(c.req.path) || isPublicRoute(c.req.method, c.req.path)) return next();
  // 運営の入り口は合言葉では開かない。運営の鍵だけで確かめる（family は置かない）
  if (isOpsPath(c.req.path)) return (await hasOpsKey(c)) ? next() : fail(c, "unauthorized");
  // デモの初期化も合言葉では開かない。初期化の鍵だけで確かめる（family は置かない。0038）
  if (isDemoResetPath(c.req.path)) return (await hasDemoResetKey(c)) ? next() : fail(c, "unauthorized");
  // 審査員の記録も合言葉では開かない。案内の鍵だけで確かめ、合わなければ案内と同じく 404（family は置かない。0062）
  if (isDemoGuideRecordPath(c.req.path)) {
    c.header("Cache-Control", "private, no-store");
    return (await hasDemoGuideKey(c)) ? next() : fail(c, "not_found");
  }
  const token = getCookie(c, INVITE_COOKIE);
  if (!token || token.length > 200) return fail(c, "unauthorized");
  const link = await c.get("deps").repos.families.findActiveLink(await hashToken(token));
  if (!link) {
    deleteCookie(c, INVITE_COOKIE, { path: "/" });
    return fail(c, "unauthorized");
  }
  if (!link.member && !isFirstPersonRoute(c.req.method, c.req.path)) return fail(c, "forbidden");
  c.set("family", link.family);
  c.set("member", link.member);
  return next();
};

/**
 * この端末の人。FIRST_PERSON_ROUTES 以外の入り口では、requireInvite が人のいるリンクだけを通しているので必ずいる。
 * いなければ設定の誤り（入り口を FIRST_PERSON_ROUTES に足したのに、人のいない場合を書いていない）なので、通さない
 */
export function currentMember(c: Context<AppEnv>): MemberRow {
  const m = c.get("member");
  if (!m) throw new Error("member_missing");
  return m;
}

/** 家族のこと（人を足す・直す、リンクを作る）を触れるか。祖父母の画面の人は触れない（0036） */
export function canManageFamily(m: MemberRow | null): m is MemberRow {
  return m?.role === "family";
}

export function setInviteCookie(c: Context, token: string): void {
  setCookie(c, INVITE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 400 * 24 * 60 * 60, // ブラウザが許す最長（400 日）
  });
}
