// Workers の入り口。Workers 専用の API（env.DB、env.BUCKET、ExecutionContext）を使うのは、この層だけにする。
import { createAnthropicClaude } from "../../adapters/anthropic-claude";
import { createOpenAITranscribeProbe, createOpenAITranscriber } from "../../adapters/openai-transcriber";
import { createOpenAISpeaker, createOpenAISpeechProbe } from "../../adapters/openai-speech";
import { createApp } from "../../app";
import type { AppDeps } from "../../core/ports";
import { notConfiguredClaude } from "../../core/claude";
import { runMorning } from "../../core/morning";
import { notConfiguredTranscriber } from "../../core/transcribe";
import { createD1Repositories } from "./d1-repositories";
import { createR2PhotoStore } from "./r2-photo-store";

/** wrangler secret / .dev.vars で入れる秘密の値（wrangler types には出ないことがあるので、ここで名前を持つ） */
type Secrets = { OPENAI_API_KEY?: string; ANTHROPIC_API_KEY?: string; CREATE_FAMILY_TOKEN?: string };

// ctx は waitUntil だけを使う（Hono の executionCtx と、Workers の ExecutionContext の両方を受けられるようにする）
export function createCloudflareDeps(env: Env, ctx: Pick<ExecutionContext, "waitUntil">): AppDeps {
  const secrets = env as Env & Secrets;
  return {
    repos: createD1Repositories(env.DB),
    photos: createR2PhotoStore(env.BUCKET),
    transcriber: secrets.OPENAI_API_KEY ? createOpenAITranscriber(secrets.OPENAI_API_KEY) : notConfiguredTranscriber,
    claude: secrets.ANTHROPIC_API_KEY ? createAnthropicClaude(secrets.ANTHROPIC_API_KEY) : notConfiguredClaude,
    transcribeProbe: secrets.OPENAI_API_KEY ? createOpenAITranscribeProbe(secrets.OPENAI_API_KEY) : null,
    speechProbe: secrets.OPENAI_API_KEY ? createOpenAISpeechProbe(secrets.OPENAI_API_KEY) : null,
    speaker: secrets.OPENAI_API_KEY ? createOpenAISpeaker(secrets.OPENAI_API_KEY) : null,
    runInBackground: (task) => ctx.waitUntil(task),
    config: {
      // 分からないときは本番とみなす（時計を使える家族を狭い側に倒す）
      appEnv: (env as { APP_ENV?: string }).APP_ENV ?? "production",
      createFamilyToken: secrets.CREATE_FAMILY_TOKEN || null,
    },
    now: () => new Date(),
  };
}

const app = createApp<Env>((c) => createCloudflareDeps(c.env, c.executionCtx));

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    await runMorning(createCloudflareDeps(env, ctx), new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
