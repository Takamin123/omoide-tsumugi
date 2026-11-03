// むすびの推測（musubi_guess、Sonnet。0044）: 家族の言葉（records の told）から、別々の写真が同じ出来事を写していると推測し、
// むすび（0010）を guessed として作る。確定・却下は家族の手だけ（ここでは作らない）。
// - 毎朝の処理（Cron・デモの時計のボタン・デモの初期化の三つが通る runMorning）から、記録の取り出しの後・入り口づくりの前に家族ごとに一回呼ぶ
// - 渡すのは、told の記録（新しい順に上限まで）と、その語りの表示の文字（文脈）、記録のある写真の一覧（持ち主の呼ばれ方と撮影日時）、
//   すでにあるむすびの写真の組。写真の説明（photo_guesses）、画像、位置は渡さない。ID は短い呼び名（p1、r1、n1）にして渡し、アプリが戻す
// - 返させるのは、写真の組・根拠の記録・運営だけが読む理由。家族に見せる文は作らせない。むすびの名前は持たない
// - 検査は応答全体の全か無か（違反は 1 回だけ再試行）。既存のむすびとの重なりは違反ではなく、そのむすびだけを捨てる
// - 同じ記録の集合では二度呼ばない（作業の表 musubi_guess_runs）。投げない
// - ログは ID・件数・所要時間・種類だけ（本文、記録の値、理由は出さない）
import { z } from "zod";
import { exceedsChars } from "./claude-checks";
import { displayText } from "./clean-transcript";
import type { AppDeps, MusubiGuessAttempt, MusubiRow, NarrationRow, NewGuessedMusubi, PhotoRow, RecordRow } from "./ports";
import { PROMPTS } from "../prompts";

/** 一回の処理の時間の予算。呼ぶ前に過ぎていたら呼ばずに翌朝へ（呼び出し自体は Claude の時間切れで縛られる） */
export const MUSUBI_GUESS_BUDGET_MS = 60_000;
/** 同じ入力を試す回数の上限（失敗が続いたら、それ以上呼ばない。家族には知らせない） */
export const MUSUBI_GUESS_MAX_ATTEMPTS = 3;
/** 渡す told の記録の上限（新しい順） */
export const MUSUBI_MAX_RECORDS = 150;
/** 渡す語りの本文の合計の上限（新しい順。implementation-policy 2 の 20,000 字） */
export const MUSUBI_MAX_NARRATION_CHARS = 20_000;
/** 一回の応答のむすびの数の上限 */
export const MUSUBI_MAX_PER_RUN = 20;
/** 理由（運営だけが読む）の文字数の上限 */
export const MUSUBI_REASON_MAX_CHARS = 100;
/** 根拠に数えない記録の種類。返ってきても保存する根拠から外す（出し比べで Haiku が「ゆい」「じいちゃん」を根拠にした。0044） */
export const MUSUBI_NON_EVIDENCE_KINDS: readonly RecordRow["kind"][] = ["person"];

export const musubiSchema = z.object({
  musubi: z.array(
    z.object({
      photo_ids: z.array(z.string()),
      evidence_record_ids: z.array(z.string()),
      reason: z.string(),
    }),
  ),
});
export type MusubiOutput = z.infer<typeof musubiSchema>;

