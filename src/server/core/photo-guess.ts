// 写真の初回整理（photo_guess、Haiku）: 写真ごとに「写っている内容」の短い説明（推測）を作り、photo_guesses に入れる。
// - 説明は家族に見せない。入り口づくりの材料にだけ使う（0017）。家族向けの API の形（routes/views.ts）に入れない
// - 渡すのは縮小済みの画像だけ。撮影日、持ち主の呼ばれ方、家族の一覧、位置は渡さない（0012、0021）
// - 写真を「取って」から呼ぶ（photo_guess_requests）。同じ写真を二度呼ばない、二度 Batch に入れない
// - 取れた枚数がしきい値以下なら一枚ずつ call、超えたら Batch。Batch の回収も同じ関数で行う
// - 失敗しても写真の登録や毎朝の処理は止めない。家族には知らせない。ログは ID・件数・理由の種類だけ
import { z } from "zod";
import { bytesToBase64 } from "./claude";
import { exceedsChars } from "./claude-checks";
import type { AppDeps, ClaudeContentPart, ClaudeFailure, ClaudePrompt, PhotoRow } from "./ports";
import { PROMPTS } from "../prompts";

/** これ以下の枚数なら一枚ずつ呼ぶ。超えたら Batch にする */
export const PHOTO_GUESS_CALL_THRESHOLD = 10;
/** 一回の処理で取る写真の上限（Batch 一回に載せる枚数の上限も兼ねる。残りは次の回） */
export const PHOTO_GUESS_MAX_PER_RUN = 30;
/** 一枚ずつ呼ぶときに、同時に呼ぶ数（waitUntil の 30 秒の内側に収める） */
export const PHOTO_GUESS_CALL_CONCURRENCY = 4;
/** Batch 一回に載せる画像の base64 の合計の上限（メモリ 128MB の内側。アダプタの上限より小さくする） */
export const PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS = 24 * 1024 * 1024;
/** 一枚の画像の base64 の長さの上限（API の上限 5MB。超える一枚で Batch 全体が断られないよう、先に外す） */
export const PHOTO_GUESS_MAX_IMAGE_BASE64_CHARS = 5 * 1024 * 1024;
/** 同じ写真を試す回数の上限（家族には知らせず、それ以上は作らない） */
export const PHOTO_GUESS_MAX_ATTEMPTS = 3;
/** 失敗した写真や、一枚ずつ呼んでいる途中で落ちた処理の記録を、取り直してよくなるまでの時間 */
export const PHOTO_GUESS_STALE_MS = 10 * 60_000;
/** Batch に入れたまま回収できなかった記録を、取り直してよくなるまでの時間（Batch の期限 24 時間の外側） */
export const PHOTO_GUESS_BATCH_STALE_MS = 25 * 60 * 60_000;
/** 一回の処理の時間の予算。超えたら新しい写真は呼ばず、次の回に回す（毎朝の処理の本体は入り口づくり） */
export const PHOTO_GUESS_TIME_BUDGET_MS = 60_000;
/** 応答の後の背景処理での予算（waitUntil は応答の後 30 秒まで） */
export const PHOTO_GUESS_BACKGROUND_BUDGET_MS = 25_000;
/**
 * デモの初期化（0038）での予算。初期化は Batch を使わずにその場で全部の写真を呼ぶので、毎朝の 60 秒より長くとる。
 * 初期化は要求の中で走る（応答の前。HTTP の要求には時間の上限がなく、waitUntil の 30 秒の外）。この予算は新しい写真を
 * 呼び始める締め切りで、呼んでいる途中のものは終わるまで待つ。過ぎた写真は次の回（翌朝・時計のボタン）に回る
 */
export const PHOTO_GUESS_DEMO_RESET_BUDGET_MS = 90_000;
/** 説明の文字数の上限 */
export const PHOTO_GUESS_MAX_CHARS = 200;

/**
 * 説明に入れない、続柄の語（部分一致）。人の続柄を決めつけさせない。
 * 誤って止めても失うのは家族に見せない説明一つなので、止める側に倒す（一字の語も入れる）。
 * 名前の決めつけは機械では見つけにくいので、プロンプトに頼る。
 */
