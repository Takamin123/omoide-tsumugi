// アプリが裏から前に戻ったときに、今日の入り口と家族の語りを静かに読み直す（0051）。
// 読み直すのは、最後に読んだ時から家族の一日が替わったとき（日本時間 3:00）と、裏にいた時間が RESUME_REFRESH_AFTER_MS 以上のとき。
// 話している・書いている途中は読み直さない（途中のものを壊さない。終わった後に改めて読まない）。前に出ている間の定期的な読み直しはしない。
import { useEffect, useRef } from "react";

/** 日付が同じでも、裏にいた時間がこれ以上なら読み直す（ほかの家族の新しい語り・返事） */
export const RESUME_REFRESH_AFTER_MS = 10 * 60_000;

/** 家族の「今日」は日本時間 3:00 で替わる（サーバーの core/clock の appDate と同じ。0056） */
const JST_OFFSET_MS = 9 * 60 * 60_000;
const DAY_START_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** 家族の一日の番号（比べるだけに使う）。日本時間 3:00 で替わる。家族の「今日」はサーバーが決めるので、クライアントは実時間で比べれば足りる */
export function jstDay(t: number): number {
  return Math.floor((t + JST_OFFSET_MS - DAY_START_MS) / DAY_MS);
}

export type ResumeState = {
  now: number;
  /** 最後に入り口を読めた時刻。まだ読めていなければ null（開いたときの読み込みに任せる） */
  loadedAt: number | null;
  /** 裏に回った時刻。分からなければ null */
  hiddenAt: number | null;
  /** 話している・書いている途中 */
  busy: boolean;
};

/** 前に戻ったときに読み直すか */
export function shouldRefreshOnResume({ now, loadedAt, hiddenAt, busy }: ResumeState): boolean {
  if (busy || loadedAt === null) return false;
  if (jstDay(now) !== jstDay(loadedAt)) return true;
  return hiddenAt !== null && now - hiddenAt >= RESUME_REFRESH_AFTER_MS;
}

/** 話している・書いている途中か（録音中・マイク待ち・文字の欄・返事の欄・取り直し・送っている間） */
export function homeBusy(s: {
  composing: boolean;
  dockComposing: boolean;
  openReplyId: string | null;
  retaking: boolean;
  sending: boolean;
}): boolean {
  return s.composing || s.dockComposing || s.openReplyId !== null || s.retaking || s.sending;
}

/**
 * 静かな読み直し。届いたものだけを渡す（読めなかったものは渡さない＝前のものを残す。失敗の文も出さない）。
 * 「読み込み中」に戻す値（undefined）は渡さない
 */
export async function refreshQuietly<E, F>(
  load: { entrance: () => Promise<E>; feed: () => Promise<F> },
  apply: { entrance: (e: E) => void; feed: (f: F) => void },
): Promise<void> {
  await Promise.all([
    load.entrance().then(apply.entrance, () => {}),
    load.feed().then(apply.feed, () => {}),
  ]);
}

type Listens = Pick<EventTarget, "addEventListener" | "removeEventListener">;
type Doc = Listens & { visibilityState: string };

/**
 * 裏に回った時刻を覚え、前に戻ったら onResume(hiddenAt) を呼ぶ。
 * visibilitychange（visible）と pageshow（persisted。戻るで復元されたとき）。続けて来ても一度だけ呼ぶ。片付けを返す
 */
export function watchResume(doc: Doc, win: Listens, now: () => number, onResume: (hiddenAt: number | null) => void): () => void {
  // 裏で開かれたときは、開いた時から裏にいたことにする
  let hidden = doc.visibilityState === "hidden";
  let hiddenAt: number | null = hidden ? now() : null;
  const hide = () => {
    if (!hidden) hiddenAt = now();
    hidden = true;
  };
  const show = () => {
    if (!hidden) return;
    hidden = false;
    onResume(hiddenAt);
  };
  const onVisibility = () => (doc.visibilityState === "hidden" ? hide() : show());
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) show();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pagehide", hide);
  win.addEventListener("pageshow", onPageShow);
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", hide);
    win.removeEventListener("pageshow", onPageShow);
  };
}

/** 前に戻ったときに、決まりに合えば refresh を呼ぶ。busy と loadedAt は呼ばれた時点の値を読む */
export function useResumeRefresh(opts: { busy: boolean; loadedAt: () => number | null; refresh: () => void }): void {
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(
    () =>
      watchResume(document, window, Date.now, (hiddenAt) => {
        const { busy, loadedAt, refresh } = latest.current;
        if (shouldRefreshOnResume({ now: Date.now(), loadedAt: loadedAt(), hiddenAt, busy })) refresh();
      }),
    [],
  );
}
