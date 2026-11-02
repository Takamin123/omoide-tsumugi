import { defineConfig } from "vitest/config";

// テストは Node で動かす。アプリ（src/server/app.ts）は Workers の API に頼らないので、
// 偽の依存を渡して確かめられる。これが VPS への逃げ道が保たれていることの確かめにもなる。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
