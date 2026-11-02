// 開発用（運営）の記録の画面（/ops/record）の、画面に頼らない部分。鍵の持ち方と、印の範囲の切り分け。
import type { OpsFamilyRecord } from "../../shared/ops";

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

export type RecordLoad =
  | { ok: true; record: OpsFamilyRecord }
  | { ok: false; reason: "unauthorized" | "not_found" | "failed" };

/** 記録を読む。鍵は Authorization に付ける（URL に載せない） */
export async function fetchRecord(familyId: string, key: string, fetchImpl: typeof fetch = fetch): Promise<RecordLoad> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/ops/families/${encodeURIComponent(familyId)}/record`, {
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
