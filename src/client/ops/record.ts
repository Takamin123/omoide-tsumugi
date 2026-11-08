// 開発用（運営）の記録の画面（/ops/record）の、画面に頼らない部分。鍵の持ち方、印の範囲の切り分け、見る軸の URL と並べ方。
import type { OpsEntrance, OpsFamilyRecord, OpsMusubi, OpsNarration, OpsPhoto } from "../../shared/ops";

/** 運営の鍵を持つ sessionStorage の名前。そのタブを閉じれば消える。localStorage には置かない */
export const OPS_KEY_STORAGE = "omoide_ops_key";

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const session = (): KeyStore | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};

export function loadOpsKey(store: KeyStore | null = session()): string | null {
  try {
    const v = store?.getItem(OPS_KEY_STORAGE) ?? null;
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveOpsKey(key: string | null, store: KeyStore | null = session()): void {
  try {
    if (key) store?.setItem(OPS_KEY_STORAGE, key);
    else store?.removeItem(OPS_KEY_STORAGE);
  } catch {
    // 保存できなくても、画面の状態には持っている（そのタブの間だけ使える）
  }
}

export type MarkedSegment = { text: string; uncertain: boolean };

/**
 * 整えた文字を、聞き間違いの印の範囲で切り分ける。範囲が壊れていたら（重なり・はみ出し・逆順）全体を印なしで返し、broken を立てる。
 * 運営向けなので生の範囲をそのまま見せる（家族の画面では「……」に置き換わる）
 */
export function splitMarked(
  text: string,
  spans: readonly { start: number; end: number }[] | null,
): { segments: MarkedSegment[]; broken: boolean } {
  if (!spans || spans.length === 0) return { segments: [{ text, uncertain: false }], broken: spans === null };
  const out: MarkedSegment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < pos || s.end <= s.start || s.end > text.length) {
      return { segments: [{ text, uncertain: false }], broken: true };
    }
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), uncertain: false });
    out.push({ text: text.slice(s.start, s.end), uncertain: true });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), uncertain: false });
  return { segments: out, broken: false };
}

/** 材料にした語りの本文の頭に出す字数（印の［? ?］は数えない）。超えたら開くと全文 */
export const NARRATION_HEAD_CHARS = 60;

/** 切り分けた本文の先頭 limit 字だけを返す。印の区切りは保つ */
export function headSegments(segments: readonly MarkedSegment[], limit: number): { segments: MarkedSegment[]; truncated: boolean } {
  const out: MarkedSegment[] = [];
  let left = limit;
  for (const s of segments) {
    if (left <= 0) return { segments: out, truncated: true };
    // サロゲートペアを割らないよう、コードポイントで数える
    const chars = Array.from(s.text);
    if (chars.length > left) {
      out.push({ text: chars.slice(0, left).join(""), uncertain: s.uncertain });
      return { segments: out, truncated: true };
    }
    out.push(s);
    left -= chars.length;
  }
  return { segments: out, truncated: false };
}

export type InputNarration = { id: string; narration: OpsNarration | null; isQuote: boolean };

/** 入り口の材料にした語りの ID を、同じ記録の語りと結ぶ。一覧にない ID（ほかの家族、消えた語り）は narration が null */
export function inputNarrations(
  ids: readonly string[] | null,
  narrations: readonly OpsNarration[],
  quoteNarrationId: string | null,
): InputNarration[] {
  const byId = new Map(narrations.map((n) => [n.id, n]));
  return (ids ?? []).map((id) => ({ id, narration: byId.get(id) ?? null, isQuote: id === quoteNarrationId }));
}

/** ページの中の語りの欄のアンカー */
export const narrationAnchor = (id: string) => `narration-${id}`;

export type RecordLoad =
  | { ok: true; record: OpsFamilyRecord }
  | { ok: false; reason: "unauthorized" | "not_found" | "failed" };

/** 記録を読む。鍵は Authorization に付ける（URL に載せない） */
export function fetchRecord(familyId: string, key: string, fetchImpl: typeof fetch = fetch): Promise<RecordLoad> {
  return fetchRecordAt(`/api/ops/families/${encodeURIComponent(familyId)}/record`, key, fetchImpl);
}

