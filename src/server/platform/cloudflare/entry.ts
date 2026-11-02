// Workers の入り口。Workers 専用の API（env.DB、env.BUCKET、ExecutionContext）を使うのは、この層だけにする。
import { createApp } from "../../app";
import type { AppDeps } from "../../core/ports";
import { runMorning } from "../../core/morning";
import { createD1Repositories } from "./d1-repositories";
import { createR2PhotoStore } from "./r2-photo-store";

// ctx は waitUntil だけを使う（Hono の executionCtx と、Workers の ExecutionContext の両方を受けられるようにする）
export function createCloudflareDeps(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): AppDeps {
  return {
    repos: createD1Repositories(env.DB),
    photos: createR2PhotoStore(env.BUCKET),
    runInBackground: (task) => ctx.waitUntil(task),
  };
}

const app = createApp<Env>((c) => createCloudflareDeps(c.env, c.executionCtx));

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    await runMorning(createCloudflareDeps(env, ctx), new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
