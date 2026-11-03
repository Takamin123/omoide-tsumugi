// 記録の取り出し（extract_records、Haiku。0039）: 家族が語った言葉から、人・場所・時期・出来事を指す部分を、本文のまま抜き出す。
// - 抜き出したものは家族が語ったこと（records.origin = 'told'、出所は語り手と語り）。Claude には位置を返させず、本文の文字列を返させ、
//   位置はアプリが locateQuote で決める。値は言い換え・正規化しない（正規化が要るなら guessed の行として別に足す）
// - 毎朝の処理（Cron とデモの時計のボタンの両方が通る runMorning）から、家族ごとに一回呼ぶ。背景処理には入れない
// - 材料はその家族の未処理の語り。声は使える整形のあるものだけ（未整形は翌朝）。文字は transcript。返事も対象
// - 渡すのは、語り手の呼ばれ方、家族の呼ばれ方の一覧、表示の文字（印は「……」）、返事なら相手の語り（文脈だけ）。
//   画像、写真の説明（photo_guesses）、撮影日、位置は渡さない
// - 一語りに一回の呼び出し。順番に回し、時間の予算を超えた語りは翌朝に回す。投げない
// - ログは ID・件数・所要時間・種類だけ（本文と値は出さない）
import { z } from "zod";
import { exceedsChars } from "./claude-checks";
import { displayText, locateQuote, quoteSource } from "./clean-transcript";
import type { AppDeps, MemberRow, NarrationRow, NewToldRecord, RecordExtractionAttempt, RecordKind } from "./ports";
import { PROMPTS } from "../prompts";

/** 一回の処理の時間の予算。超えたら新しい語りは呼ばず、翌朝に回す（毎朝の処理の本体は入り口づくり） */
export const RECORD_EXTRACTION_BUDGET_MS = 60_000;
/** デモの初期化のときの予算（語り 12 本を順に取り出す。0038）。毎朝の処理の前段の締め切りの内側 */
export const RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS = 120_000;
/** 一回の処理で見る語りの上限（残りは翌朝） */
export const RECORD_EXTRACTION_MAX_PER_RUN = 50;
/** 同じ語りを試す回数の上限（失敗が続いたら、それ以上呼ばない。家族には知らせない） */
export const RECORD_EXTRACTION_MAX_ATTEMPTS = 3;
/** 一つの記録の値の文字数の上限 */
export const RECORD_VALUE_MAX_CHARS = 30;
/** 一つの語りから取り出す記録の数の上限 */
export const RECORD_MAX_PER_NARRATION = 12;
/**
 * 値として止める、代名詞・指示語（値がこれだけのとき）。誰・どこを指すかが語りだけでは決まらないので、
 * person / place の手がかりにならない。名前や場所に置き換えさせない（プロンプトにも書く）
 */
export const RECORD_PRONOUN_VALUES: readonly string[] = [
  "あんた",
  "あなた",
  "わし",
  "わたし",
  "私",
  "あの人",
  "あそこ",
  "ここ",
  "そこ",
  "これ",
  "あれ",
];

export const RECORD_KINDS = ["person", "place", "time", "event"] as const satisfies readonly RecordKind[];

export const recordsSchema = z.object({
  records: z.array(z.object({ kind: z.enum(RECORD_KINDS), text: z.string() })),
});
export type RecordsOutput = z.infer<typeof recordsSchema>;

type Located = { kind: RecordKind; value: string; start: number; end: number };

/**
 * 受け取った記録の検査（全か無か）。違反の種類だけを返す（本文は返さない）。問題なければ位置を付けたもの
 */
