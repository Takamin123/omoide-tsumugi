// むすびの推測（musubi_guess）の出し比べ。本物の Claude を、架空の家族（evals/fixtures/family-a.json）とデモの家族（src/server/demo/seed.ts）で呼ぶ。
// npm test には入れない。手元で ANTHROPIC_API_KEY があるときだけ動く:
//   ANTHROPIC_API_KEY=... npm run eval:musubi
//   または .dev.vars の ANTHROPIC_API_KEY（worktree では EVAL_DEV_VARS=<メインの .dev.vars> npm run eval:musubi）
//   EVAL_REPEAT=2（既定）で同じ家族・同じモデルを 2 回ずつ。EVAL_MODELS=claude-sonnet-5-5,claude-haiku-5-5（既定）。EVAL_OUT=<path> で書き出し先を変える
// 結果は docs/evals/<日本時間の日付>-musubi.md に書く。
// - 記録（records）は、本番と同じく extract_records（Haiku）を本物で一度呼んで作る。記録の組は、どのモデル・どの回でも同じものを使う
// - アプリと同じ部品（buildMusubiInput、checkMusubi、resolveMusubi、dropOverlapping、musubiSchema、PROMPTS.musubi_guess）を使い、検査も同じにする
// - モデルは CLAUDE_PURPOSES.musubi_guess.model を差し替えて比べる（maxTokens などのほかの設定は本番のまま）
// - 写真の ID は fixture の ID・台本のラベル（P1 など）。Claude には短い呼び名（p1 など）しか渡らない
// - 期待（どの組を作ってよいか）は台本と fixture の note から。プロンプトには渡さない
import { describe, expect, it } from "vitest";
import { createAnthropicClaude } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES } from "../src/server/core/claude";
import { displayText } from "../src/server/core/clean-transcript";
import {
  buildMusubiInput,
  checkMusubi,
  dropOverlapping,
  musubiSchema,
  resolveMusubi,
  type MusubiInput,
  type MusubiOutput,
} from "../src/server/core/musubi-guess";
import type { ClaudeClient, NarrationRow, PhotoRow, RecordRow } from "../src/server/core/ports";
import { buildRecordInput, checkRecords, locateRecords, recordsSchema } from "../src/server/core/record-extraction";
import { SEED_CLEANED } from "../src/server/demo/seed-cleaned";
import { SEED_MEMBERS, SEED_NARRATIONS, SEED_PHOTOS } from "../src/server/demo/seed";
import { PROMPTS } from "../src/server/prompts";
import { fs, path, processEnv, repoRoot } from "../test/node";
import type { FamilyFixture } from "./fixtures/types";

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
const models = (env.EVAL_MODELS ?? "claude-sonnet-5-5,claude-haiku-5-5").split(",").map((s: string) => s.trim()).filter(Boolean);

function jstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

// ---- 家族の材料（本番の行の形にする） ----

interface EvalFamily {
  id: string;
  title: string;
  photos: PhotoRow[];
  narrations: NarrationRow[];
  calledAs: Map<string, string>;
  /** 期待。ひとまとめにしてよい写真の組（この中の写真どうしなら、作り話ではない） */
  allowedGroups: string[][];
  /** 理想のまとまり（拾えた率を測る） */
  ideal: string[][];
  /** とくに作ってはいけない組（罠） */
  traps: [string, string, string][];
  /** 語りの note（報告に出す。プロンプトには渡さない） */
  notes: Map<string, string>;
}

const narrationRow = (x: Partial<NarrationRow> & Pick<NarrationRow, "id" | "speakerMemberId" | "photoId" | "kind" | "transcript" | "createdAt">): NarrationRow => ({
  familyId: "f-eval",
  entranceId: null,
  replyToId: null,
  requestId: null,
  audioKey: null,
  audioContentType: null,
  durationMs: null,
  transcriptStatus: "done",
  cleanedText: null,
  cleanedModel: null,
  cleanedPromptVersion: null,
  uncertainSpans: null,
  forDate: "2026-11-03",
  ...x,
});
const photoRow = (id: string, owner: string, takenAt: string | null, createdAt: number): PhotoRow => ({
  id,
  familyId: "f-eval",
  ownerMemberId: owner,
  storageKey: `families/f-eval/photos/${id}`,
  contentHash: id,
  width: 1600,
  height: 900,
  takenAt,
  latitude: null,
  longitude: null,
  createdAt,
});

