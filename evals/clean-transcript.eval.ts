// 文字起こしの整形（clean_transcript）の出し比べ。本物の Haiku を、架空の家族（evals/fixtures/family-a.json）の声の語りで呼ぶ。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   ANTHROPIC_API_KEY=... npm run eval:clean
//   または .dev.vars の ANTHROPIC_API_KEY（worktree では EVAL_DEV_VARS=<メインの .dev.vars> npm run eval:clean）
//   EVAL_REPEAT=3 で同じ語りを 3 回ずつ（ぶれを見る）。EVAL_OUT=<path> で書き出し先を変える
// 結果は docs/evals/<日本時間の日付>-clean-transcript.md に書く。
// アプリと同じ部品（buildCleanInput、checkMarked、parseMarked、displayText、PROMPTS）を使い、検査も同じにする。
// fixtures の traits・mishearings・note は期待値なので、プロンプトには渡さない（ここでは結果と見比べるだけ）。
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES } from "../src/server/core/claude";
import {
  CLEAN_MAX_UNCERTAIN_RATIO,
  CLEAN_MIN_KEPT_RATIO,
  buildCleanInput,
  checkMarked,
  cleanTranscriptSchema,
  displayText,
  parseMarked,
} from "../src/server/core/clean-transcript";
import { PROMPTS } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";
import type { FamilyFixture, FixtureNarration } from "./fixtures/types";

const env = processEnv();

/**
 * キーは環境変数か、.dev.vars（リポジトリに入らないファイル）から読む。値は出さない。
 * worktree で走らせるときは EVAL_DEV_VARS にメインの作業ツリーの .dev.vars を指す
 */
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
const repeat = Math.max(1, Number(env.EVAL_REPEAT ?? "1") || 1);

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 削られてはいけない語の回帰（0022）。方言の意味のある語で、言いよどみと同じ音のもの。
 * 期待値なのでプロンプトには渡さない。残ったか、消えたか、印で隠れたかを数える
 */
const MUST_KEEP: Record<string, string[]> = {
  "n03-new-year-baaba": ["えっと"],
  "n05-wedding-baaba": ["えーと"],
};

const quote = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

type Outcome = {
  narration: FixtureNarration;
  run: number;
  model: string;
  ok: boolean;
  reason: string | null;
  violation: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  /** 各試行で Haiku が返した、印つきの本文（スキーマを通ったものだけ） */
  rawAttempts: { marked: string; violation: string | null }[];
  cleaned: string | null;
  display: string | null;
  spans: string[];
  /** 期待した聞き間違いごとの結果 */
  mishearings: { heard: string; intended: string; result: "印あり" | "印なし" | "消えた" | "整形なし" }[];
  /** 期待した聞き間違いに当たらない印 */
  unexpectedSpans: string[];
  /** 削られてはいけない語ごとの結果（MUST_KEEP） */
  mustKeep: { word: string; result: "残った" | "印で隠れた" | "消えた" | "整形なし" }[];
};

function judge(n: FixtureNarration, cleaned: string | null, spans: { start: number; end: number }[]) {
  const spanTexts = cleaned ? spans.map((s) => cleaned.slice(s.start, s.end)) : [];
  const mishearings = n.mishearings.map((m) => {
    if (!cleaned) return { heard: m.heard, intended: m.intended, result: "整形なし" as const };
    const at = cleaned.indexOf(m.heard);
    if (at < 0) return { heard: m.heard, intended: m.intended, result: "消えた" as const };
    const marked = spans.some((s) => s.start < at + m.heard.length && at < s.end);
    return { heard: m.heard, intended: m.intended, result: marked ? ("印あり" as const) : ("印なし" as const) };
  });
  const unexpectedSpans = spanTexts.filter((t) => !n.mishearings.some((m) => t.includes(m.heard) || m.heard.includes(t)));
  const mustKeep = (MUST_KEEP[n.id] ?? []).map((word) => {
    if (!cleaned) return { word, result: "整形なし" as const };
    const at = cleaned.indexOf(word);
    if (at < 0) return { word, result: "消えた" as const };
    const hidden = spans.some((s) => s.start < at + word.length && at < s.end);
    return { word, result: hidden ? ("印で隠れた" as const) : ("残った" as const) };
  });
  return { spanTexts, mishearings, unexpectedSpans, mustKeep };
}

