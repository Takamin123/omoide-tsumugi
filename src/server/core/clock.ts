// 「今日」と時間帯。日本時間で決める（docs/decisions/0009）。
// 家族の「今日」は、毎朝の処理（日本時間 3:00）で替わる。0:00–2:59 は前の日の続き（0056）。
import type { Clock, TimeSlot } from "../../shared/api";
import type { AppConfig, FamilyRow } from "./ports";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の YYYY-MM-DD */
export function jstDate(now: Date): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 一日が替わる時刻（日本時間）。wrangler.jsonc の Cron（UTC 18:00 = 日本時間 3:00）と合わせる */
export const DAY_START_HOUR_JST = 3;
const DAY_START_MS = DAY_START_HOUR_JST * 60 * 60 * 1000;

/** 家族の「今日」（YYYY-MM-DD）。日本時間 3:00 で替わる。0:00–2:59 は前の日 */
export function appDate(now: Date): string {
  return jstDate(new Date(now.getTime() - DAY_START_MS));
}

/** 日本時間の時刻から時間帯を決める: 3:00–10:59 朝、11:00–16:59 昼、17:00–翌 2:59 夜 */
export function jstSlot(now: Date): TimeSlot {
  const hour = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  if (hour < DAY_START_HOUR_JST) return "night";
  if (hour < 11) return "morning";
  if (hour < 17) return "noon";
  return "night";
}

/** その家族の今の時計。時計を持たない家族は本当の日本時間から作る（日付は 3:00 で替わる）。 */
export function familyClock(family: Pick<FamilyRow, "clock">, now: Date): Clock {
  return family.clock ?? { date: appDate(now), slot: jstSlot(now) };
}

/** その家族の「今日」 */
export function familyToday(family: Pick<FamilyRow, "clock">, now: Date): string {
  return familyClock(family, now).date;
}

/** 次の時間帯。夜の次は翌日の朝。 */
export function nextClock(clock: Clock): Clock {
  if (clock.slot === "morning") return { date: clock.date, slot: "noon" };
  if (clock.slot === "noon") return { date: clock.date, slot: "night" };
  return { date: addDays(clock.date, 1), slot: "morning" };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * デモの時計を進められるか。判断はここだけで行う。
 * 本番ではデモの家族だけ。手元・プレビューではどの家族も。
 */
export function canAdvanceClock(config: Pick<AppConfig, "appEnv">, family: Pick<FamilyRow, "isDemo">): boolean {
  return config.appEnv !== "production" || family.isDemo;
}