function familyA(): EvalFamily {
  const fx = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/fixtures/family-a.json"), "utf8")) as FamilyFixture;
  const narrations = fx.narrations.map((n, i) => {
    const spans = n.mishearings
      .map((m) => ({ start: n.transcript.indexOf(m.heard), end: n.transcript.indexOf(m.heard) + m.heard.length }))
      .filter((s) => s.start >= 0)
      .sort((a, b) => a.start - b.start);
    return narrationRow({
      id: n.id,
      speakerMemberId: n.speakerMemberId,
      photoId: n.photoId,
      replyToId: n.replyToId,
      kind: n.kind,
      transcript: n.transcript,
      cleanedText: n.kind === "voice" ? n.transcript : null,
      uncertainSpans: n.kind === "voice" ? spans : null,
      createdAt: 1_000_000 + i * 1000,
    });
  });
  return {
    id: "family-a",
    title: "evals/fixtures/family-a.json（広島の三世代。写真ごとに別の出来事）",
    photos: fx.photos.map((p, i) => photoRow(p.id, p.ownerMemberId, p.takenAt, 100 + i)),
    narrations,
    calledAs: new Map(fx.members.map((m) => [m.id, m.calledAs])),
    // どの写真も別の出来事。むすびは作られないのが正しい
    allowedGroups: [],
    ideal: [],
    traps: [["p04-new-year", "p06-wedding", "n03 は正月の語りから嫁入りの着物にそれる。式（p06）と同じ出来事ではない"]],
    notes: new Map(fx.narrations.map((n) => [n.id, n.note])),
  };
}

function demoFamily(): EvalFamily {
  const memberId = (c: string) => `m-${SEED_MEMBERS.findIndex((m) => m.calledAs === c)}`;
  const at = (daysAgo: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return Date.UTC(2026, 10, 3 - daysAgo, h! - 9, m!);
  };
  const narrations = SEED_NARRATIONS.map((n) => {
    const cleaned = n.kind === "voice" ? SEED_CLEANED[n.label] : undefined;
    return narrationRow({
      id: n.label,
      speakerMemberId: memberId(n.speaker),
      photoId: n.photo,
      replyToId: n.replyTo ?? null,
      kind: n.kind,
      transcript: n.text,
      cleanedText: cleaned?.cleanedText ?? null,
      uncertainSpans: cleaned?.uncertainSpans ?? null,
      cleanedModel: cleaned?.cleanedModel ?? null,
      cleanedPromptVersion: cleaned?.cleanedPromptVersion ?? null,
      createdAt: at(n.daysAgo, n.at),
    });
  });
  const ise = ["P4", "P5", "P6", "P8"];
  return {
    id: "demo",
    title: "デモの家族（src/server/demo/seed.ts。山形の三世代。伊勢の旅と、山形の田植えの頃）",
    photos: SEED_PHOTOS.map((p, i) => photoRow(p.label, memberId(p.owner), p.takenAt, 100 + i)),
    narrations,
    calledAs: new Map(SEED_MEMBERS.map((m) => [memberId(m.calledAs), m.calledAs])),
    // 伊勢の旅（語りのある写真）の中なら作り話ではない。Y1・Y2 はどれとも同じ出来事ではない
    allowedGroups: [ise],
    ideal: [ise],
    traps: [
      ["P4", "Y2", "n8 は最上川の岩を見て夫婦岩を思い出した語り。同じ出来事ではない（語りの連想）"],
      ["Y1", "Y2", "同じ日だが、語りに共通の言葉がない"],
    ],
    notes: new Map(),
  };
}

// ---- 記録の取り出し（本物の Haiku で一度） ----

type ExtractLog = { narrationId: string; ok: boolean; reason: string | null; attempts: number; inputTokens: number; outputTokens: number; ms: number };

