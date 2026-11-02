import { defineConfig } from "vitest/config";

// 出し比べ（本物の Claude を呼ぶ）。npm test には入れない（vitest.config.ts は test/ だけを見る）。
// 手元で ANTHROPIC_API_KEY があるときだけ動く。架空の家族（evals/fixtures/）だけを使う。
//   ANTHROPIC_API_KEY=... npm run eval:clean
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    testTimeout: 15 * 60_000,
  },
});
