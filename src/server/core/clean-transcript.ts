// 文字起こしの整形（Haiku）と、聞き間違いの印。判断は docs/decisions/0018。
// - 整形は削るだけ（句読点・改行を入れる、フィラーと言い直しを取る）。方言・数字・綴りは変えない
// - Haiku には、怪しい所を印の記号で囲んだ本文を返させる。位置はアプリが記号を外して数える（cleanedText の位置）
// - 検査は全か無か。外れたら土台（ClaudeClient の check）が 1 回だけ再試行する。だめなら cleanedText は null のまま
// - 表示では、印の範囲を「……」に置き換える（サーバーで行う。生の範囲はクライアントに出さない）
import { z } from "zod";
import { PROMPTS } from "../prompts";
import type { AppDeps, MemberRow, NarrationRow, UncertainSpan } from "./ports";

/** 怪しい所を囲む記号。語りに出てこない記号にする（transcript にあれば整形しない） */
export const UNCERTAIN_OPEN = "⟦";
export const UNCERTAIN_CLOSE = "⟧";
/** 表示で、印の範囲の代わりに出す文字 */
export const UNCERTAIN_PLACEHOLDER = "……";
/** 空白・句読点・記号を除いた長さで、整形後が transcript の何割以上残っていなければならないか */
export const CLEAN_MIN_KEPT_RATIO = 0.7;
/** 印の範囲の合計が、整形後の文字の何割までか */
export const CLEAN_MAX_UNCERTAIN_RATIO = 0.3;

/** 構造化出力の形。本文は一つの欄だけ（位置は数えさせない） */
export const cleanTranscriptSchema = z.object({
  marked: z.string().describe(`整えた本文。聞き間違いかもしれない所は ${UNCERTAIN_OPEN} と ${UNCERTAIN_CLOSE} で囲む`),
});
export type CleanTranscriptOutput = z.infer<typeof cleanTranscriptSchema>;

/** 検査の違反の種類（ログに出る。本文は入れない） */
export type CleanViolation =
  | "empty"
  | "marker_nested"
  | "marker_unbalanced"
  | "marker_empty"
  | "not_subsequence"
  | "too_short"
  | "too_uncertain";

export type ParsedMarked = { ok: true; cleanedText: string; spans: UncertainSpan[] } | { ok: false; violation: CleanViolation };

/**
 * 印の記号を外し、cleanedText と、その中の印の範囲（[start, end)、UTF-16 の添字）を返す。
 * 入れ子・閉じ忘れ・空の印は違反。隣り合う印は一つにまとめる。
 */
export function parseMarked(marked: string): ParsedMarked {
  let out = "";
  const spans: UncertainSpan[] = [];
  let open: number | null = null;
  for (const ch of marked) {
    if (ch === UNCERTAIN_OPEN) {
      if (open !== null) return { ok: false, violation: "marker_nested" };
      open = out.length;
      continue;
    }
    if (ch === UNCERTAIN_CLOSE) {
      if (open === null) return { ok: false, violation: "marker_unbalanced" };
      if (out.length === open) return { ok: false, violation: "marker_empty" };
      const last = spans[spans.length - 1];
      if (last && last.end === open) last.end = out.length;
      else spans.push({ start: open, end: out.length });
      open = null;
      continue;
    }
    out += ch;
  }
  if (open !== null) return { ok: false, violation: "marker_unbalanced" };
  return { ok: true, cleanedText: out, spans };
}

/** 比べるときに除くもの: 空白（改行を含む）・句読点・記号。かなと漢字、数字はそのまま（表記を変えたら外れる） */
const IGNORED = /[\s\p{P}\p{S}]/gu;
function significant(text: string): string[] {
  return Array.from(text.replace(IGNORED, ""));
}

/** a が b の部分列か（b から削るだけで a が作れるか） */
export function isSubsequence(a: readonly string[], b: readonly string[]): boolean {
  let j = 0;
  for (const ch of a) {
    while (j < b.length && b[j] !== ch) j++;
    if (j === b.length) return false;
    j++;
  }
  return true;
}

