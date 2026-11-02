// 合言葉の確認。ここ一か所で行い、既定で閉じる（docs/implementation-policy.md 4）。
// 確認しない入り口は PUBLIC_ROUTES に明示的に並べる。それ以外の /api/* はすべて確認を通す。
// 一覧が変わったら test/auth.test.ts が気づく。
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashToken, timingSafeEqual } from "../core/secrets";
import type { AppEnv } from "./env";
import { fail } from "./http";

export const INVITE_COOKIE = "omoide_invite";

/** 合言葉を確かめない入り口（メソッドとパスの完全一致） */
export const PUBLIC_ROUTES: readonly (readonly [method: string, path: string])[] = [
  ["GET", "/api/health"], // ヘルスチェック（秘密の値を使わず、通ったことだけを返す）
  ["POST", "/api/session"], // 合言葉の入力
  ["POST", "/api/families"], // 家族を作る。合言葉の代わりに CREATE_FAMILY_TOKEN（Bearer）で守る
];

// Hono のルーターはパスの大文字・小文字を区別しないので、ここでも小文字にそろえて比べる（/API/... で素通りさせない）
export function isPublicRoute(method: string, path: string): boolean {
  const p = path.toLowerCase();
  return PUBLIC_ROUTES.some(([m, pub]) => m === method.toUpperCase() && pub === p);
}

/** 合言葉を確かめる対象か。/api の下は大文字・小文字によらずすべて */
function isApiPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === "/api" || p.startsWith("/api/");
}

/**
 * 合言葉ではなく、運営の鍵（CREATE_FAMILY_TOKEN の Bearer）で守る入り口の頭。運営の記録の画面だけ（0025）。
 * 家族の合言葉の cookie では開かない。PUBLIC_ROUTES とは違い、確認を飛ばすのではなく、別の鍵で確かめる
 */
export const OPS_PATH_PREFIX = "/api/ops/";

/** 運営の鍵で守る入り口か（大文字・小文字によらない） */
export function isOpsPath(path: string): boolean {
  const p = path.toLowerCase();
  return p === "/api/ops" || p.startsWith(OPS_PATH_PREFIX);
}

/** Authorization: Bearer の値が、運営の鍵と同じか。鍵の設定がなければ誰も通さない */
export async function hasOpsKey(c: Context<AppEnv>): Promise<boolean> {
  const expected = c.get("deps").config.createFamilyToken;
  const header = c.req.header("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!expected || !given || given.length > 500) return false;
  return timingSafeEqual(given, expected);
}

/** すべての要求に掛ける（app.use("*")）。/api の下で PUBLIC_ROUTES にないものは、合言葉がなければ 401 */
export const requireInvite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isApiPath(c.req.path) || isPublicRoute(c.req.method, c.req.path)) return next();
  // 運営の入り口は合言葉では開かない。運営の鍵だけで確かめる（family は置かない）
  if (isOpsPath(c.req.path)) return (await hasOpsKey(c)) ? next() : fail(c, "unauthorized");
  const token = getCookie(c, INVITE_COOKIE);
  if (!token || token.length > 200) return fail(c, "unauthorized");
  const family = await c.get("deps").repos.families.findByActiveInviteHash(await hashToken(token));
  if (!family) {
    deleteCookie(c, INVITE_COOKIE, { path: "/" });
    return fail(c, "unauthorized");
  }
  c.set("family", family);
  return next();
};

export function setInviteCookie(c: Context, token: string): void {
  setCookie(c, INVITE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 400 * 24 * 60 * 60, // ブラウザが許す最長（400 日）
  });
}
