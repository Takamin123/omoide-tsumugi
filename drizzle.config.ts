import { defineConfig } from "drizzle-kit";

// マイグレーションの SQL を作るだけに使う（適用は wrangler d1 migrations apply。/d1-migrate を参照）。
// dialect は sqlite にして、D1 と better-sqlite3 のどちらにも同じ SQL を使えるようにする。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle/migrations",
});
