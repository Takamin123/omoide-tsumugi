// 合言葉の確認。ここ一か所で行い、既定で閉じる（docs/implementation-policy.md 4）。
// 確認しない入り口は PUBLIC_ROUTES に明示的に並べる。それ以外の /api/* はすべて確認を通す。
// 一覧が変わったら test/auth.test.ts が気づく。
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashToken } from "../core/secrets";
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

/** すべての要求に掛ける（app.use("*")）。/api の下で PUBLIC_ROUTES にないものは、合言葉がなければ 401 */
export const requireInvite: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isApiPath(c.req.path) || isPublicRoute(c.req.method, c.req.path)) return next();
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