/** Claude に渡す材料。ID は短い呼び名に置き換える（呼び名 → 本当の ID の対応はアプリだけが持つ） */
export interface MusubiInput {
  /** 渡した told の記録の ID（作業の表の鍵になる） */
  recordIds: string[];
  photoAlias: Map<string, string>;
  recordAlias: Map<string, RecordRow>;
  text: string;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/**
 * 渡す材料を組む。記録のある写真が 2 枚未満なら null（呼ばない）
 * - told の記録で写真と語りのあるものを新しい順に MUSUBI_MAX_RECORDS まで。語りの本文が MUSUBI_MAX_NARRATION_CHARS を超える分の語りの記録は渡さない
 */
export function buildMusubiInput(input: {
  records: RecordRow[];
  narrations: NarrationRow[];
  photos: PhotoRow[];
  calledAs: ReadonlyMap<string, string>;
  existing: MusubiRow[];
}): MusubiInput | null {
  const narrationById = new Map(input.narrations.map((n) => [n.id, n]));
  const photoById = new Map(input.photos.map((p) => [p.id, p]));
  const told = input.records
    .filter((r) => r.origin === "told" && r.photoId !== null && r.narrationId !== null && photoById.has(r.photoId) && narrationById.has(r.narrationId))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));

  // 新しい順に、語りの本文の合計と記録の数の上限まで
  const usedNarrations = new Map<string, string>(); // id → 表示の文字
  let chars = 0;
  const picked: RecordRow[] = [];
  for (const r of told) {
    if (picked.length >= MUSUBI_MAX_RECORDS) break;
    const nid = r.narrationId!;
    if (!usedNarrations.has(nid)) {
      const text = displayText(narrationById.get(nid)!);
      if (!text || chars + text.length > MUSUBI_MAX_NARRATION_CHARS) continue;
      usedNarrations.set(nid, text);
      chars += text.length;
    }
    picked.push(r);
  }
  if (new Set(picked.map((r) => r.photoId!)).size < 2) return null;

  // 呼び名は古い順に振る（入力が同じなら同じ呼び名）。写真は、記録に初めて出てくる順
  const recordsInOrder = [...picked].sort(
    (a, b) => a.createdAt - b.createdAt || (a.narrationId! < b.narrationId! ? -1 : a.narrationId! > b.narrationId! ? 1 : 0) || (a.quoteStart ?? 0) - (b.quoteStart ?? 0) || (a.id < b.id ? -1 : 1),
  );
  const photosInOrder = [...new Set(recordsInOrder.map((r) => r.photoId!))].map((id) => photoById.get(id)!);
  const photoAlias = new Map<string, string>();
  const aliasOfPhoto = new Map<string, string>();
  photosInOrder.forEach((p, i) => {
    photoAlias.set(`p${i + 1}`, p.id);
    aliasOfPhoto.set(p.id, `p${i + 1}`);
  });
  const narrationsInOrder = [...usedNarrations.keys()]
    .map((id) => narrationById.get(id)!)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const recordAlias = new Map<string, RecordRow>();
  const aliasOfRecord = new Map<string, string>();
  recordsInOrder.forEach((r, i) => {
    recordAlias.set(`r${i + 1}`, r);
    aliasOfRecord.set(r.id, `r${i + 1}`);
  });

  const lines: string[] = ["<photos>"];
  for (const p of photosInOrder) {
    const owner = input.calledAs.get(p.ownerMemberId) ?? "分からない";
    const taken = p.takenAt ? p.takenAt.slice(0, 16).replace("T", " ") : "なし";
    lines.push(`<photo id="${aliasOfPhoto.get(p.id)}" owner="${esc(owner)}" taken="${taken}"/>`);
  }
  lines.push("</photos>", "<narrations>");
  narrationsInOrder.forEach((n, i) => {
    const speaker = input.calledAs.get(n.speakerMemberId) ?? "分からない";
    lines.push(`<narration id="n${i + 1}" photo="${aliasOfPhoto.get(n.photoId)}" speaker="${esc(speaker)}">`);
    lines.push(esc(usedNarrations.get(n.id)!));
    for (const r of recordsInOrder.filter((x) => x.narrationId === n.id)) {
      lines.push(`<record id="${aliasOfRecord.get(r.id)}" kind="${r.kind}">${esc(r.value)}</record>`);
    }
    lines.push("</narration>");
  });
  lines.push("</narrations>");

  const existingLines: string[] = [];
  for (const m of input.existing) {
    const live = m.photos.filter((p) => p.status !== "rejected").map((p) => p.photoId);
    const shown = live.map((id) => aliasOfPhoto.get(id)).filter((a): a is string => a !== undefined)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    if (shown.length > 0) existingLines.push(`<musubi photos="${shown.join(" ")}"/>`);
  }
  lines.push("<existing>", ...existingLines, "</existing>");

  return { recordIds: picked.map((r) => r.id).sort(), photoAlias, recordAlias, text: lines.join("\n") };
}

type Resolved = { photoIds: string[]; evidenceRecordIds: string[]; reason: string };

/**
 * 受け取ったむすびの検査（応答全体の全か無か）。違反の種類だけを返す（本文は返さない）。問題なければ本当の ID に戻したもの
 * - 写真・記録の呼び名は渡したものだけ（＝その家族の、told の記録と、その記録のある写真）
 * - 写真は 2 枚以上で重複なし。応答の中で一枚の写真は一つのむすびだけ
 * - 根拠の記録は 1 件以上で、どれもむすびの写真の記録。人の記録（person）は根拠に数えず、外した後もむすびの写真のどれにも根拠の記録がある
 * - 理由は空でなく 100 字以内
 */
