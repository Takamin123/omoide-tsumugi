import { familyToday } from "./clock";
import { ensureMorningEntrance } from "./entrance-claude";
import { runPhotoGuesses } from "./photo-guess";
import type { AppDeps } from "./ports";

/**
 * Claude の入り口を試してよい時間（処理の始まりから）。過ぎたら残りの人は固定の入り口にする。
 * 一人分の呼び出しは最長で 2 分ほど（60 秒 × 2 回と待ち）かかるので、全体を 10 分の内側に収めるための余白をとる
 */
export const MORNING_CLAUDE_BUDGET_MS = 7 * 60_000;

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
}

/**
 * 毎朝の処理（家族一人ひとりの今日の入り口づくり）。
 * Cron（scheduled）とデモの時計のボタンは、どちらもこの関数を呼ぶ。処理を二つに分けない。
 *
 * - familyId を渡したらその家族だけ。渡さなければ、時計を持たない家族すべて（時計を持つ家族の朝はボタンで来る。0009）
 * - 「今日」は家族ごとに決める: 時計があればその日付、なければ now の日本時間の日付
 * - 家族ごとに、入り口づくりの前に写真の説明づくりを一回進める（runPhotoGuesses。失敗しても入り口づくりは続ける）
 * - 一人ひとりに、その日の入り口がなければ Claude の入り口を試し、だめなら固定の入り口を作る（ensureMorningEntrance）
 *   キーがない、または MORNING_CLAUDE_BUDGET_MS を過ぎたら、Claude を呼ばずに固定の入り口
 * - 失敗した人だけ飛ばして続ける。全員が失敗したときだけ、全体を失敗にする
 */
export async function runMorning(
  deps: AppDeps,
  now: Date = new Date(),
  opts: { familyId?: string } = {},
): Promise<MorningSummary> {
  const runId = crypto.randomUUID();
  const started = Date.now();
  const familyIds = opts.familyId ? [opts.familyId] : await deps.repos.families.listIdsWithoutClock();
  const summary: MorningSummary = { runId, created: 0, existing: 0, byClaude: 0, fallbacks: [], noPhoto: 0, failed: [] };
  let attempted = 0;

  for (const familyId of familyIds) {
    const family = await deps.repos.families.get(familyId);
    if (!family) continue;
    // 写真の説明（推測）づくりを先に進める: 終わった Batch の回収と、まだ説明のない写真。投げない
    await runPhotoGuesses(deps, familyId);
    const forDate = familyToday(family, now);
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
      ms: Date.now() - started,
    }),
  );
  if (attempted > 0 && summary.failed.length === attempted) throw new Error("morning_all_failed");
  return summary;
}
