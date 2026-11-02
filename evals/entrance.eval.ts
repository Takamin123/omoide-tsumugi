// 入り口づくり（entrance）の出し比べ。本物の Sonnet を、架空の家族（evals/fixtures/family-a.json）で呼ぶ。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   ANTHROPIC_API_KEY=... npm run eval:entrance
//   または .dev.vars の ANTHROPIC_API_KEY（worktree では EVAL_DEV_VARS=<メインの .dev.vars> npm run eval:entrance）
//   EVAL_REPEAT=2 で一人あたり 2 回ずつ。EVAL_OUT=<path> で書き出し先を変える
// 結果は docs/_wip/prompt-evals/<日本時間の日付>-entrance.md に書く。
// アプリと同じ部品（pickEntranceCandidates、buildEntranceInput、checkEntrance、locateQuote、PROMPTS）を使う。
// 本番との違い: fixtures には画像がないので、写真の説明（guess）だけを渡す。focus は null だけを許す（checkEntrance の focus_without_image）。
// fixtures の traits・mishearings・note は期待値なので、プロンプトには渡さない。
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES } from "../src/server/core/claude";
import { charCount } from "../src/server/core/claude-checks";
import { locateQuote, quoteText } from "../src/server/core/clean-transcript";
import {
  buildEntranceInput,
  checkEntrance,
  entranceSchema,
  pickEntranceCandidates,
  type EntranceOutput,
  type NarrationForEntrance,
} from "../src/server/core/entrance-claude";
import type { PhotoRow } from "../src/server/core/ports";
import { PROMPTS } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";
import type { FamilyFixture } from "./fixtures/types";

const env = processEnv();

/** キーは環境変数か、.dev.vars（リポジトリに入らないファイル）から読む。値は出さない */
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

const quoteBlock = (s: string) => s.split("\n").map((l) => `> ${l}`).join("\n");

type Outcome = {
  memberId: string;
  run: number;
  candidates: string[];
  model: string;
  ok: boolean;
  reason: string | null;
  violation: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  rawAttempts: { value: EntranceOutput; violation: string | null }[];
  value: EntranceOutput | null;
  /** アプリが位置を決めて引いた引用（画面に出るもの） */
  shownQuote: string | null;
};