export const PHOTO_GUESS_KINSHIP_WORDS: readonly string[] = [
  "祖父",
  "祖母",
  "おじいちゃん",
  "おばあちゃん",
  "おじいさん",
  "おばあさん",
  "じいじ",
  "ばあば",
  "お父さん",
  "お母さん",
  "父",
  "母",
  "息子",
  "娘",
  "孫",
  "夫",
  "妻",
  "兄",
  "弟",
  "姉",
  "妹",
  "両親",
  "親子",
  "家族",
];

/**
 * 説明に入れない、感想・物語の語（部分一致）。説明は入り口づくりの材料になるので、
 * 推測した気持ちが問いかけの前提に忍び込まないようにする。
 */
export const PHOTO_GUESS_FEELING_WORDS: readonly string[] = [
  "楽し",
  "幸せ",
  "大切",
  "思い出",
  "懐かし",
  "素敵",
  "かわいい",
  "可愛い",
  "美しい",
  "笑顔",
];

export const photoGuessSchema = z.object({ description: z.string() });
export type PhotoGuessOutput = z.infer<typeof photoGuessSchema>;

/** 受け取った説明の機械検査。違反の種類だけを返す（本文は返さない） */
export function checkPhotoGuess(v: PhotoGuessOutput): string | null {
  const d = v.description.trim();
  if (d.length === 0) return "empty";
  if (exceedsChars(d, PHOTO_GUESS_MAX_CHARS)) return "too_long";
  if (PHOTO_GUESS_KINSHIP_WORDS.some((w) => d.includes(w))) return "kinship";
  if (PHOTO_GUESS_FEELING_WORDS.some((w) => d.includes(w))) return "feeling";
  return null;
}

export interface PhotoGuessSummary {
  runId: string;
  familyId: string;
  /** 回収した Batch の数（終わっていたもの） */
  batchesCollected: number;
  mode: "none" | "call" | "batch";
  claimed: number;
  saved: number;
  failed: number;
  /** この回で作った Batch */
  batchId: string | null;
}

type Deps = Pick<AppDeps, "repos" | "photos" | "claude" | "now">;