async function extractRecords(claude: ClaudeClient, fam: EvalFamily): Promise<{ records: RecordRow[]; log: ExtractLog[] }> {
  const byId = new Map(fam.narrations.map((n) => [n.id, n]));
  const familyCalledAs = [...fam.calledAs.values()];
  const records: RecordRow[] = [];
  const log: ExtractLog[] = [];
  for (const n of fam.narrations) {
    const text = displayText(n);
    if (!text) continue;
    const parent = n.replyToId ? byId.get(n.replyToId) : undefined;
    const parentText = parent ? displayText(parent) : null;
    const started = Date.now();
    const r = await claude.call({
      prompt: PROMPTS.extract_records,
      content: [
        {
          type: "text",
          text: buildRecordInput({
            speakerCalledAs: fam.calledAs.get(n.speakerMemberId) ?? null,
            familyCalledAs,
            narrationText: text,
            context: parent && parentText ? { speakerCalledAs: fam.calledAs.get(parent.speakerMemberId) ?? null, text: parentText } : null,
          }),
        },
      ],
      schema: recordsSchema,
      check: (v) => checkRecords(v, n),
      traceId: `eval-records-${n.id}`,
    });
    log.push({ narrationId: n.id, ok: r.ok, reason: r.ok ? null : r.reason, attempts: r.meta.attempts, inputTokens: r.meta.inputTokens, outputTokens: r.meta.outputTokens, ms: Date.now() - started });
    if (!r.ok) continue;
    const located = locateRecords(r.value, n);
    if (!located.ok) continue;
    located.records.forEach((x, i) =>
      records.push({
        id: `${n.id}#${i + 1}`,
        familyId: "f-eval",
        photoId: n.photoId,
        kind: x.kind,
        value: x.value,
        origin: "told",
        toldByMemberId: n.speakerMemberId,
        narrationId: n.id,
        quoteStart: x.start,
        quoteEnd: x.end,
        model: null,
        promptVersion: null,
        createdAt: n.createdAt + 1 + i,
      }),
    );
  }
  return { records, log };
}

// ---- むすびの推測 ----

type Musubi = { photoIds: string[]; evidenceRecordIds: string[]; reason: string };
type Outcome = {
  family: string;
  model: string;
  run: number;
  ok: boolean;
  reason: string | null;
  violation: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  rawAttempts: { value: MusubiOutput; violation: string | null }[];
  musubi: Musubi[];
  dropped: number;
};

async function guessOnce(claude: ClaudeClient, input: MusubiInput, family: string, model: string, run: number): Promise<Outcome> {
  const rawAttempts: Outcome["rawAttempts"] = [];
  const started = Date.now();
  const r = await claude.call({
    prompt: PROMPTS.musubi_guess,
    content: [{ type: "text", text: input.text }],
    schema: musubiSchema,
    check: (v) => {
      const violation = checkMusubi(v, input);
      rawAttempts.push({ value: v, violation });
      return violation;
    },
    traceId: `eval-musubi-${family}-${run}`,
  });
  const ms = Date.now() - started;
  let musubi: Musubi[] = [];
  let dropped = 0;
  if (r.ok) {
    const resolved = resolveMusubi(r.value, input);
    if (resolved.ok) ({ kept: musubi, dropped } = dropOverlapping(resolved.musubi, []));
  }
  return {
    family,
    model: r.meta.model || model,
    run,
    ok: r.ok,
    reason: r.ok ? null : r.reason,
    violation: r.ok ? null : (r.violation ?? null),
    attempts: r.meta.attempts,
    inputTokens: r.meta.inputTokens,
    outputTokens: r.meta.outputTokens,
    ms,
    rawAttempts,
    musubi,
    dropped,
  };
}

// ---- 評価 ----

const pairKey = (a: string, b: string) => [a, b].sort().join("–");
function pairsOf(ids: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push(pairKey(ids[i]!, ids[j]!));
  return out;
}

function judge(fam: EvalFamily, o: Outcome) {
  const allowed = new Set(fam.allowedGroups.flatMap(pairsOf));
  const fabricated = o.musubi.filter((m) => pairsOf(m.photoIds).some((p) => !allowed.has(p)));
  const trapHits = fam.traps.filter(([a, b]) => o.musubi.some((m) => m.photoIds.includes(a) && m.photoIds.includes(b))).map(([a, b]) => pairKey(a, b));
  // 拾えた率: 理想のまとまりの組（ペア）のうち、同じむすびに入ったもの
  const idealPairs = fam.ideal.flatMap(pairsOf);
  const together = idealPairs.filter((p) => o.musubi.some((m) => pairsOf(m.photoIds).includes(p)));
  return { fabricated, trapHits, idealPairs: idealPairs.length, together: together.length };
}

const groupLine = (ms: Musubi[]) => (ms.length === 0 ? "（なし）" : ms.map((m) => `{${[...m.photoIds].sort().join(", ")}}`).join(" "));

function aliasBack(input: MusubiInput) {
  const photo = new Map([...input.photoAlias].map(([a, id]) => [a, id]));
  const rec = new Map([...input.recordAlias].map(([a, r]) => [a, r]));
  return {
    photos: (ids: string[]) => ids.map((a) => photo.get(a.trim()) ?? `?${a}`).join(", "),
    records: (ids: string[]) => ids.map((a) => { const r = rec.get(a.trim()); return r ? `${r.id}「${r.value}」` : `?${a}`; }).join(" "),
  };
}

