import { Hono, type Context } from "hono";
import type { AppDeps } from "./core/ports";
import { check } from "./routes/check";
import { requireInvite } from "./routes/auth";
import { entrances } from "./routes/entrances";
import type { AppEnv } from "./routes/env";
import { family } from "./routes/family";
import { health } from "./routes/health";
import { fail } from "./routes/http";
import { members } from "./routes/members";
import { narrations } from "./routes/narrations";
import { ops } from "./routes/ops";
import { photos } from "./routes/photos";

export type { AppEnv } from "./routes/env";

/**
 * Hono のアプリを作る。実行環境のことは知らない。
 * 依存は入り口の層（platform/cloudflare/entry.ts、将来は Node 用の入り口）が makeDeps で渡す。
 */
export function createApp<B extends object = object>(
  makeDeps: (c: Context<{ Bindings: B } & AppEnv>) => AppDeps,
) {
  const app = new Hono<{ Bindings: B } & AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", makeDeps(c));
    await next();
  });
  // 合言葉の確認。/api/* はすべてここを通る（確認しない入り口は routes/auth.ts の PUBLIC_ROUTES だけ。/api/ops/* は合言葉の代わりに運営の鍵）
  app.use("*", requireInvite);

  const api = new Hono<AppEnv>()
    .route("/health", health)
    .route("/", family)
    .route("/", members)
    .route("/", photos)
    .route("/", narrations)
    .route("/", entrances)
    .route("/", check)
    .route("/", ops);
  app.route("/api", api);
  app.all("/api/*", (c) => fail(c, "not_found"));

  app.onError((err, c) => {
    // 外のエラーの本文は入力を含むことがあるので、種類だけを出す
    console.error(JSON.stringify({ event: "request_error", path: c.req.routePath, kind: err.name }));
    return fail(c, "internal");
  });

  return app;
}
