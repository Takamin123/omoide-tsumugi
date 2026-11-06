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
type Secrets = {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  CREATE_FAMILY_TOKEN?: string;
  OPS_RECORD_TOKEN?: string;
  /** 運営が記録を見てよい、デモでない家族の ID（カンマ区切り）。実際の家族の識別子なので、vars ではなく秘密に置く（0030） */
  OPS_RECORD_FAMILIES?: string;
  /** デモの初期化の鍵。32 文字以上で、ほかの鍵と別の値（0038） */
  DEMO_RESET_TOKEN?: string;
  /** 審査員の案内の鍵（/demo/<鍵>）と、並べる 4 人のリンク（JSON）。本番には登録しない（0062） */
  DEMO_GUIDE_KEY?: string;
  DEMO_GUIDE_LINKS?: string;
};

/** カンマ区切りの家族 ID を、空白と空の項目を除いて並べる */
export const parseFamilyIds = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

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
      opsRecordToken: secrets.OPS_RECORD_TOKEN || null,
      opsRecordFamilies: parseFamilyIds(secrets.OPS_RECORD_FAMILIES),
      demoResetToken: secrets.DEMO_RESET_TOKEN || null,
      demoGuideKey: secrets.DEMO_GUIDE_KEY || null,
      demoGuideLinks: secrets.DEMO_GUIDE_LINKS || null,
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
