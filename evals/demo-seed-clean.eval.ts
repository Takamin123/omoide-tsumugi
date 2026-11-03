// デモの種の声の語り（台本そのままの transcript）を、本物の Haiku で一度だけ整え、その結果を
// src/server/demo/seed-cleaned.ts に書き出す（0038）。初期化はこの結果を写すだけで、毎回 Claude を呼ばない。
// 手で整えた文に model を付けないため、ここで本物の応答を受け、モデルと版をそのまま残す。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   npm run eval:demo-seed（worktree では EVAL_DEV_VARS=<メインの .dev.vars> を付ける）
// アプリと同じ部品（buildCleanInput、checkMarked、parseMarked、PROMPTS）を使い、検査も同じにする。
// 台本の語りを変えたとき・clean_transcript の版を上げたときに走らせ直す。
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { buildCleanInput, checkMarked, cleanTranscriptSchema, parseMarked } from "../src/server/core/clean-transcript";
import { SEED_MEMBERS, SEED_NARRATIONS } from "../src/server/demo/seed";
import { PROMPTS } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";

const env = processEnv();

function readKey(): string | undefined {
  if (env.ANTHROPIC_API_KEY) return env.ANTHROPIC_API_KEY;
  const file = env.EVAL_DEV_VARS ?? path.join(repoRoot, ".dev.vars");
  if (!fs.existsSync(file)) return undefined;
  for (const line of (fs.readFileSync(file, "utf8") as string).split(/\r?\n/)) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1]) return m[1].replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}
const apiKey = readKey();

describe.skipIf(!apiKey)("デモの種: 声の語りの整形", () => {
  it("本物の Haiku で一度整え、seed-cleaned.ts に書き出す", async () => {
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });
    const familyCalledAs = SEED_MEMBERS.map((m) => m.calledAs);
    const out: Record<string, { cleanedText: string; uncertainSpans: { start: number; end: number }[]; cleanedModel: string; cleanedPromptVersion: string }> = {};
    for (const n of SEED_NARRATIONS.filter((x) => x.kind === "voice")) {
      // デモの家族は全員標準語（地域は山形だが、方言の設定は入れない）
      const speaker = { calledAs: n.speaker, speechStyle: "standard" as const, dialectRegion: null };
      const r = await claude.call({
        prompt: PROMPTS.clean_transcript,
        content: [{ type: "text", text: buildCleanInput({ speaker, familyCalledAs, transcript: n.text }) }],
        schema: cleanTranscriptSchema,
        check: (v) => checkMarked(n.text, v.marked),
        traceId: `demo-seed-${n.label}`,
      });
      if (!r.ok) throw new Error(`clean failed: ${n.label} ${r.reason} ${r.violation ?? ""}`);
      const parsed = parseMarked(r.value.marked);
      if (!parsed.ok) throw new Error(`parse failed: ${n.label}`);
      out[n.label] = {
        cleanedText: parsed.cleanedText,
        uncertainSpans: parsed.spans,
        cleanedModel: r.meta.model,
        cleanedPromptVersion: PROMPTS.clean_transcript.version,
      };
    }
    const file = path.join(repoRoot, "src/server/demo/seed-cleaned.ts");
    const body = [
      "// 自動で作るファイル（evals/demo-seed-clean.eval.ts）。手で書き換えない。",
      "// デモの種の声の語りを、本物の Haiku（clean_transcript）で一度整えた結果。初期化はこれを写す（0038）",
      `// 作った日: ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}`,
      'import type { NarrationCleaned } from "../core/ports";',
      "",
      `export const SEED_CLEANED: Record<string, NarrationCleaned> = ${JSON.stringify(out, null, 2)};`,
      "",
    ].join("\n");
    fs.writeFileSync(file, body);
    console.log(`wrote ${path.relative(repoRoot, file)}`);
    expect(Object.keys(out).sort()).toEqual(["n1", "n12", "n7", "n8"]);
  });
});