export function locateRecords(
  v: RecordsOutput,
  n: Pick<NarrationRow, "kind" | "transcript" | "cleanedText" | "uncertainSpans">,
): { ok: true; records: Located[] } | { ok: false; violation: string } {
  if (v.records.length > RECORD_MAX_PER_NARRATION) return { ok: false, violation: "too_many" };
  const out: Located[] = [];
  const seen = new Set<string>();
  for (const r of v.records) {
    if (!RECORD_KINDS.includes(r.kind)) return { ok: false, violation: "kind" };
    if (r.text.trim().length === 0) return { ok: false, violation: "empty" };
    if (exceedsChars(r.text, RECORD_VALUE_MAX_CHARS)) return { ok: false, violation: "too_long" };
    if (RECORD_PRONOUN_VALUES.includes(r.text.trim())) return { ok: false, violation: "pronoun" };
    const at = locateQuote(n, r.text);
    if (!at.ok) return { ok: false, violation: at.violation };
    const key = `${at.start}:${at.end}`;
    if (seen.has(key)) return { ok: false, violation: "duplicate" };
    seen.add(key);
    out.push({ kind: r.kind, value: r.text, start: at.start, end: at.end });
  }
  return { ok: true, records: out };
}

export function checkRecords(v: RecordsOutput, n: Pick<NarrationRow, "kind" | "transcript" | "cleanedText" | "uncertainSpans">): string | null {
  const r = locateRecords(v, n);
  return r.ok ? null : r.violation;
}

/**
 * user の一通を組む。渡さないもの: 画像、写真の説明、撮影日、位置、語りの日付、ID
 * context は返事の相手の語り（文脈だけ。ここからは抜かない）
 */
export function buildRecordInput(input: {
  speakerCalledAs: string | null;
  familyCalledAs: string[];
  narrationText: string;
  context: { speakerCalledAs: string | null; text: string } | null;
}): string {
  const lines = ["<speaker>", `呼ばれ方: ${input.speakerCalledAs ?? "分からない"}`, "</speaker>", "<family_names>", input.familyCalledAs.join("、"), "</family_names>"];
  if (input.context) {
    lines.push(`<context speaker="${input.context.speakerCalledAs ?? "分からない"}" quotable="no">`, input.context.text, "</context>");
  }
  lines.push("<narration>", input.narrationText, "</narration>");
  return lines.join("\n");
}

export interface RecordExtractionSummary {
  runId: string;
  familyId: string;
  /** 見た未処理の語り */
  pending: number;
  /** 取り出しを終えた語り（0 件を含む） */
  done: number;
  /** 入れた記録の数 */
  records: number;
  failed: number;
  /** 使える文字がなく飛ばした語り（翌朝にまた見る） */
  skipped: number;
  /** 時間の予算を超えて呼ばなかった語り（翌朝） */
  deferred: number;
  /** キーがなく、呼ばなかった */
  notConfigured: boolean;
}

type Deps = Pick<AppDeps, "repos" | "claude" | "now">;

/**
 * その家族の未処理の語りから記録を取り出す。毎朝の処理（runMorning）から呼ぶ。投げない。
 */
