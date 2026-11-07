import { familyToday } from "./clock";
import { ensureMorningEntrance } from "./entrance-claude";
import { MUSUBI_GUESS_BUDGET_MS, runMusubiGuess } from "./musubi-guess";
import { PHOTO_GUESS_TIME_BUDGET_MS, runPhotoGuesses, type PhotoGuessOptions } from "./photo-guess";
import type { AppDeps, EntranceRow } from "./ports";
import { ensureQuestionAudio } from "./question-speech";
import { RECORD_EXTRACTION_BUDGET_MS, runRecordExtraction } from "./record-extraction";

/**
 * Claude の入り口を試してよい時間（処理の始まりから）。過ぎたら残りの人は固定の入り口にする。
 * 一人分の呼び出しは最長で 2 分ほど（60 秒 × 2 回と待ち）かかるので、全体を 10 分の内側に収めるための余白をとる
 */
export const MORNING_CLAUDE_BUDGET_MS = 7 * 60_000;
/**
 * 入り口づくりの前段（写真の説明・記録の取り出し・むすびの推測）を始めてよい締め切り（処理の始まりから）。
 * 家族が多い朝や前段が遅い朝に、前段だけで MORNING_CLAUDE_BUDGET_MS を使い切り、後ろの家族の入り口が固定に倒れるのを避ける。
 * 入り口の予算から、Claude の入り口一人分の最長（60 秒 × 2 回と待ち）の余白をとる。ふだんの朝に、前段のせいで入り口が始めから固定に倒れないようにするため。
 * 締め切りの直前に始めた前段の一回の呼び出しが最長まで延びた朝は余白が尽きうる。残りの人が全員 Claude で作られることも保証しない（0044 の「前段の予算」）。
 * 前段は家族に見えず、残りは翌朝に回せる。入り口は家族が今日見る
 */
export const MORNING_PRELUDE_BUDGET_MS = MORNING_CLAUDE_BUDGET_MS - 2 * 60_000;
/**
 * 問いかけの読み上げの締め切り（処理の始まりから）。入り口を全員分作った後に音声を作り、これを過ぎる呼び出しや再試行はしない。
 * 全体を 10 分の内側に収める（0029）
 */
export const MORNING_SPEECH_DEADLINE_MS = 9 * 60_000;

export interface MorningSummary {
  runId: string;
  created: number;
  existing: number;
  /** 作った入り口のうち、Claude で作ったもの */
  byClaude: number;
  /** Claude の入り口を試さなかった・作れなかったので、固定の入り口にした人（理由の種類） */
  fallbacks: { memberId: string; reason: string; violation?: string }[];
  /** 写真がなく、入り口を作れなかった人 */
  noPhoto: number;
  failed: { memberId: string; kind: string }[];
  /** 問いかけの読み上げ。made: 作った数。failed: 作れなかった人（理由の種類）。入り口はどちらでも出す */
  speech: { made: number; failed: { memberId: string; reason: string }[] };
}

export interface MorningOptions {
  familyId?: string;
  /** 作る入り口の日付。渡さなければ家族の今日。デモの時計のボタンだけが翌朝の日付を渡す（時計を動かすのは処理の後。0062） */
  forDate?: string;
  /** 写真の説明づくりにそのまま渡す（budgetMs は前段の締め切りで切り詰める）。デモの初期化だけが渡す（0038） */
  photoGuess?: PhotoGuessOptions;
  /** 記録の取り出しの時間の予算（前段の締め切りで切り詰める）。デモの初期化だけが渡す（0038） */
  recordExtraction?: { budgetMs: number };
}

/**
 * 毎朝の処理（家族一人ひとりの今日の入り口づくり）。
 * Cron（scheduled）とデモの時計のボタンは、どちらもこの関数を呼ぶ。処理を二つに分けない。
 *
 * - familyId を渡したらその家族だけ。渡さなければ、時計を持たない家族すべて（時計を持つ家族の朝はボタンで来る。0009）
 * - 「今日」は家族ごとに決める: 時計があればその日付、なければ now の日本時間の日付
 * - 家族ごとに、入り口づくりの前に写真の説明づくりを一回進める（runPhotoGuesses。失敗しても入り口づくりは続ける）
 * - 続けて、未処理の語りから記録（人・場所・時期・出来事）を取り出す（runRecordExtraction。0039。投げない）
 * - 続けて、記録からむすび（同じ出来事の写真のまとまり）を推測する（runMusubiGuess。0044。投げない）
 * - 一人ひとりに、その日の入り口がなければ Claude の入り口を試し、だめなら固定の入り口を作る（ensureMorningEntrance）
 *   キーがない、または MORNING_CLAUDE_BUDGET_MS を過ぎたら、Claude を呼ばずに固定の入り口
 * - 全員の入り口を作った後に、今日の Claude の入り口に問いかけの読み上げの音声を作る（ensureQuestionAudio。0029）
 *   入り口づくりを先に済ませ、音声は MORNING_SPEECH_DEADLINE_MS まで。作れなくても入り口はそのまま
 * - 失敗した人だけ飛ばして続ける。全員が失敗したときだけ、全体を失敗にする
 * - 前段の三つ（写真の説明・記録の取り出し・むすびの推測）には、各自の予算を MORNING_PRELUDE_BUDGET_MS の残りで切り詰めて渡す。
 *   残りが 0 なら呼ばない（翌朝に回る）。後ろの家族の入り口を MORNING_CLAUDE_BUDGET_MS の内側で作るため
 * - photoGuess は写真の説明づくりにそのまま渡す。デモの初期化だけが { noBatch: true, budgetMs } を渡す（0038）。
 *   Cron と時計のボタンは渡さない（しきい値を超えたら Batch）
 * - recordExtraction も、デモの初期化だけが渡す（語り 12 本を順に取り出すので、既定の 60 秒では収まらないことがある。0038）
 */