export function resolveMusubi(v: MusubiOutput, input: Pick<MusubiInput, "photoAlias" | "recordAlias">): { ok: true; musubi: Resolved[] } | { ok: false; violation: string } {
  if (v.musubi.length > MUSUBI_MAX_PER_RUN) return { ok: false, violation: "too_many" };
  const seenPhotos = new Set<string>();
  const out: Resolved[] = [];
  for (const m of v.musubi) {
    const photoIds: string[] = [];
    for (const a of m.photo_ids) {
      const id = input.photoAlias.get(a.trim());
      if (!id) return { ok: false, violation: "unknown_photo" };
      if (photoIds.includes(id)) return { ok: false, violation: "duplicate_photo" };
      photoIds.push(id);
    }
    if (photoIds.length < 2) return { ok: false, violation: "too_few_photos" };
    if (photoIds.some((id) => seenPhotos.has(id))) return { ok: false, violation: "overlap" };
    if (m.evidence_record_ids.length === 0) return { ok: false, violation: "no_evidence" };
    const evidence: RecordRow[] = [];
    for (const a of m.evidence_record_ids) {
      const r = input.recordAlias.get(a.trim());
      if (!r) return { ok: false, violation: "unknown_record" };
      if (r.origin !== "told") return { ok: false, violation: "not_told" };
      if (evidence.some((x) => x.id === r.id)) return { ok: false, violation: "duplicate_record" };
      evidence.push(r);
    }
    if (evidence.some((r) => !photoIds.includes(r.photoId!))) return { ok: false, violation: "evidence_outside" };
    // 人の記録は根拠に数えない（同じ人が出てくるだけでは同じ出来事ではない）。外した後に、どの写真にも根拠が残ること
    const counted = evidence.filter((r) => !MUSUBI_NON_EVIDENCE_KINDS.includes(r.kind));
    if (photoIds.some((id) => !counted.some((r) => r.photoId === id))) return { ok: false, violation: "photo_without_evidence" };
    const reason = m.reason.trim();
    if (reason.length === 0 || exceedsChars(reason, MUSUBI_REASON_MAX_CHARS)) return { ok: false, violation: "reason" };
    for (const id of photoIds) seenPhotos.add(id);
    out.push({ photoIds, evidenceRecordIds: counted.map((r) => r.id), reason });
  }
  return { ok: true, musubi: out };
}

export function checkMusubi(v: MusubiOutput, input: Pick<MusubiInput, "photoAlias" | "recordAlias">): string | null {
  const r = resolveMusubi(v, input);
  return r.ok ? null : r.violation;
}

/**
 * 既存のむすびとの重複除け（違反ではない）。捨てるもの:
 * - 既存の guessed / confirmed のむすびの写真と一枚でも重なる（既存への写真の追加は今はしない）
 * - 家族が却下した組を含む（むすび M で却下された写真 X と、M のほかの写真を一緒にしている）
 */
export function dropOverlapping(musubi: Resolved[], existing: MusubiRow[]): { kept: Resolved[]; dropped: number } {
  const taken = new Set(existing.flatMap((m) => m.photos.filter((p) => p.status !== "rejected").map((p) => p.photoId)));
  const rejectedPairs: [string, string][] = [];
  for (const m of existing) {
    for (const x of m.photos.filter((p) => p.status === "rejected")) {
      for (const o of m.photos) if (o.photoId !== x.photoId) rejectedPairs.push([x.photoId, o.photoId]);
    }
  }
  const kept: Resolved[] = [];
  let dropped = 0;
  for (const m of musubi) {
    const overlaps = m.photoIds.some((id) => taken.has(id));
    const rejected = rejectedPairs.some(([a, b]) => m.photoIds.includes(a) && m.photoIds.includes(b));
    if (overlaps || rejected) dropped++;
    else kept.push(m);
  }
  return { kept, dropped };
}

