// 画面から分けた、純粋な小さな関数。DOM に頼らない（test/client/ から Node で確かめる）。
import type { Clock } from "../../shared/api";
import { words } from "../words";

/** 緯度経度を小数第 2 位（約 1 km）に丸める。生の値は送らない・保存しない。 */
export function roundCoord(value: number): number {
  const r = Math.round(value * 100) / 100;
  return r === 0 ? 0 : r; // -0 を 0 に
}

/** 緯度経度の組を丸める。片方でも数でなければ、位置なしとする。 */
export function roundLocation(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof latitude !== "number" || typeof longitude !== "number") return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude: roundCoord(latitude), longitude: roundCoord(longitude) };
}

/**
 * EXIF の日時の文字列（"2019:08:14 10:23:05"）を、API の形 "2019-08-14T10:23:05" にする。
 * 時差は付けない（日本時間とみなす）。読めない・ありえない値は null。
 */
export function parseExifDateTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m as unknown as [string, string, string, string, string, string, string];
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1800 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return null;
  // 2月30日のような日付を弾く
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1) return null;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

/** 長い辺が maxSide に収まる大きさ。小さい写真は拡大しない。 */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height };
  const scale = maxSide / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** バイト列を小文字の 16 進に。 */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** デモの時計の表示: "11月2日 朝" */
export function formatClock(clock: Clock): string {
  const [, m, d] = clock.date.split("-");
  return words.clockLabel(Number(m), Number(d), words.slots[clock.slot]);
}

/** 撮影日の表示: "2019年8月14日"。なければ null */
export function formatTakenDate(takenAt: string | null): string | null {
  if (!takenAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(takenAt);
  if (!m) return null;
  return words.dateLabel(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** 録音の経過時間の表示: "0:07" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 招待リンクの道すじから合言葉を取り出す。"/join/<token>" でなければ null */
export function tokenFromJoinPath(pathname: string): string | null {
  const m = /^\/join\/([A-Za-z0-9_-]{20,100})\/?$/.exec(pathname);
  return m ? (m[1] ?? null) : null;
}

/** 写真の登録の結果を数える */
export type UploadTally = { total: number; done: number; added: number; duplicate: number; unreadable: number; failed: number };
export const emptyTally = (total: number): UploadTally => ({ total, done: 0, added: 0, duplicate: 0, unreadable: 0, failed: 0 });
export function tallyOne(t: UploadTally, outcome: "added" | "duplicate" | "unreadable" | "failed"): UploadTally {
  return { ...t, done: t.done + 1, [outcome]: t[outcome] + 1 };
}