/** 整形を始めてよい transcript か（意味のある文字があり、印の記号を含まない） */
export function canClean(transcript: string | null): transcript is string {
  if (!transcript) return false;
  if (transcript.includes(UNCERTAIN_OPEN) || transcript.includes(UNCERTAIN_CLOSE)) return false;
  return significant(transcript).length > 0;
}

/**
 * 整形の検査（全か無か）。違反があればその種類、なければ null。
 * 1. 空白・句読点・記号を除くと、cleaned が transcript の部分列
 * 2. 除いた後の長さが transcript の CLEAN_MIN_KEPT_RATIO 以上
 * 3. 印が正しく閉じていて、合計が cleaned の CLEAN_MAX_UNCERTAIN_RATIO 以下
 */
export function checkMarked(transcript: string, marked: string): CleanViolation | null {
  const parsed = parseMarked(marked);
  if (!parsed.ok) return parsed.violation;
  const cleaned = significant(parsed.cleanedText);
  if (cleaned.length === 0) return "empty";
  const original = significant(transcript);
  if (!isSubsequence(cleaned, original)) return "not_subsequence";
  if (cleaned.length < original.length * CLEAN_MIN_KEPT_RATIO) return "too_short";
  const uncertain = parsed.spans.reduce((sum, s) => sum + (s.end - s.start), 0);
  if (uncertain > parsed.cleanedText.length * CLEAN_MAX_UNCERTAIN_RATIO) return "too_uncertain";
  return null;
}

// ---- Claude に渡すもの ----

type SpeakerForClean = Pick<MemberRow, "calledAs" | "speechStyle" | "dialectRegion">;

/**
 * user の一通。話し手の呼ばれ方と話し方（0013 と同じ材料）、家族の呼ばれ方、文字起こし。
 * 名前は呼ばれ方まで。写真の推測や位置から引いた地名は入れない。
 */
export function buildCleanInput(input: {
  speaker: SpeakerForClean | null;
  familyCalledAs: string[];
  transcript: string;
}): string {
  const { speaker } = input;
  const style = !speaker
    ? "分からない"
    : speaker.speechStyle === "dialect"
      ? speaker.dialectRegion
        ? `方言（${speaker.dialectRegion}の言葉）`
        : "方言（地域は分からない）"
      : "標準語";
  return [
    "<speaker>",
    `呼ばれ方: ${speaker?.calledAs ?? "分からない"}`,
    `話し方: ${style}`,
    "</speaker>",
    "<family_names>",
    input.familyCalledAs.join("、"),
    "</family_names>",
    "<transcript>",
    input.transcript,
    "</transcript>",
  ].join("\n");
}

// ---- 背景の処理 ----

/**
 * 文字起こしの済んだ声の語りを一度だけ整形する（transcribeNarration の続きで呼ぶ）。
 * 対象外（文字の語り、done でない、整形済み）なら何もしない。失敗しても cleanedText は null のまま（表示は transcript）。
 * 投げない。ログは ID・種類・数だけ。
 */
export async function cleanNarration(deps: Pick<AppDeps, "repos" | "claude">, familyId: string, narrationId: string): Promise<void> {
  const log = (fields: Record<string, unknown>) =>
    console.log(JSON.stringify({ event: "clean_transcript_done", familyId, narrationId, ...fields }));
  try {
    const n = await deps.repos.narrations.get(familyId, narrationId);
    if (!n || n.kind !== "voice" || n.transcriptStatus !== "done" || n.cleanedText !== null) return;
    if (!canClean(n.transcript)) {
      log({ status: "skipped" });
      return;
    }
    const transcript = n.transcript;
    const members = await deps.repos.members.list(familyId);
    const speaker = members.find((m) => m.id === n.speakerMemberId) ?? null;
    const prompt = PROMPTS.clean_transcript;
    const r = await deps.claude.call({
      prompt,
      content: [{ type: "text", text: buildCleanInput({ speaker, familyCalledAs: members.map((m) => m.calledAs), transcript }) }],
      schema: cleanTranscriptSchema,
      check: (v) => checkMarked(transcript, v.marked),
      traceId: narrationId,
    });
    const usage = {
      model: r.meta.model,
      promptVersion: r.meta.promptVersion,
      attempts: r.meta.attempts,
      inputTokens: r.meta.inputTokens,
      outputTokens: r.meta.outputTokens,
    };
    if (!r.ok) {
      log({ status: "failed", reason: r.reason, ...(r.violation ? { violation: r.violation } : {}), ...usage });
      return;
    }
    const parsed = parseMarked(r.value.marked);
    if (!parsed.ok) {
      // check を通ったものなので来ないはず。来たら使わない
      log({ status: "failed", reason: "check_failed", violation: parsed.violation, ...usage });
      return;
    }
    const saved = await deps.repos.narrations.setCleaned(familyId, narrationId, {
      cleanedText: parsed.cleanedText,
      cleanedModel: r.meta.model,
      cleanedPromptVersion: prompt.version,
      uncertainSpans: parsed.spans,
    });
    log({ status: saved ? "done" : "already", uncertainSpans: parsed.spans.length, ...usage });
  } catch (e) {
    log({ status: "failed", reason: e instanceof Error ? e.name : "unknown" });
  }
}

