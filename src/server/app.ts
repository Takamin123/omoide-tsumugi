import { Hono, type Context } from "hono";
import type { AppDeps } from "./core/ports";
import { health } from "./routes/health";

export type AppEnv = { Variables: { deps: AppDeps } };

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

  const api = new Hono<AppEnv>().route("/health", health);
  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

  return app;
}
