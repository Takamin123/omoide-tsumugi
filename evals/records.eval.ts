// 記録の取り出し（extract_records）の出し比べ。本物の Haiku を、架空の家族（evals/fixtures/family-a.json）の語りで呼ぶ。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   ANTHROPIC_API_KEY=... npm run eval:records
//   または .dev.vars の ANTHROPIC_API_KEY（worktree では EVAL_DEV_VARS=<メインの .dev.vars> npm run eval:records）
//   EVAL_REPEAT=2（既定）で同じ語りを 2 回ずつ（ぶれを見る）。EVAL_OUT=<path> で書き出し先を変える
// 結果は docs/_wip/prompt-evals/<日本時間の日付>-records.md に書く。
// アプリと同じ部品（buildRecordInput、checkRecords、locateRecords、displayText、PROMPTS）を使い、検査も同じにする。
// 声の語りは整形済み（文字起こしそのまま）とみなし、fixtures の聞き間違い（mishearings）に印を付ける（「……」で渡る。entrance.eval と同じ）。
// fixtures の traits・mishearings・note は期待値なので、プロンプトには渡さない（印の位置にだけ使う）。
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES } from "../src/server/core/claude";
import { displayText } from "../src/server/core/clean-transcript";
import type { NarrationRow } from "../src/server/core/ports";
import {
  buildRecordInput,
  checkRecords,
  locateRecords,
  recordsSchema,
  type RecordsOutput,
} from "../src/server/core/record-extraction";
import { PROMPTS } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";
import type { FamilyFixture, FixtureNarration } from "./fixtures/types";

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
const repeat = Math.max(1, Number(env.EVAL_REPEAT ?? "2") || 2);

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 指す先が語りだけでは決まらない語を含む値（検査で止めるのは値がこの語だけのとき。ここでは含むものも数える） */
const VAGUE = ["あの人", "あそこ", "あんた", "わし", "あれ"];

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
  ms: number;
  rawAttempts: { records: RecordsOutput["records"]; violation: string | null }[];
  records: { kind: string; value: string }[];
};

const recLine = (rs: { kind: string; value?: string; text?: string }[]) =>
  rs.length === 0 ? "（空）" : rs.map((r) => `${r.kind}:「${r.value ?? r.text}」`).join(" ");

function report(fixture: FamilyFixture, outcomes: Outcome[]): string {
  const prompt = PROMPTS.extract_records;
  const lines: string[] = [];
  lines.push(`# 出し比べ: 記録の取り出し（${prompt.version}）`, "");
  lines.push(`- 日付: ${jstDate()}`);
  lines.push(`- モデル: ${CLAUDE_PURPOSES.extract_records.model}（応答に書かれたもの: ${[...new Set(outcomes.map((o) => o.model))].join("、")}）`);
  lines.push(`- データ: evals/fixtures/${fixture.id}.json の語り ${new Set(outcomes.map((o) => o.narration.id)).size} 件 × ${repeat} 回`);
  lines.push("- 本番との違い: 声の語りは文字起こしを整形済みとみなし、fixtures の聞き間違いに印を付けた（「……」で渡る）");
  lines.push("- 検査: 本文の連続した部分、30 字以内、12 件以内、代名詞だけの値なし、印と重ならない、同じ範囲なし。外れたら 1 回だけ再試行", "");

  const done = outcomes.filter((o) => o.ok).length;
  const retried = outcomes.filter((o) => o.attempts > 1).length;
  const violations = outcomes.flatMap((o) => o.rawAttempts.map((a) => a.violation).filter((v): v is string => v !== null));
  const vagueHits = outcomes.flatMap((o) => o.records.filter((r) => (r.kind === "person" || r.kind === "place") && VAGUE.some((w) => r.value.includes(w))).map((r) => `${o.narration.id}#${o.run} ${r.kind}:「${r.value}」`));
  const ms = outcomes.map((o) => o.ms).sort((a, b) => a - b);
  const tokensIn = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const tokensOut = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  lines.push("## まとめ", "");
  lines.push(`- 取り出せた: ${done} / ${outcomes.length}`);
  lines.push(`- 再試行した: ${retried}（違反の種類: ${violations.length ? [...new Set(violations)].map((v) => `${v} ×${violations.filter((x) => x === v).length}`).join("、") : "なし"}）`);
  lines.push(`- 通った記録のうち、person / place に「あの人」「あそこ」などを含むもの: ${vagueHits.length ? vagueHits.join("、") : "なし"}`);
  lines.push(`- 一語りの所要時間: 中央 ${ms[Math.floor(ms.length / 2)] ?? 0} ms、最長 ${ms[ms.length - 1] ?? 0} ms`);
  lines.push(`- トークン: 入力 ${tokensIn}（一語り平均 ${Math.round(tokensIn / Math.max(1, outcomes.length))}）、出力 ${tokensOut}（平均 ${Math.round(tokensOut / Math.max(1, outcomes.length))}）`, "");

  // 回ごとのぶれ（同じ語りで、記録の組が同じか）
  lines.push("## 回ごとのぶれ", "", "| 語り | 同じ組か | 違い |", "|---|---|---|");
  for (const id of new Set(outcomes.map((o) => o.narration.id))) {
    const runs = outcomes.filter((o) => o.narration.id === id);
    const sets = runs.map((o) => new Set(o.records.map((r) => `${r.kind}:${r.value}`)));
    const all = new Set(sets.flatMap((s) => [...s]));
    const diff = [...all].filter((x) => !sets.every((s) => s.has(x)));
    lines.push(`| ${id} | ${diff.length === 0 ? "同じ" : "違う"} | ${diff.join("、") || "-"} |`);
  }
  lines.push("");

  lines.push("| 語り | 回 | 結果 | 試行 | ms | 入力 | 出力 | 記録 |", "|---|---|---|---|---|---|---|---|");
  for (const o of outcomes) {
    const result = o.ok ? "done" : `failed（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`;
    lines.push(`| ${o.narration.id} | ${o.run} | ${result} | ${o.attempts} | ${o.ms} | ${o.inputTokens} | ${o.outputTokens} | ${recLine(o.records)} |`);
  }
  lines.push("");

  lines.push("## 語りごと", "");
  for (const o of outcomes) {
    const speaker = fixture.members.find((m) => m.id === o.narration.speakerMemberId);
    lines.push(`### ${o.narration.id}（${o.run} 回目。${speaker?.calledAs ?? "?"}・${o.narration.kind === "voice" ? "声" : "文字"}${o.narration.replyToId ? `・${o.narration.replyToId} への返事` : ""}）`, "");
    lines.push(`見るためのもの: ${o.narration.note}`, "");
    lines.push("渡した本文:", "", ...displayOf(o.narration).split("\n").map((l) => `> ${l}`), "");
    o.rawAttempts.forEach((a, i) => lines.push(`- Haiku の応答（${i + 1} 回目${a.violation ? `、検査に外れた: ${a.violation}` : ""}）: ${recLine(a.records)}`));
    lines.push(`- 入れる記録: ${o.ok ? recLine(o.records) : `なし（${o.reason}）`}`, "");
  }
  return lines.join("\n");
}