describe.skipIf(!apiKey)("出し比べ: entrance", () => {
  it("架空の家族の 5 人それぞれに、本物の Sonnet で入り口を作る", async () => {
    const fixture = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/fixtures/family-a.json"), "utf8")) as FamilyFixture;
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });

    // fixtures を、アプリの行の形にする（画像・位置はない。createdAt は語った日の順）
    const photos: PhotoRow[] = fixture.photos.map((p, i) => ({
      id: p.id,
      familyId: fixture.id,
      ownerMemberId: p.ownerMemberId,
      storageKey: "",
      contentHash: "",
      width: 1,
      height: 1,
      takenAt: p.takenAt,
      latitude: null,
      longitude: null,
      createdAt: i,
    }));
    // 声の語りは、整形済み（文字起こしそのまま）とみなし、fixtures の聞き間違い（期待値）に印を付ける。
    // 印の範囲は「……」として渡るので、Claude が避けるか、検査（quote_uncertain_overlap）が止めるかを見る
    const spansOf = (n: FamilyFixture["narrations"][number]) =>
      n.mishearings
        .map((m) => ({ start: n.transcript.indexOf(m.heard), end: n.transcript.indexOf(m.heard) + m.heard.length }))
        .filter((sp) => sp.start >= 0)
        .sort((a, b) => a.start - b.start);
    const narrations: NarrationForEntrance[] = fixture.narrations.map((n, i) => ({
      id: n.id,
      speakerMemberId: n.speakerMemberId,
      photoId: n.photoId,
      replyToId: n.replyToId,
      kind: n.kind,
      transcript: n.transcript,
      cleanedText: n.kind === "voice" ? n.transcript : null,
      uncertainSpans: n.kind === "voice" ? spansOf(n) : null,
      forDate: n.forDate,
      createdAt: Date.parse(`${n.forDate}T12:00:00+09:00`) + i,
    }));
    const outcomes: Outcome[] = [];

    for (let run = 1; run <= repeat; run++) {
      for (const member of fixture.members) {
        const picked = pickEntranceCandidates(photos, narrations, [], member.id, fixture.asOfDate);
        const input = buildEntranceInput({
          receiverId: member.id,
          members: fixture.members,
          candidates: picked.map((c) => ({
            photo: c.photo,
            image: null,
            guess: fixture.photos.find((p) => p.id === c.photo.id)?.description ?? null,
            shownCount: c.shownCount,
            lastShownDate: c.lastShownDate,
          })),
          narrations,
        });
        const rawAttempts: Outcome["rawAttempts"] = [];
        const r = await claude.call({
          prompt: PROMPTS.entrance,
          content: input.content,
          schema: entranceSchema,
          check: (v) => {
            const violation = checkEntrance(v, input.context);
            rawAttempts.push({ value: v, violation });
            return violation;
          },
          traceId: `eval-${member.id}`,
        });
        let shownQuote: string | null = null;
        if (r.ok && r.value.quote) {
          const n = input.context.narrations.get(r.value.quote.narration_id)!.narration;
          const at = locateQuote(n, r.value.quote.text);
          if (at.ok) shownQuote = quoteText(n, at.start, at.end);
        }
        outcomes.push({
          memberId: member.id,
          run,
          candidates: picked.map((c) => c.photo.id),
          model: r.meta.model,
          ok: r.ok,
          reason: r.ok ? null : r.reason,
          violation: r.ok ? null : (r.violation ?? null),
          attempts: r.meta.attempts,
          inputTokens: r.meta.inputTokens,
          outputTokens: r.meta.outputTokens,
          rawAttempts,
          value: r.ok ? r.value : null,
          shownQuote,
        });
      }
    }

    const out = env.EVAL_OUT ?? path.join(repoRoot, `docs/_wip/prompt-evals/${jstDate()}-entrance.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report(fixture, outcomes));
    console.log(`wrote ${path.relative(repoRoot, out)}`);
    expect(outcomes.length).toBe(fixture.members.length * repeat);
  });
});

/** a と b に共通する、いちばん長い連続した文字列の長さ */
function longestCommon(a: string, b: string): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function report(fixture: FamilyFixture, outcomes: Outcome[]): string {
  const prompt = PROMPTS.entrance;
  const called = new Map(fixture.members.map((m) => [m.id, m.calledAs]));
  const speakerOf = new Map(fixture.narrations.map((n) => [n.id, n.speakerMemberId]));
  const lines: string[] = [];
  lines.push(`# 出し比べ: 入り口づくり（${prompt.version}）`, "");
  lines.push(`- 日付: ${jstDate()}`);
  lines.push(`- モデル: ${CLAUDE_PURPOSES.entrance.model}（応答に書かれたもの: ${[...new Set(outcomes.map((o) => o.model))].join("、")}）`);
  lines.push(`- データ: evals/fixtures/${fixture.id}.json の 5 人 × ${repeat} 回。提示の履歴なし（全員、初めての入り口）。今日 = ${fixture.asOfDate}`);
  lines.push("- 本番との違い: 画像がないので、写真の説明（guess）だけを渡した。focus は null だけを許す。声の語りは文字起こしを整形済みとみなし、fixtures の聞き間違い（mishearings）に印を付けた（「……」で渡る）");
  lines.push("- 変更前: entrance/v1（docs/_wip/prompt-evals/2026-11-03-entrance-v1.md。v1 は印なしで渡した）。v0 は仮のひな形");
  lines.push("- 「引用の再利用」: 問いかけと画面に出る引用に共通する、いちばん長い連続した文字列の字数（引用の繰り返しを見る）", "");

  const tokensIn = outcomes.reduce((s, o) => s + o.inputTokens, 0);
  const tokensOut = outcomes.reduce((s, o) => s + o.outputTokens, 0);
  lines.push("## まとめ", "");
  lines.push(`- 作れた: ${outcomes.filter((o) => o.ok).length} / ${outcomes.length}（固定の入り口に倒れたもの: ${outcomes.filter((o) => !o.ok).length}）`);
  lines.push(`- 検査で再試行になったもの: ${outcomes.filter((o) => o.rawAttempts.some((a) => a.violation)).length}`);
  lines.push(`- トークン: 入力 ${tokensIn}、出力 ${tokensOut}`, "");
  lines.push("| 受け取る人 | 回 | 結果 | 試行 | 写真 | 引用（語り手） | 問いかけ | 字数 | 引用の再利用 |", "|---|---|---|---|---|---|---|---|---|");
  for (const o of outcomes) {
    const v = o.value;
    const result = o.ok ? "ok" : `fixed（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`;
    const q = v?.quote ? `${called.get(speakerOf.get(v.quote.narration_id) ?? "") ?? "?"}: ${v.quote.narration_id}` : "-";
    lines.push(`| ${called.get(o.memberId)} | ${o.run} | ${result} | ${o.attempts} | ${v?.photo_id ?? "-"} | ${q} | ${v?.question ?? "-"} | ${v ? charCount(v.question) : "-"} | ${v && o.shownQuote ? longestCommon(v.question, o.shownQuote) : "-"} |`);
  }
  lines.push("");

  lines.push("## 一人ずつ", "");
  for (const o of outcomes) {
    const m = fixture.members.find((x) => x.id === o.memberId)!;
    lines.push(`### ${m.calledAs}（${m.relation}、${m.role}。${o.run} 回目）`, "");
    lines.push(`候補（並べた順）: ${o.candidates.join("、")}`, "");
    o.rawAttempts.forEach((a, i) => {
      if (a.violation || i < o.rawAttempts.length - 1 || !o.ok) {
        lines.push(`${i + 1} 回目の応答${a.violation ? `（検査に外れた: ${a.violation}）` : ""}:`, "", "```json", JSON.stringify(a.value, null, 2), "```", "");
      }
    });
    const v = o.value;
    if (!v) {
      lines.push(`結果: 固定の入り口（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`, "");
      continue;
    }
    lines.push(`- 写真: ${v.photo_id}（説明: ${fixture.photos.find((p) => p.id === v.photo_id)?.description ?? "?"}）`);
    lines.push(`- focus: ${v.focus ? JSON.stringify(v.focus) : "null"}`);
    lines.push(`- 引用: ${v.quote ? `${v.quote.narration_id}（${called.get(speakerOf.get(v.quote.narration_id) ?? "") ?? "?"}）` : "なし"}`);
    if (o.shownQuote) lines.push("", quoteBlock(o.shownQuote), "");
    lines.push(`- 問いかけ: ${v.question}`);
    lines.push(`- reason: ${v.reason}`, "");
  }
  return lines.join("\n");
}