function report(fams: { fam: EvalFamily; input: MusubiInput; records: RecordRow[]; extractLog: ExtractLog[] }[], outcomes: Outcome[]): string {
  const prompt = PROMPTS.musubi_guess;
  const L: string[] = [];
  L.push(`# 出し比べ: むすびの推測（${prompt.version}）`, "");
  L.push(`- 日付: ${jstDate()}`);
  L.push(`- モデル: ${models.join("、")}（本番は ${CLAUDE_PURPOSES.musubi_guess.model}。maxTokens などのほかの設定は本番のまま）`);
  L.push(`- データ: ${fams.map((f) => f.fam.id).join("、")} × モデル ${models.length} × ${repeat} 回`);
  L.push("- 記録: 本物の extract_records（Haiku）を一度だけ呼んで作り、すべてのモデル・回で同じ記録の組を使った");
  L.push("- 検査: アプリと同じ checkMusubi（全か無か。違反は 1 回だけ再試行）→ resolveMusubi → dropOverlapping（既存のむすびは空）", "");

  L.push("## まとめ（モデルごと）", "");
  L.push("| モデル | 家族 | 回 | 通った | 再試行 | 違反の種類 | むすびの数 | 作り話（期待にない組） | 罠の組 | 理想の組を拾えた | 所要（中央/最長 ms） | 入力トークン（平均） | 出力トークン（平均） |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const model of models) {
    for (const { fam } of fams) {
      const os = outcomes.filter((o) => o.family === fam.id && modelOf(o) === model);
      if (os.length === 0) continue;
      const js = os.map((o) => judge(fam, o));
      const viol = os.flatMap((o) => o.rawAttempts.map((a) => a.violation).filter((v): v is string => v !== null));
      const ms = os.map((o) => o.ms).sort((a, b) => a - b);
      const avg = (k: "inputTokens" | "outputTokens") => Math.round(os.reduce((s, o) => s + o[k], 0) / os.length);
      L.push(
        `| ${model} | ${fam.id} | ${os.length} | ${os.filter((o) => o.ok).length} | ${os.filter((o) => o.attempts > 1).length} | ${viol.length ? [...new Set(viol)].map((v) => `${v}×${viol.filter((x) => x === v).length}`).join("、") : "なし"} | ${os.map((o) => o.musubi.length).join(" / ")} | ${js.reduce((s, j) => s + j.fabricated.length, 0)} | ${js.flatMap((j) => j.trapHits).join("、") || "なし"} | ${js.map((j) => `${j.together}/${j.idealPairs}`).join(" / ")} | ${ms[Math.floor(ms.length / 2)]}/${ms[ms.length - 1]} | ${avg("inputTokens")} | ${avg("outputTokens")} |`,
      );
    }
  }
  L.push("", "「理想の組を拾えた」は、理想のまとまり（デモでは伊勢の旅の P4・P5・P6・P8）の写真の 2 枚の組 6 つのうち、同じむすびに入った数。family-a は理想のまとまりがない（0/0 が正しい）", "");

  L.push("## 回ごとのむすび", "", "| 家族 | モデル | 回 | 結果 | 試行 | むすび（写真の組） | 作り話 | 罠 |", "|---|---|---|---|---|---|---|---|");
  for (const o of outcomes) {
    const fam = fams.find((f) => f.fam.id === o.family)!.fam;
    const j = judge(fam, o);
    const result = o.ok ? "done" : `failed（${o.reason}${o.violation ? ` / ${o.violation}` : ""}）`;
    L.push(`| ${o.family} | ${modelOf(o)} | ${o.run} | ${result} | ${o.attempts} | ${groupLine(o.musubi)} | ${groupLine(j.fabricated)} | ${j.trapHits.join("、") || "-"} |`);
  }
  L.push("");

  for (const { fam, input, records, extractLog } of fams) {
    L.push(`## ${fam.id}: ${fam.title}`, "");
    L.push(`- 期待: ${fam.ideal.length ? `理想のまとまり ${fam.ideal.map((g) => `{${g.join(", ")}}`).join(" ")}。この中の組は作り話に数えない` : "むすびは作られないのが正しい"}`);
    for (const [a, b, why] of fam.traps) L.push(`- 罠 ${pairKey(a, b)}: ${why}`);
    const ex = extractLog;
    L.push(
      `- 記録の取り出し（Haiku）: ${ex.filter((e) => e.ok).length}/${ex.length} 語り、記録 ${records.length} 件、入力 ${ex.reduce((s, e) => s + e.inputTokens, 0)}・出力 ${ex.reduce((s, e) => s + e.outputTokens, 0)} トークン${ex.some((e) => !e.ok) ? `。失敗: ${ex.filter((e) => !e.ok).map((e) => `${e.narrationId}（${e.reason}）`).join("、")}` : ""}`,
    );
    L.push(`- むすびの推測に渡した記録: ${input.recordIds.length} 件、写真 ${input.photoAlias.size} 枚（${[...input.photoAlias].map(([a, id]) => `${a}=${id}`).join("、")}）`, "");
    L.push("渡した材料（Claude に渡した user の一通そのまま）:", "", "```xml", input.text, "```", "");
    for (const o of outcomes.filter((x) => x.family === fam.id)) {
      const back = aliasBack(input);
      L.push(`### ${fam.id} / ${modelOf(o)} / ${o.run} 回目（${o.ms} ms、入力 ${o.inputTokens}・出力 ${o.outputTokens}）`, "");
      o.rawAttempts.forEach((a, i) => {
        L.push(`- 応答 ${i + 1} 回目${a.violation ? `（検査に外れた: ${a.violation}）` : ""}:${a.value.musubi.length === 0 ? " 空" : ""}`);
        for (const m of a.value.musubi) {
          L.push(`  - 写真 [${m.photo_ids.join(", ")}] = ${back.photos(m.photo_ids)}`);
          L.push(`    - 根拠 [${m.evidence_record_ids.join(", ")}] = ${back.records(m.evidence_record_ids)}`);
          L.push(`    - 理由（運営だけが読む）: ${m.reason}`);
        }
      });
      if (o.rawAttempts.length === 0) L.push(`- 応答なし（${o.reason}）`);
      L.push(`- 入れるむすび: ${o.ok ? groupLine(o.musubi) : `なし（${o.reason}）`}`, "");
    }
  }
  L.push("## 応答の全文（作り話・罠を含むもの）", "");
  for (const o of outcomes) {
    const fam = fams.find((f) => f.fam.id === o.family)!.fam;
    const fabricatedRaw = o.rawAttempts.filter((a) => {
      const allowed = new Set(fam.allowedGroups.flatMap(pairsOf));
      const input = fams.find((f) => f.fam.id === o.family)!.input;
      return a.value.musubi.some((m) => pairsOf(m.photo_ids.map((x) => input.photoAlias.get(x.trim()) ?? x)).some((p) => !allowed.has(p)));
    });
    for (const a of fabricatedRaw) {
      L.push(`### ${o.family} / ${modelOf(o)} / ${o.run} 回目${a.violation ? `（検査に外れた: ${a.violation}）` : "（検査は通った）"}`, "", "```json", JSON.stringify(a.value, null, 2), "```", "");
    }
  }
  return L.join("\n");
}