export interface PhotoGuessOptions {
  /** 時間の予算（新しい写真を呼び始める締め切り）。既定は PHOTO_GUESS_TIME_BUDGET_MS */
  budgetMs?: number;
  /** 真なら、しきい値を超えても Batch にせず一枚ずつ call にする（デモの初期化だけ。0038） */
  noBatch?: boolean;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** 写真一枚ぶんの、Claude に渡すもの。画像が見つからなければ null */
async function photoContent(deps: Deps, photo: PhotoRow): Promise<ClaudeContentPart[] | null> {
  const obj = await deps.photos.get(photo.storageKey);
  if (!obj) return null;
  const bytes = new Uint8Array(await new Response(obj.body).arrayBuffer());
  const mediaType = (IMAGE_TYPES.has(obj.contentType) ? obj.contentType : "image/jpeg") as Extract<
    ClaudeContentPart,
    { type: "image" }
  >["mediaType"];
  // 画像だけ。撮影日は渡さない（写っていない日付を書き写したり、日付から行事を決めたりしないように。0021）
  return [{ type: "image", mediaType, base64: bytesToBase64(bytes) }];
}

/** 呼べなかった（写真について答えを受け取っていない）ので、試した回数に数えない失敗 */
const NOT_ATTEMPTED: ReadonlySet<ClaudeFailure> = new Set<ClaudeFailure>(["not_configured"]);

/**
 * その家族の写真の説明づくりを一回進める。
 * 写真の登録の後（背景処理）と、毎朝の処理（Cron とデモの時計のボタンの両方が通る）から呼ぶ。投げない。
 * 1. 回収を待っている Batch のうち、終わったものの結果を入れる
 * 2. まだ説明のない写真を取り、しきい値以下なら一枚ずつ call、超えたら Batch を作る
 *
 * noBatch: 枚数にかかわらず一枚ずつ call にする（Batch を作らない）。デモの初期化だけが使う（0038）。
 * 初期化は写真を入れ直した直後に入り口を作るので、Batch だと説明がそろう前に入り口ができてしまう。
 * 毎朝の処理（Cron）と写真の登録の後は渡さない（しきい値で分ける）
 */
export async function runPhotoGuesses(
  deps: Deps,
  familyId: string,
  opts: PhotoGuessOptions = {},
): Promise<PhotoGuessSummary> {
  const runId = crypto.randomUUID();
  const started = Date.now();
  const summary: PhotoGuessSummary = {
    runId,
    familyId,
    batchesCollected: 0,
    mode: "none",
    claimed: 0,
    saved: 0,
    failed: 0,
    batchId: null,
  };
  let error: string | null = null;
  try {
    const deadline = started + (opts.budgetMs ?? PHOTO_GUESS_TIME_BUDGET_MS);
    summary.batchesCollected = await collectBatches(deps, familyId, runId, summary);
    if (Date.now() < deadline) await startGuesses(deps, familyId, runId, summary, deadline, opts.noBatch === true);
  } catch (e) {
    error = e instanceof Error ? e.name : "unknown";
  }
  console.log(
    JSON.stringify({
      event: "photo_guess_run",
      runId,
      familyId,
      promptVersion: PROMPTS.photo_guess.version,
      batchesCollected: summary.batchesCollected,
      mode: summary.mode,
      claimed: summary.claimed,
      saved: summary.saved,
      failed: summary.failed,
      batchId: summary.batchId,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    }),
  );
  return summary;
}

async function collectBatches(deps: Deps, familyId: string, runId: string, summary: PhotoGuessSummary): Promise<number> {
  const { repos } = deps;
  let collected = 0;
  for (const open of await repos.photoGuesses.listOpenBatches(familyId)) {
    try {
      collected += await collectBatch(deps, familyId, runId, summary, open);
    } catch {
      // 一つの Batch の失敗で、ほかの Batch と新しい写真の処理を止めない。次の回でまた回収する
    }
  }
  return collected;
}

async function collectBatch(
  deps: Deps,
  familyId: string,
  runId: string,
  summary: PhotoGuessSummary,
  open: { batchId: string; promptVersion: string },
): Promise<number> {
  const { repos, claude } = deps;
  const info = await claude.getBatch(open.batchId, runId);
  if (!info.ok && info.reason === "rejected") {
    // Batch が見つからない（期限切れで消えたなど）: 入っていた写真を失敗にして、次の回で取り直す
    const lost = (await repos.photoGuesses.listClaimsByBatch(open.batchId)).filter((c) => c.familyId === familyId).map((c) => c.photoId);
    await repos.photoGuesses.markFailed(familyId, lost, open.promptVersion);
    summary.failed += lost.length;
    return 0;
  }
  if (!info.ok || info.value.status !== "ended") return 0;
  // 版は Batch を作ったときのもの（途中でプロンプトの版を上げても、作った版で記録する）
  const prompt: ClaudePrompt = { ...PROMPTS.photo_guess, version: open.promptVersion };
  const results = await claude.getBatchResults({
    batchId: open.batchId,
    prompt,
    schema: photoGuessSchema,
    check: checkPhotoGuess,
    traceId: runId,
  });
  if (!results.ok) return 0;
  const byId = new Map(results.value.map((r) => [r.customId, r]));
  const failed: string[] = [];
  for (const c of await repos.photoGuesses.listClaimsByBatch(open.batchId)) {
    if (c.familyId !== familyId) continue;
    const row = byId.get(c.photoId);
    if (row?.ok) {
      await repos.photoGuesses.saveGuess({
        id: crypto.randomUUID(),
        photoId: c.photoId,
        familyId,
        description: row.value.description.trim(),
        model: row.meta.model,
        promptVersion: open.promptVersion,
        createdAt: deps.now().getTime(),
      });
      summary.saved++;
    } else {
      // 結果がない行・失敗した行は、次の回に取り直す（回数の上限まで）
      failed.push(c.photoId);
    }
  }
  await repos.photoGuesses.markFailed(familyId, failed, open.promptVersion);
  summary.failed += failed.length;
  return 1;
}

async function startGuesses(
  deps: Deps,
  familyId: string,
  runId: string,
  summary: PhotoGuessSummary,
  deadline: number,
  noBatch: boolean,
): Promise<void> {
  const { repos } = deps;
  const prompt = PROMPTS.photo_guess;
  const now = deps.now().getTime();
  const opts = {
    staleBefore: now - PHOTO_GUESS_STALE_MS,
    batchStaleBefore: now - PHOTO_GUESS_BATCH_STALE_MS,
    maxAttempts: PHOTO_GUESS_MAX_ATTEMPTS,
  };
  const candidates = await repos.photoGuesses.listCandidates(familyId, prompt.version, PHOTO_GUESS_MAX_PER_RUN, opts);
  if (candidates.length === 0) return;
  const claimedIds = new Set(await repos.photoGuesses.claim(familyId, candidates.map((p) => p.id), prompt.version, { now, ...opts }));
  const claimed = candidates.filter((p) => claimedIds.has(p.id));
  summary.claimed = claimed.length;
  if (claimed.length === 0) return;

  if (noBatch || claimed.length <= PHOTO_GUESS_CALL_THRESHOLD) {
    summary.mode = "call";
    await callEach(deps, familyId, claimed, runId, summary, deadline);
  } else {
    summary.mode = "batch";
    await createBatch(deps, familyId, claimed, runId, summary);
  }
}

async function callEach(
  deps: Deps,
  familyId: string,
  photos: PhotoRow[],
  runId: string,
  summary: PhotoGuessSummary,
  deadline: number,
): Promise<void> {
  const { repos } = deps;
  const prompt = PROMPTS.photo_guess;
  const queue = [...photos];
  const worker = async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const photo = queue.shift()!;
      try {
        const content = await photoContent(deps, photo);
        if (!content) {
          await repos.photoGuesses.markFailed(familyId, [photo.id], prompt.version);
          summary.failed++;
          continue;
        }
        const r = await deps.claude.call({ prompt, content, schema: photoGuessSchema, check: checkPhotoGuess, traceId: runId });
        if (r.ok) {
          await repos.photoGuesses.saveGuess({
            id: crypto.randomUUID(),
            photoId: photo.id,
            familyId,
            description: r.value.description.trim(),
            model: r.meta.model,
            promptVersion: prompt.version,
            createdAt: deps.now().getTime(),
          });
          summary.saved++;
        } else if (NOT_ATTEMPTED.has(r.reason)) {
          await repos.photoGuesses.release(familyId, [photo.id], prompt.version);
        } else {
          await repos.photoGuesses.markFailed(familyId, [photo.id], prompt.version);
          summary.failed++;
        }
      } catch {
        // 一枚の失敗で残りを止めない。記録は取ったまま残り、古くなったら取り直す
        summary.failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PHOTO_GUESS_CALL_CONCURRENCY, photos.length) }, worker));
  // 時間の予算を超えて呼ばなかった写真は、次の回に回す（試した回数に数えない）
  await repos.photoGuesses.release(familyId, queue.map((p) => p.id), prompt.version);
}