function report(fixture: FamilyFixture, outcomes: Outcome[]): string {
  const prompt = PROMPTS.clean_transcript;
  const lines: string[] = [];
  lines.push(`# 出し比べ: 文字起こしの整形（${prompt.version}）`, "");
  lines.push(`- 日付: ${jstDate()}`);
  lines.push(`- モデル: ${CLAUDE_PURPOSES.clean_transcript.model}（応答に書かれたもの: ${[...new Set(outcomes.map((o) => o.model))].join("、")}）`);
  lines.push(`- データ: evals/fixtures/${fixture.id}.json の声の語り ${new Set(outcomes.map((o) => o.narration.id)).size} 件 × ${repeat} 回`);
  lines.push(`- 検査: 部分列、残り ${CLEAN_MIN_KEPT_RATIO * 100}% 以上、印 ${CLEAN_MAX_UNCERTAIN_RATIO * 100}% 以下（0018）。外れたら 1 回だけ再試行`);
  lines.push(`- 変更前: 文字起こしそのまま（v0 は仮のひな形で、家族の流れでは使っていない）`, "");

  const done = outcomes.filter((o) => o.ok).length;
  const expected = outcomes.flatMap((o) => o.mishearings);
  const caught = expected.filter((m) => m.result === "印あり").length;
  const lost = expected.filter((m) => m.result === "消えた").length;
  const unexpected = outcomes.reduce((s, o) => s + o.unexpectedSpans.length, 0);
  const tokensIn = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const tokensOut = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  lines.push("## まとめ", "");
  lines.push(`- 整形できた: ${done} / ${outcomes.length}`);
  lines.push(`- 期待した聞き間違い: 印あり ${caught} / ${expected.length}、消えた ${lost}`);
  lines.push(`- 期待にない印: ${unexpected}`);
  const keep = outcomes.flatMap((o) => o.mustKeep);
  lines.push(
    `- 削られてはいけない方言の語（0022）: 残った ${keep.filter((k) => k.result === "残った").length} / ${keep.length}、印で隠れた ${keep.filter((k) => k.result === "印で隠れた").length}、消えた ${keep.filter((k) => k.result === "消えた").length}`,
  );
  lines.push(`- トークン: 入力 ${tokensIn}、出力 ${tokensOut}`, "");
  lines.push("| 語り | 回 | 結果 | 試行 | 印 | 期待した聞き間違い | 期待にない印 | 削られてはいけない語 |", "|---|---|---|---|---|---|---|---|");
  for (const o of outcomes) {
    const result = o.ok ? "done" : `failed（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`;
    const mh = o.mishearings.map((m) => `${m.heard}: ${m.result}`).join("、") || "-";
    lines.push(`| ${o.narration.id} | ${o.run} | ${result} | ${o.attempts} | ${o.spans.length} | ${mh} | ${o.unexpectedSpans.join("、") || "-"} | ${o.mustKeep.map((k) => `${k.word}: ${k.result}`).join("、") || "-"} |`);
  }
  lines.push("");

  lines.push("## 語りごと", "");
  for (const o of outcomes) {
    const speaker = fixture.members.find((m) => m.id === o.narration.speakerMemberId);
    lines.push(`### ${o.narration.id}（${o.run} 回目。${speaker?.calledAs ?? "?"}・${speaker?.speechStyle === "dialect" ? speaker.dialectRegion : "標準語"}）`, "");
    lines.push(`見るためのもの: ${o.narration.note}`, "");
    lines.push("文字起こし（変更前）:", "", quote(o.narration.transcript), "");
    o.rawAttempts.forEach((a, i) => {
      lines.push(`Haiku の応答（${i + 1} 回目${a.violation ? `、検査に外れた: ${a.violation}` : ""}）:`, "", quote(a.marked), "");
    });
    if (o.display !== null) lines.push("表示（変更後。印は「……」）:", "", quote(o.display), "");
    else lines.push(`表示: 整形なし（${o.reason}）。文字起こしをそのまま出す`, "");
  }
  return lines.join("\n");
}

describe.skipIf(!apiKey)("出し比べ: clean_transcript", () => {
  it("架空の家族の声の語りを、本物の Haiku で整える", async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/fixtures/family-a.json"), "utf8")) as FamilyFixture;
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });
    const voice = fixture.narrations.filter((n) => n.kind === "voice");
    const familyCalledAs = fixture.members.map((m) => m.calledAs);
    const outcomes: Outcome[] = [];

    for (let run = 1; run <= repeat; run++) {
      for (const n of voice) {
        const speaker = fixture.members.find((m) => m.id === n.speakerMemberId) ?? null;
        const rawAttempts: Outcome["rawAttempts"] = [];
        const r = await claude.call({
          prompt: PROMPTS.clean_transcript,
          content: [{ type: "text", text: buildCleanInput({ speaker, familyCalledAs, transcript: n.transcript }) }],
          schema: cleanTranscriptSchema,
          check: (v) => {
            const violation = checkMarked(n.transcript, v.marked);
            rawAttempts.push({ marked: v.marked, violation });
            return violation;
          },
          traceId: `eval-${n.id}`,
        });
        const parsed = r.ok ? parseMarked(r.value.marked) : null;
        const cleaned = parsed?.ok ? parsed.cleanedText : null;
        const spans = parsed?.ok ? parsed.spans : [];
        const j = judge(n, cleaned, spans);
        outcomes.push({
          narration: n,
          run,
          model: r.meta.model,
          ok: r.ok,
          reason: r.ok ? null : r.reason,
          violation: r.ok ? null : (r.violation ?? null),
          attempts: r.meta.attempts,
          inputTokens: r.meta.inputTokens,
          outputTokens: r.meta.outputTokens,
          rawAttempts,
          cleaned,
          display: cleaned !== null ? displayText({ cleanedText: cleaned, uncertainSpans: spans, transcript: n.transcript }) : null,
          spans: j.spanTexts,
          mishearings: j.mishearings,
          unexpectedSpans: j.unexpectedSpans,
          mustKeep: j.mustKeep,
        });
      }
    }

    const out = env.EVAL_OUT ?? path.join(repoRoot, `docs/evals/${jstDate()}-clean-transcript.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report(fixture, outcomes));
    console.log(`wrote ${path.relative(repoRoot, out)}`);
    expect(outcomes.length).toBe(voice.length * repeat);
  });
});