export async function runMorning(
  deps: AppDeps,
  now: Date = new Date(),
  opts: MorningOptions = {},
): Promise<MorningSummary> {
  const runId = crypto.randomUUID();
  const started = Date.now();
  const preludeDeadline = started + MORNING_PRELUDE_BUDGET_MS;
  /** 前段の一つに渡す予算: 各自の予算と、前段の締め切りまでの残りの小さい方（0 なら呼ばない） */
  const preludeBudget = (own: number) => Math.max(0, Math.min(own, preludeDeadline - Date.now()));
  /** 前段の締め切りを過ぎて呼ばなかった前段の数（ログだけ） */
  let preludeSkipped = 0;
  const familyIds = opts.familyId ? [opts.familyId] : await deps.repos.families.listIdsWithoutClock();
  const summary: MorningSummary = {
    runId,
    created: 0,
    existing: 0,
    byClaude: 0,
    fallbacks: [],
    noPhoto: 0,
    failed: [],
    speech: { made: 0, failed: [] },
  };
  let attempted = 0;
  /** 音声を作る対象（今日の Claude の入り口で、音声がなく、まだ見せていないもの） */
  const speechTargets: EntranceRow[] = [];

  for (const familyId of familyIds) {
    const family = await deps.repos.families.get(familyId);
    if (!family) continue;
    // 写真の説明（推測）づくりを先に進める: 終わった Batch の回収と、まだ説明のない写真。投げない
    const photoBudget = preludeBudget(opts.photoGuess?.budgetMs ?? PHOTO_GUESS_TIME_BUDGET_MS);
    if (photoBudget > 0) await runPhotoGuesses(deps, familyId, { ...opts.photoGuess, budgetMs: photoBudget });
    else preludeSkipped++;
    // 語りからの記録の取り出し（本文のまま。投げない。予算を超えた語りは翌朝）
    const recordBudget = preludeBudget(opts.recordExtraction?.budgetMs ?? RECORD_EXTRACTION_BUDGET_MS);
    if (recordBudget > 0) await runRecordExtraction(deps, familyId, { budgetMs: recordBudget, traceId: runId });
    else preludeSkipped++;
    // 記録からのむすびの推測（guessed。記録の集合が前回と同じなら呼ばない。投げない）
    const musubiBudget = preludeBudget(MUSUBI_GUESS_BUDGET_MS);
    if (musubiBudget > 0) await runMusubiGuess(deps, familyId, { budgetMs: musubiBudget, traceId: runId });
    else preludeSkipped++;
    const forDate = opts.forDate ?? familyToday(family, now);
    const members = await deps.repos.members.list(familyId);
    for (const member of members) {
      attempted++;
      try {
        const useClaude = Date.now() - started < MORNING_CLAUDE_BUDGET_MS;
        const m = await ensureMorningEntrance(deps, family, member, forDate, now.getTime(), { useClaude, traceId: runId });
        const r = m.result;
        if (m.fallback && r?.created) {
          summary.fallbacks.push({ memberId: member.id, reason: m.fallback, ...(m.violation ? { violation: m.violation } : {}) });
        }
        const e = r?.entrance;
        if (e && e.kind === "claude" && e.questionAudioKey === null && e.shownAt === null) speechTargets.push(e);
        if (r === null) summary.noPhoto++;
        else if (r.created) {
          summary.created++;
          if (m.via === "claude") summary.byClaude++;
        } else summary.existing++;
      } catch (e) {
        summary.failed.push({ memberId: member.id, kind: e instanceof Error ? e.name : "unknown" });
      }
    }
  }

  // 問いかけの読み上げ（キーがなければ作らない）。入り口が全員分できてから
  if (deps.speaker) {
    const deadline = started + MORNING_SPEECH_DEADLINE_MS;
    for (const e of speechTargets) {
      try {
        const a = await ensureQuestionAudio(deps, e, { deadline, traceId: runId });
        if (a.status === "made") summary.speech.made++;
        else if (a.status === "failed") summary.speech.failed.push({ memberId: e.memberId, reason: a.reason });
      } catch (err) {
        summary.speech.failed.push({ memberId: e.memberId, reason: err instanceof Error ? err.name : "unknown" });
      }
    }
  }

  // ID と件数だけを出す（名前や本文は出さない）
  console.log(
    JSON.stringify({
      event: "morning_done",
      runId,
      families: familyIds.length,
      created: summary.created,
      byClaude: summary.byClaude,
      fallbacks: summary.fallbacks,
      existing: summary.existing,
      noPhoto: summary.noPhoto,
      failed: summary.failed,
      speech: summary.speech,
      preludeSkipped,
      ms: Date.now() - started,
    }),
  );
  if (attempted > 0 && summary.failed.length === attempted) throw new Error("morning_all_failed");
  return summary;
}