const modelTag = new WeakMap<Outcome, string>();
const modelOf = (o: Outcome) => modelTag.get(o) ?? o.model;

describe.skipIf(!apiKey)("出し比べ: musubi_guess", () => {
  it("架空の家族とデモの家族で、Sonnet と Haiku のむすびの推測を比べる", async () => {
    const claude = createAnthropicClaude(apiKey!, { log: () => {} });
    const fams = [];
    for (const fam of [familyA(), demoFamily()]) {
      const { records, log } = await extractRecords(claude, fam);
      const input = buildMusubiInput({ records, narrations: fam.narrations, photos: fam.photos, calledAs: fam.calledAs, existing: [] });
      if (!input) throw new Error(`${fam.id}: 記録のある写真が 2 枚未満`);
      fams.push({ fam, input, records, extractLog: log });
    }

    const original = CLAUDE_PURPOSES.musubi_guess.model;
    const outcomes: Outcome[] = [];
    try {
      for (const model of models) {
        CLAUDE_PURPOSES.musubi_guess.model = model;
        for (let run = 1; run <= repeat; run++) {
          for (const { fam, input } of fams) {
            const o = await guessOnce(claude, input, fam.id, model, run);
            modelTag.set(o, model);
            outcomes.push(o);
            console.log(`${fam.id} ${model} #${run}: ${o.ok ? "done" : o.reason} ${groupLine(o.musubi)} (${o.ms} ms)`);
          }
        }
      }
    } finally {
      CLAUDE_PURPOSES.musubi_guess.model = original;
    }

    const out = env.EVAL_OUT ?? path.join(repoRoot, `docs/evals/${jstDate()}-musubi.md`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, report(fams, outcomes));
    console.log(`wrote ${path.relative(repoRoot, out)}`);
    expect(outcomes.length).toBe(fams.length * models.length * repeat);
  });
});
