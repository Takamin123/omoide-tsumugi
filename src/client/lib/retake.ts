// 「録り直す」の場所（0050）。画面に一つだけ。送った直後の声の語りにだけ置き、
// 送ってから RETAKE_SHOW_MS、次に「話す」「書く」「返事」を押す、のどれかで消える。
// 押したらすぐ録り直す（前の声はまだ消さない）。録り直した声が送れたときに、前の語りを消す（人間の決定、2026-11-04。0050 の追記）。
// 録り直しをやめた・短すぎて捨てた・マイクが使えない・欄が閉じた → 前の声はそのまま。ボタンは表示の期限内ならまた出る。
// 状態は手元だけ（画面を閉じれば消える）。Home が持ち、RetakeContext で部品に配る。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RETAKE_SHOW_MS } from "../../shared/api";
import { api } from "./api";
import type { SentNarration } from "./useSender";

/**
 * at: ボタンを出す場所（今日の答えは "answer"、返事は返した先の語りの ID）。id: 録り直したら消す語り。
 * failed: 録り直した声は送れたが、前の語りを消せなかった（一文を出す。二つとも残る）。
 * retaking: 録り直している（ボタンを出さず、この間は期限で消さない。送れたら id を消す）。
 * replacing: 録り直した声が送れて、前の語りを消している間（ボタンを出さない。消せなかったときにボタンが一瞬出てから一文に替わらないように）
 */
export type RetakeSlot = { at: string; id: string; sentAt: number; failed: boolean; retaking: boolean; replacing: boolean };

export type Retake = {
  slot: RetakeSlot | null;
  /**
   * 送れた語りを置く。声でなければ置かない（前の場所も消す）。
   * その場所で録り直していたなら、前の語りを消す（自動で送り直さない。消せなければ新しい場所を一文に替える）。消し終えたら解決する
   */
  offer: (at: string, sent: SentNarration) => Promise<void>;
  /** 録り直しを始める（ボタンを押した） */
  start: (at: string) => void;
  /** 録り直しを送らずに終えた（やめた・短すぎて捨てた・マイクが使えない・欄が閉じた）。前の声はそのまま、ボタンを戻す */
  end: (at: string) => void;
  /** 次の操作でボタンを消す。録り直している間は消さない（送れたときに前を消すため） */
  clear: () => void;
};

export const RetakeContext = createContext<Retake | null>(null);
export const useRetake = () => useContext(RetakeContext);

/** 送れた語りから場所を作る。声のときだけ */
export function retakeSlotFor(at: string, sent: SentNarration): RetakeSlot | null {
  return sent.kind === "voice" ? { at, id: sent.id, sentAt: sent.at, failed: false, retaking: false, replacing: false } : null;
}

/** ボタンを出しておく残りの時間（ミリ秒。0 以下なら消す） */
export function retakeRemainingMs(slot: RetakeSlot, now: number): number {
  return RETAKE_SHOW_MS - (now - slot.sentAt);
}

/** 送れたときの次の場所と、消す前の語り（その場所で録り直していて、声が送れたときだけ） */
export function afterSent(prev: RetakeSlot | null, at: string, sent: SentNarration): { next: RetakeSlot | null; replaced: string | null } {
  const next = retakeSlotFor(at, sent);
  const replaced = next && prev?.retaking && prev.at === at && prev.id !== next.id ? prev.id : null;
  return { next: next && replaced ? { ...next, replacing: true } : next, replaced };
}

/** 前の語りを消す。一度だけ送り、送り直さない。done(消せたか) で新しい語りの場所を決める（消せなければ一文。二つとも残る） */
export async function deleteReplaced(replaced: string, done: (deleted: boolean) => void): Promise<void> {
  try {
    await api.deleteNarration(replaced);
  } catch {
    return done(false);
  }
  done(true);
}

/** Home が持つ場所。時間が来たら消す（録り直している間は消さない。やめたら、送ってからの時間で残りを決める） */
export function useRetakeSlot(): Retake {
  const [slot, setSlot] = useState<RetakeSlot | null>(null);
  const current = useRef<RetakeSlot | null>(null);
  current.current = slot;
  const put = useCallback((f: (s: RetakeSlot | null) => RetakeSlot | null) => {
    current.current = f(current.current);
    setSlot(current.current);
  }, []);
  useEffect(() => {
    if (!slot || slot.retaking) return;
    const t = setTimeout(() => put((s) => (s === slot ? null : s)), Math.max(0, retakeRemainingMs(slot, Date.now())));
    return () => clearTimeout(t);
  }, [slot, put]);
  const offer = useCallback(
    async (at: string, sent: SentNarration) => {
      const { next, replaced } = afterSent(current.current, at, sent);
      put(() => next);
      if (!replaced || !next) return;
      await deleteReplaced(replaced, (deleted) =>
        put((s) => (s && s.id === next.id ? { ...s, replacing: false, failed: !deleted } : s)),
      );
    },
    [put],
  );
  const start = useCallback((at: string) => put((s) => (s && s.at === at && !s.failed ? { ...s, retaking: true } : s)), [put]);
  const end = useCallback((at: string) => put((s) => (s && s.at === at && s.retaking ? { ...s, retaking: false } : s)), [put]);
  const clear = useCallback(() => put((s) => (s?.retaking ? s : null)), [put]);
  return useMemo(() => ({ slot, offer, start, end, clear }), [slot, offer, start, end, clear]);
}
