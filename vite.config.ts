import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { unstable_readConfig } from "wrangler";
import { includeCheckPage } from "./vite.check-page";

// フロントエンド（React）と Worker（Hono）を、一つの Worker から配信する。
// 環境（本番／preview）は CLOUDFLARE_ENV で選ぶ。ビルドのときに決まり、deploy では変えられない。
export default defineConfig(({ command }) => {
  // その環境の APP_ENV を、Worker と同じ wrangler.jsonc から読む。
  // 本番のビルドでは __CHECK_PAGE__ が false になり、開発用の /check の chunk が出力に入らない（0014）
  const appEnv = unstable_readConfig(
    { config: fileURLToPath(new URL("./wrangler.jsonc", import.meta.url)), env: process.env.CLOUDFLARE_ENV || undefined },
    { hideWarnings: true },
  ).vars?.APP_ENV;
  const checkPage = includeCheckPage({ command, appEnv: typeof appEnv === "string" ? appEnv : undefined });
  return {
    plugins: [react(), cloudflare()],
    define: { __CHECK_PAGE__: JSON.stringify(checkPage) },
  };
});
