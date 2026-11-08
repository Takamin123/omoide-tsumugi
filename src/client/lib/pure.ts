// 画面から分けた、純粋な小さな関数。DOM に頼らない（test/client/ から Node で確かめる）。
import { DEMO_GUIDE_KEY_PATTERN, MAX_VOICE_DURATION_MS, type Clock } from "../../shared/api";
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

/** 写真の場所の表示: "三重県伊勢市あたり"。なければ null（0047） */
export function formatPlace(place: string | null | undefined): string | null {
  return place ? words.placeLabel(place) : null;
}

/** 録音の経過時間の表示: "0:07" */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 測った録音の長さ（ミリ秒）を、送ってよい値にする。測れていない・ありえない値は null */
export function validDurationMs(ms: number | null | undefined): number | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  const r = Math.round(ms);
  return r > MAX_VOICE_DURATION_MS ? null : r;
}

/** 録音の長さを、画面に出す分と秒にする（1 秒未満は 1 秒）。分からなければ null */
export function voiceLength(ms: number | null | undefined): { minutes: number; seconds: number } | null {
  const v = validDurationMs(ms);
  if (v === null) return null;
  const total = Math.max(1, Math.round(v / 1000));
  return { minutes: Math.floor(total / 60), seconds: total % 60 };
}

/**
 * 招待リンク。LINE で押されたとき、LINE の中の画面ではなくいつものブラウザで開くよう openExternalBrowser=1 を付ける（0055）。
 * Android の LINE の中の画面ではマイクが使えず、入った記録も LINE の中にしか残らないため。ほかのアプリでは何もしない
 */
export function inviteUrl(origin: string, token: string): string {
  return `${origin}/join/${token}?openExternalBrowser=1`;
}

/** Android の LINE の中の画面か（マイクが使えない。0055）。iPhone の LINE は使えるので含めない */
export function isAndroidLineInApp(userAgent: string): boolean {
  return /\bLine\//i.test(userAgent) && /Android/i.test(userAgent);
}

/** 招待リンクの道すじから合言葉を取り出す。"/join/<token>" でなければ null */
export function tokenFromJoinPath(pathname: string): string | null {
  const m = /^\/join\/([A-Za-z0-9_-]{20,100})\/?$/.exec(pathname);
  return m ? (m[1] ?? null) : null;
}

/** 審査員の案内の道すじから鍵を取り出す。"/demo/<鍵>"、"/demo/<鍵>/start"、"/demo/<鍵>/record" でなければ null（ほかの知らない道と同じ扱いになる。0062） */
export function keyFromDemoGuidePath(pathname: string): string | null {
  const m = /^\/demo\/([^/]+)(?:\/start|\/record)?\/?$/.exec(pathname);
  return m && DEMO_GUIDE_KEY_PATTERN.test(m[1]!) ? m[1]! : null;
}

/** 審査員が新しい家族を作る画面か */
export const isDemoGuideStartPath = (pathname: string) => /^\/demo\/[^/]+\/start\/?$/.test(pathname);

/** 審査員が Claude の記録を見る画面か（運営の記録の画面を、台本の家族だけ・読み取りだけで開く。0062 の追記） */
export const isDemoGuideRecordPath = (pathname: string) => /^\/demo\/[^/]+\/record\/?$/.test(pathname);

/** 写真の登録の結果を数える */
export type UploadTally = { total: number; done: number; added: number; duplicate: number; unreadable: number; failed: number };
export const emptyTally = (total: number): UploadTally => ({ total, done: 0, added: 0, duplicate: 0, unreadable: 0, failed: 0 });
export function tallyOne(t: UploadTally, outcome: "added" | "duplicate" | "unreadable" | "failed"): UploadTally {
  return { ...t, done: t.done + 1, [outcome]: t[outcome] + 1 };
}

/** 家族の様子を読んだ後に出す画面 */
export type ScreenKind = "first-person" | "no-session" | "elder" | "family-setup" | "photos" | "home";

/**
 * 端末の人（サーバーの view.me）と道から、出す画面を決める（0036）。
 * - me がない: 最初の人のリンク。家族にまだ誰もいなければ自分を入れる。もう誰かいれば、このリンクでは入れない
 * - 祖父母の画面の人は、どの道でも祖父母の画面（/family、/photos を出さない）
 */
export function screenFor(me: { role: "elder" | "family" } | null, memberCount: number, path: string): ScreenKind {
  if (!me) return memberCount > 0 ? "no-session" : "first-person";
  if (me.role === "elder") return "elder";
  if (path === "/family") return "family-setup";
  if (path === "/photos") return "photos";
  return "home";
}

/** 今日の入り口の「声で」「文字で」を置く所（0034） */
export type AnswerPlace = "dock" | "flow" | "none";

/**
 * - 入り口がない（読み込み中・写真がない）: 置かない
 * - 答えた後: 問いかけの下の流れに戻す（もう一度答えられる。下の段には留めない）
 * - ほかの入力欄（語りへの返事）が開いている間: タブと同じく描かない
 * - それ以外: スクロールする欄の外の、タブのすぐ上の段（文字の欄・録音もそこで開く）
 * - docked が偽（家族の画面）: 入り口があればいつも問いかけのカードの中（0059。段は祖父母の画面だけ）
 */
export function answerPlace(hasEntrance: boolean, answered: boolean, otherComposing: boolean, docked = true): AnswerPlace {
  if (!hasEntrance) return "none";
  // 段に留めない画面（家族の画面）は、いつも問いかけのカードの中（0059）
  if (!docked) return "flow";
  if (answered) return "flow";
  if (otherComposing) return "none";
  return "dock";
}