async function createBatch(deps: Deps, familyId: string, photos: PhotoRow[], runId: string, summary: PhotoGuessSummary): Promise<void> {
  const { repos } = deps;
  const prompt = PROMPTS.photo_guess;
  const items: { customId: string; content: ClaudeContentPart[] }[] = [];
  /** 画像が見つからない、または大きすぎる写真 */
  const missing: string[] = [];
  const leftover: string[] = [];
  let total = 0;
  for (const photo of photos) {
    if (total >= PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS) {
      leftover.push(photo.id);
      continue;
    }
    const content = await photoContent(deps, photo);
    if (!content) {
      missing.push(photo.id);
      continue;
    }
    const size = content.reduce((n, p) => n + (p.type === "image" ? p.base64.length : 0), 0);
    if (size > PHOTO_GUESS_MAX_IMAGE_BASE64_CHARS) {
      // 大きすぎる一枚は Batch に入れず失敗にする（ほかの写真を道連れにしない）
      missing.push(photo.id);
      continue;
    }
    if (items.length > 0 && total + size > PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS) {
      leftover.push(photo.id);
      total = PHOTO_GUESS_BATCH_MAX_IMAGE_CHARS;
      continue;
    }
    total += size;
    items.push({ customId: photo.id, content });
  }
  // 載せきれなかった写真は、次の回に回す（試した回数に数えない）
  await repos.photoGuesses.release(familyId, leftover, prompt.version);
  await repos.photoGuesses.markFailed(familyId, missing, prompt.version);
  summary.failed += missing.length;
  if (items.length === 0) return;

  const ids = items.map((it) => it.customId);
  const r = await deps.claude.createBatch({ prompt, schema: photoGuessSchema, items, traceId: runId });
  if (!r.ok) {
    if (NOT_ATTEMPTED.has(r.reason)) await repos.photoGuesses.release(familyId, ids, prompt.version);
    else {
      await repos.photoGuesses.markFailed(familyId, ids, prompt.version);
      summary.failed += ids.length;
    }
    return;
  }
  await repos.photoGuesses.attachBatch(familyId, ids, prompt.version, r.value.batchId);
  summary.batchId = r.value.batchId;
}