// ---- 表示 ----

/** 範囲が cleanedText の中に収まり、重ならず、昇順か（データベースから読んだものを使う前に確かめる） */
function spansAreValid(spans: unknown, length: number): spans is readonly UncertainSpan[] {
  if (!Array.isArray(spans)) return false;
  let prevEnd = 0;
  for (const s of spans as unknown[]) {
    if (typeof s !== "object" || s === null) return false;
    const { start, end } = s as Record<string, unknown>;
    if (typeof start !== "number" || typeof end !== "number") return false;
    if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
    if (start < prevEnd || end <= start || end > length) return false;
    prevEnd = end;
  }
  return true;
}

/** text の [from, to) を切り出してから、その中に入る印の範囲を「……」に置き換える（範囲は text の位置） */
function renderSlice(text: string, spans: readonly UncertainSpan[], from: number, to: number): string {
  let out = "";
  let pos = from;
  for (const s of spans) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.end, to);
    if (start >= end) continue;
    out += text.slice(pos, start) + UNCERTAIN_PLACEHOLDER;
    pos = end;
  }
  return out + text.slice(pos, to);
}

/** 整形があって、範囲が読めて正しいときだけ使う。そうでなければ null（transcript に倒す） */
function usableCleaned(n: Pick<NarrationRow, "cleanedText" | "uncertainSpans">): { text: string; spans: readonly UncertainSpan[] } | null {
  if (n.cleanedText === null || n.cleanedText.length === 0) return null;
  // 整形を書くときは、印がなくても空の配列を入れる。null なら読めなかった（壊れていた）ので、印を守れない整形は使わない
  const spans: unknown = n.uncertainSpans;
  if (!spansAreValid(spans, n.cleanedText.length)) return null;
  return { text: n.cleanedText, spans };
}

type DisplaySource = Pick<NarrationRow, "cleanedText" | "uncertainSpans" | "transcript">;

/**
 * 画面に出す文字。整えた文字があれば、印の範囲を「……」に置き換えたもの。なければ文字起こし（印なし）。
 * どちらもなければ null
 */
export function displayText(n: DisplaySource): string | null {
  const c = usableCleaned(n);
  if (c) return renderSlice(c.text, c.spans, 0, c.text.length);
  return n.transcript && n.transcript.length > 0 ? n.transcript : null;
}

/**
 * 添える家族の言葉。範囲（cleanedText の位置）がなければ全文。
 * 範囲があるのに使える整形がない、範囲が外れている、置き換えた後に言葉が残らない、のどれかなら null（引用しない）。
 * 切り出してから置き換える（置き換えると位置がずれるため）
 */
export function quoteText(n: DisplaySource, start: number | null, end: number | null): string | null {
  if (start === null || end === null) return displayText(n);
  const c = usableCleaned(n);
  if (!c) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > c.text.length) return null;
  const text = renderSlice(c.text, c.spans, start, end);
  return significant(text.split(UNCERTAIN_PLACEHOLDER).join("")).length > 0 ? text : null;
}