/** 渡した記録の ID の集合のハッシュ（作業の表の鍵）。版は入れない */
export async function musubiInputKey(recordIds: string[]): Promise<string> {
  const data = new TextEncoder().encode([...recordIds].sort().join("\n"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type MusubiGuessStatus = "done" | "failed" | "unchanged" | "gave_up" | "too_few" | "deferred" | "not_configured" | "error";

export interface MusubiGuessSummary {
  runId: string;
  familyId: string;
  status: MusubiGuessStatus;
  /** 渡した記録の数 */
  records: number;
  /** 入れたむすびの数 */
  created: number;
  /** 既存と重なって捨てたむすびの数 */
  dropped: number;
}

type Deps = Pick<AppDeps, "repos" | "claude" | "now">;

/**
 * その家族のむすびを推測する。毎朝の処理（runMorning）から、記録の取り出しの後に呼ぶ。投げない。
 */
export async function runMusubiGuess(deps: Deps, familyId: string, opts: { budgetMs?: number; traceId?: string } = {}): Promise<MusubiGuessSummary> {
  const runId = opts.traceId ?? crypto.randomUUID();
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? MUSUBI_GUESS_BUDGET_MS);
  const summary: MusubiGuessSummary = { runId, familyId, status: "error", records: 0, created: 0, dropped: 0 };
  const extra: Record<string, unknown> = {};
  try {
    summary.status = await guess(deps, familyId, runId, deadline, summary, extra);
  } catch (e) {
    summary.status = "error";
    extra.error = e instanceof Error ? e.name : "unknown";
  }
  console.log(
    JSON.stringify({
      event: "musubi_guess_run",
      runId,
      familyId,
      promptVersion: PROMPTS.musubi_guess.version,
      status: summary.status,
      records: summary.records,
      created: summary.created,
      dropped: summary.dropped,
      ms: Date.now() - started,
      ...extra,
    }),
  );
  return summary;
}

async function guess(
  deps: Deps,
  familyId: string,
  runId: string,
  deadline: number,
  summary: MusubiGuessSummary,
  extra: Record<string, unknown>,
): Promise<MusubiGuessStatus> {
  const { repos } = deps;
  const [records, narrations, photos, members, existing] = await Promise.all([
    repos.records.listByFamily(familyId),
    repos.narrations.listAll(familyId),
    repos.photos.list(familyId),
    repos.members.list(familyId),
    repos.musubi.listByFamily(familyId),
  ]);
  const input = buildMusubiInput({ records, narrations, photos, calledAs: new Map(members.map((m) => [m.id, m.calledAs])), existing });
  if (!input) return "too_few";
  summary.records = input.recordIds.length;
  const inputKey = await musubiInputKey(input.recordIds);
  extra.inputKey = inputKey.slice(0, 12);
  const run = await repos.musubi.getRun(familyId, inputKey);
  if (run?.state === "done") return "unchanged";
  if (run && run.attempts >= MUSUBI_GUESS_MAX_ATTEMPTS) return "gave_up";
  if (Date.now() >= deadline) return "deferred";

  const prompt = PROMPTS.musubi_guess;
  const r = await deps.claude.call({
    prompt,
    content: [{ type: "text", text: input.text }],
    schema: musubiSchema,
    check: (v) => checkMusubi(v, input),
    traceId: runId,
  });
  const attempt: MusubiGuessAttempt = {
    familyId,
    inputKey,
    promptVersion: prompt.version,
    model: r.meta.model,
    inputTokens: r.meta.inputTokens,
    outputTokens: r.meta.outputTokens,
    createdAt: deps.now().getTime(),
  };
  Object.assign(extra, { model: r.meta.model, attempts: r.meta.attempts, inputTokens: r.meta.inputTokens, outputTokens: r.meta.outputTokens });
  if (!r.ok) {
    if (r.reason === "not_configured") return "not_configured";
    await repos.musubi.markFailed(attempt);
    Object.assign(extra, { reason: r.reason, ...(r.violation ? { violation: r.violation } : {}) });
    return "failed";
  }
  const resolved = resolveMusubi(r.value, input);
  if (!resolved.ok) {
    // check を通ったので起きないはず。起きたら使わない（全か無か）
    await repos.musubi.markFailed(attempt);
    Object.assign(extra, { reason: "check_failed", violation: resolved.violation });
    return "failed";
  }
  const { kept, dropped } = dropOverlapping(resolved.musubi, existing);
  summary.dropped = dropped;
  const rows: NewGuessedMusubi[] = kept.map((m) => ({
    id: crypto.randomUUID(),
    familyId,
    photoIds: m.photoIds,
    evidenceRecordIds: m.evidenceRecordIds,
    reason: m.reason,
    createdAt: attempt.createdAt,
  }));
  if (!(await repos.musubi.saveGuessed(attempt, rows))) {
    // 出所のモデルが分からない推測は入れない（失敗にして翌朝に取り直す）
    extra.reason = "no_model";
    return "failed";
  }
  summary.created = rows.length;
  return "done";
}
