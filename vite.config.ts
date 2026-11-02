import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// フロントエンド（React）と Worker（Hono）を、一つの Worker から配信する。
// 環境（本番／preview）は CLOUDFLARE_ENV で選ぶ。ビルドのときに決まり、deploy では変えられない。
export default defineConfig({
  plugins: [react(), cloudflare()],
});