/**
 * 審査員の道（/demo/<鍵>/record）で記録を読む。鍵は案内の鍵。家族はサーバーが台本の家族に決める（家族の ID は送らない）。
 * 失敗はすべて 404（0062 の追記）
 */
export function fetchGuideRecord(guideKey: string, fetchImpl: typeof fetch = fetch): Promise<RecordLoad> {
  return fetchRecordAt("/api/demo/guide/record", guideKey, fetchImpl);
}

async function fetchRecordAt(url: string, key: string, fetchImpl: typeof fetch): Promise<RecordLoad> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${key}` },
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (res.status === 401) return { ok: false, reason: "unauthorized" };
  if (res.status === 404) return { ok: false, reason: "not_found" };
  if (!res.ok) return { ok: false, reason: "failed" };
  try {
    return { ok: true, record: (await res.json()) as OpsFamilyRecord };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

// ---- 見る軸と URL（再読み込みで保つ。鍵は載せない） ----

export type OpsView = "date" | "photo";

export type OpsRoute = { family: string; view: OpsView; date: string | null; photo: string | null };

/** `?family=…&view=photo&photo=…&date=…` を読む。view を省くと日付と人で見る */
export function parseRoute(search: string): OpsRoute {
  const q = new URLSearchParams(search);
  return {
    family: q.get("family") ?? "",
    view: q.get("view") === "photo" ? "photo" : "date",
    date: q.get("date") || null,
    photo: q.get("photo") || null,
  };
}

/** URL の検索部分を作る（何も選んでいなければ空）。日付と人で見るときは view を省く。見ていない軸の選択も残す（切り替えて戻ったときに同じ所を開く） */
export function routeSearch(r: OpsRoute): string {
  const q = new URLSearchParams();
  // 審査員の道では家族の ID を持たない（空）ので、載せない
  if (r.family) q.set("family", r.family);
  if (r.view === "photo") q.set("view", "photo");
  if (r.date) q.set("date", r.date);
  if (r.photo) q.set("photo", r.photo);
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ---- 日付と人で見る ----

/** 入り口のある日付（古い順） */
export function entranceDates(entrances: readonly OpsEntrance[]): string[] {
  return [...new Set(entrances.map((e) => e.forDate))].sort();
}

/** 求めた日付があればそれ、なければいちばん新しい日付 */
export function pickDate(dates: readonly string[], wanted: string | null): string | null {
  if (wanted && dates.includes(wanted)) return wanted;
  return dates.at(-1) ?? null;
}

/** その日の入り口を、家族の並び順で */
export function entrancesOn(record: Pick<OpsFamilyRecord, "entrances" | "members">, date: string): OpsEntrance[] {
  const order = new Map(record.members.map((m, i) => [m.id, i]));
  return record.entrances
    .filter((e) => e.forDate === date)
    .sort((a, b) => (order.get(a.memberId) ?? 1e9) - (order.get(b.memberId) ?? 1e9) || a.createdAt - b.createdAt);
}

/** その入り口に返ってきた語り（entranceId が同じもの）。古い順 */
export function repliesTo(narrations: readonly OpsNarration[], entranceId: string): OpsNarration[] {
  return narrations.filter((n) => n.entranceId === entranceId).sort((a, b) => a.createdAt - b.createdAt);
}

// ---- 写真で見る ----

export type PhotoUsage = { entrances: number; narrations: number };

export function photoUsage(record: Pick<OpsFamilyRecord, "photos" | "entrances" | "narrations">): Map<string, PhotoUsage> {
  const m = new Map<string, PhotoUsage>(record.photos.map((p) => [p.id, { entrances: 0, narrations: 0 }]));
  for (const e of record.entrances) {
    const u = m.get(e.photoId);
    if (u) u.entrances++;
  }
  for (const n of record.narrations) {
    const u = m.get(n.photoId);
    if (u) u.narrations++;
  }
  return m;
}

/** 求めた写真があればそれ、なければ入り口か語りのある最初の写真、それもなければ最初の写真 */
export function pickPhoto(
  photos: readonly OpsPhoto[],
  usage: ReadonlyMap<string, PhotoUsage>,
  wanted: string | null,
): string | null {
  if (wanted && photos.some((p) => p.id === wanted)) return wanted;
  const used = photos.find((p) => {
    const u = usage.get(p.id);
    return u !== undefined && u.entrances + u.narrations > 0;
  });
  return (used ?? photos[0])?.id ?? null;
}

export type PhotoEvent = { type: "entrance"; entrance: OpsEntrance } | { type: "narration"; narration: OpsNarration };

/** 写真がたどったこと。入り口と語りを、日付（forDate）、作られた時刻の順に並べる。同じ時刻なら入り口が先 */
export function photoEvents(record: Pick<OpsFamilyRecord, "entrances" | "narrations">, photoId: string): PhotoEvent[] {
  const key = (ev: PhotoEvent) => (ev.type === "entrance" ? ev.entrance : ev.narration);
  const evs: PhotoEvent[] = [
    ...record.entrances.filter((e) => e.photoId === photoId).map((entrance) => ({ type: "entrance" as const, entrance })),
    ...record.narrations.filter((n) => n.photoId === photoId).map((narration) => ({ type: "narration" as const, narration })),
  ];
  return evs.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x.forDate !== y.forDate) return x.forDate < y.forDate ? -1 : 1;
    if (x.createdAt !== y.createdAt) return x.createdAt - y.createdAt;
    return a.type === b.type ? 0 : a.type === "entrance" ? -1 : 1;
  });
}

// ---- 入り口 v3 の推測（0046） ----

/** 入り口 v3 の列があるか。v2 と固定の入り口は両方 null */
export const isV3Entrance = (e: OpsEntrance): boolean => e.guessed.receiverPresent !== null || e.guessed.inputMusubiIds !== null;

/** 受け取る人がその場にいたか（Claude の推測）。null（v2・固定）は null */
export function presentLabel(v: OpsEntrance["guessed"]["receiverPresent"]): string | null {
  if (v === null) return null;
  return v === "yes" ? "いた" : v === "no" ? "いなかった" : "分からない";
}

/** 写真の番号（写真で見る、の一覧の並び。1 から） */
export function photoNumbers(photos: readonly OpsPhoto[]): Map<string, number> {
  return new Map(photos.map((p, i) => [p.id, i + 1]));
}

export type PassedMusubi = { id: string; musubi: OpsMusubi | null };

/** 入り口に渡したむすびの ID を、同じ記録のむすびと結ぶ。記録にない ID は musubi が null */
export function passedMusubi(ids: readonly string[] | null, musubi: readonly OpsMusubi[]): PassedMusubi[] {
  const byId = new Map(musubi.map((m) => [m.id, m]));
  return (ids ?? []).map((id) => ({ id, musubi: byId.get(id) ?? null }));
}

/** むすびを作ったのは誰か（0048）。家族の手は「この写真に追加する」 */
export const musubiOriginLabel = (c: OpsMusubi["createdBy"]): string => (c === "family" ? "家族がつないだ" : "機械の推測");

export const musubiStatusLabel = (s: OpsMusubi["photos"][number]["status"]): string =>
  s === "confirmed" ? "家族が確かめた" : s === "rejected" ? "家族が外した" : "推測";

// ---- 書き方 ----

/** 2026-11-05 → 11/5 */
export function monthDay(forDate: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(forDate);
  return m ? `${Number(m[1])}/${Number(m[2])}` : forDate;
}

const jstParts = (ms: number) => {
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return { mo: d.getUTCMonth() + 1, da: d.getUTCDate(), h: d.getUTCHours(), mi: String(d.getUTCMinutes()).padStart(2, "0") };
};

/** 日本時間の 9:02 */
export function jstTime(ms: number): string {
  const p = jstParts(ms);
  return `${p.h}:${p.mi}`;
}

/** 日本時間の 11/4 9:02 */
export function jstDateTime(ms: number): string {
  const p = jstParts(ms);
  return `${p.mo}/${p.da} ${p.h}:${p.mi}`;
}

/** 撮影日（1987-08-16、1987:08:16 …）→ 1987年8月16日。読めなければそのまま */
export function takenDate(takenAt: string): string {
  const m = /^(\d{4})[-:/](\d{2})[-:/](\d{2})/.exec(takenAt);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : takenAt;
}

/** 声の長さ。12800 → 12.8 秒 */
export function seconds(ms: number): string {
  return `${(Math.round(ms / 100) / 10).toFixed(1)} 秒`;
}

/** 長い ID の頭と尻だけ。b91383a1-…-c970766c → b913…766c */
export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