export async function runRecordExtraction(
  deps: Deps,
  familyId: string,
  opts: { budgetMs?: number; traceId?: string } = {},
): Promise<RecordExtractionSummary> {
  const runId = opts.traceId ?? crypto.randomUUID();
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? RECORD_EXTRACTION_BUDGET_MS);
  const summary: RecordExtractionSummary = {
    runId,
    familyId,
    pending: 0,
    done: 0,
    records: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    notConfigured: false,
  };
  let error: string | null = null;
  try {
    const { repos } = deps;
    const pending = await repos.recordExtractions.listPending(familyId, RECORD_EXTRACTION_MAX_ATTEMPTS, RECORD_EXTRACTION_MAX_PER_RUN);
    summary.pending = pending.length;
    if (pending.length > 0) {
      const members = await repos.members.list(familyId);
      const called = new Map(members.map((m: MemberRow) => [m.id, m.calledAs]));
      const familyCalledAs = members.map((m) => m.calledAs);
      for (let i = 0; i < pending.length; i++) {
        if (Date.now() >= deadline) {
          summary.deferred = pending.length - i;
          break;
        }
        const n = pending[i]!;
        try {
          const status = await extractOne(deps, n, called, familyCalledAs, runId, summary);
          if (status === "not_configured") {
            summary.notConfigured = true;
            break;
          }
        } catch (e) {
          // 一つの語りの失敗で残りを止めない（データベースの失敗など。作業の行は残らないので翌朝また見る）
          summary.failed++;
          console.log(JSON.stringify({ event: "record_extraction", runId, familyId, narrationId: n.id, status: "error", error: e instanceof Error ? e.name : "unknown" }));
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.name : "unknown";
  }
  console.log(
    JSON.stringify({
      event: "record_extraction_run",
      runId,
      familyId,
      promptVersion: PROMPTS.extract_records.version,
      pending: summary.pending,
      done: summary.done,
      records: summary.records,
      failed: summary.failed,
      skipped: summary.skipped,
      deferred: summary.deferred,
      ...(summary.notConfigured ? { notConfigured: true } : {}),
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    }),
  );
  return summary;
}

async function extractOne(
  deps: Deps,
  n: NarrationRow,
  called: ReadonlyMap<string, string>,
  familyCalledAs: string[],
  runId: string,
  summary: RecordExtractionSummary,
): Promise<"done" | "failed" | "skipped" | "not_configured"> {
  const { repos } = deps;
  const started = Date.now();
  const text = quoteSource(n) ? displayText(n) : null;
  if (!text) {
    // 使える文字がない（整形が壊れているなど）。作業の行は残さず、翌朝また見る
    summary.skipped++;
    return "skipped";
  }
  let context: { speakerCalledAs: string | null; text: string } | null = null;
  if (n.replyToId) {
    const parent = await repos.narrations.get(n.familyId, n.replyToId);
    const parentText = parent ? displayText(parent) : null;
    if (parent && parentText) context = { speakerCalledAs: called.get(parent.speakerMemberId) ?? null, text: parentText };
  }
  const prompt = PROMPTS.extract_records;
  const r = await deps.claude.call({
    prompt,
    content: [
      {
        type: "text",
        text: buildRecordInput({ speakerCalledAs: called.get(n.speakerMemberId) ?? null, familyCalledAs, narrationText: text, context }),
      },
    ],
    schema: recordsSchema,
    check: (v) => checkRecords(v, n),
    traceId: runId,
  });
  const attempt: RecordExtractionAttempt = {
    narrationId: n.id,
    familyId: n.familyId,
    promptVersion: prompt.version,
    model: r.meta.model,
    inputTokens: r.meta.inputTokens,
    outputTokens: r.meta.outputTokens,
    createdAt: deps.now().getTime(),
  };
  const log = (status: string, extra: Record<string, unknown> = {}) =>
    console.log(
      JSON.stringify({
        event: "record_extraction",
        runId,
        familyId: n.familyId,
        narrationId: n.id,
        status,
        attempts: r.meta.attempts,
        inputTokens: r.meta.inputTokens,
        outputTokens: r.meta.outputTokens,
        ms: Date.now() - started,
        ...extra,
      }),
    );

  if (!r.ok) {
    // キーがない: 呼べていないので、記録を残さない
    if (r.reason === "not_configured") return "not_configured";
    await repos.recordExtractions.markFailed(attempt);
    summary.failed++;
    log("failed", { reason: r.reason, ...(r.violation ? { violation: r.violation } : {}) });
    return "failed";
  }
  const located = locateRecords(r.value, n);
  if (!located.ok) {
    // check を通ったので起きないはず。起きたら使わない（全か無か）
    await repos.recordExtractions.markFailed(attempt);
    summary.failed++;
    log("failed", { reason: "check_failed", violation: located.violation });
    return "failed";
  }
  const rows: NewToldRecord[] = located.records.map((x) => ({
    id: crypto.randomUUID(),
    familyId: n.familyId,
    photoId: n.photoId,
    kind: x.kind,
    value: x.value,
    toldByMemberId: n.speakerMemberId,
    narrationId: n.id,
    quoteStart: x.start,
    quoteEnd: x.end,
    createdAt: attempt.createdAt,
  }));
  await repos.recordExtractions.saveDone(attempt, rows);
  summary.done++;
  summary.records += rows.length;
  log("done", { records: rows.length });
  return "done";
}
