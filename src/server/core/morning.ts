import type { AppDeps } from "./ports";

/**
 * 毎朝の処理（家族一人ひとりの今日の入り口づくり）。
 * Cron（scheduled）とデモ用のボタンは、どちらもこの関数を呼ぶ。処理を二つに分けない。
 * 中身はまだない。
 */
export async function runMorning(_deps: AppDeps, _now: Date = new Date()): Promise<void> {
  // TODO: 入り口づくり。家族全員を一度に回すときは、1回の呼び出しで送れる外部リクエストの数の上限に注意する
}