function spansOf(n: FixtureNarration) {
  return n.mishearings
    .map((m) => ({ start: n.transcript.indexOf(m.heard), end: n.transcript.indexOf(m.heard) + m.heard.length }))
    .filter((sp) => sp.start >= 0)
    .sort((a, b) => a.start - b.start);
}

function asRow(n: FixtureNarration): Pick<NarrationRow, "kind" | "transcript" | "cleanedText" | "uncertainSpans"> {
  return {
    kind: n.kind,
    transcript: n.transcript,
    cleanedText: n.kind === "voice" ? n.transcript : null,
    uncertainSpans: n.kind === "voice" ? spansOf(n) : null,
  };
}
const displayOf = (n: FixtureNarration) => displayText(asRow(n)) ?? "";

describe.skipIf(!apiKey)("出し比べ: extract_records", () => {
  it("架空の家族の語りから、本物の Haiku で記録を取り出す", async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/fixtures/family-a.json"), "utf8")) as FamilyFixture;
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });
    const called = new Map(fixture.members.map((m) => [m.id, m.calledAs]));
    const familyCalledAs = fixture.members.map((m) => m.calledAs);
    const byId = new Map(fixture.narrations.map((n) => [n.id, n]));
    const outcomes: Outcome[] = [];

    for (let run = 1; run <= repeat; run++) {
      for (const n of fixture.narrations) {
        const row = asRow(n);
        const parent = n.replyToId ? byId.get(n.replyToId) : undefined;
        const rawAttempts: Outcome["rawAttempts"] = [];
        const started = Date.now();
        const r = await claude.call({
          prompt: PROMPTS.extract_records,
          content: [
            {
              type: "text",
              text: buildRecordInput({
                speakerCalledAs: called.get(n.speakerMemberId) ?? null,
                familyCalledAs,
                narrationText: displayOf(n),
                context: parent ? { speakerCalledAs: called.get(parent.speakerMemberId) ?? null, text: displayOf(parent) } : null,
              }),
            },
          ],
          schema: recordsSchema,
          check: (v) => {
            const violation = checkRecords(v, row);
            rawAttempts.push({ records: v.records, violation });
            return violation;
          },
          traceId: `eval-${n.id}`,
        });
        const located = r.ok ? locateRecords(r.value, row) : null;
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
          ms: Date.now() - started,
          rawAttempts,
          records: located?.ok ? located.records.map((x) => ({ kind: x.kind, value: x.value })) : [],
        });
      }
    }

    const out = env.EVAL_OUT ?? path.join(repoRoot, `docs/_wip/prompt-evals/${jstDate()}-records.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report(fixture, outcomes));
    console.log(`wrote ${path.relative(repoRoot, out)}`);
    expect(outcomes.length).toBe(fixture.narrations.length * repeat);
  });
});
