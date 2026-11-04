// 「とりなおす」の場所（0050）。画面に一つだけ。送った直後の声の語りにだけ置き、
// 送ってから RETAKE_SHOW_MS、次に「はなす」「かく」「へんじ」を押す、取り直しが始まる、のどれかで消える。
// 状態は手元だけ（画面を閉じれば消える）。Home が持ち、RetakeContext で部品に配る。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { RETAKE_SHOW_MS } from "../../shared/api";
import { api } from "./api";
import type { SentNarration } from "./useSender";

/** at: ボタンを出す場所（今日の答えは "answer"、返事は返した先の語りの ID）。id: 消す語り。failed: 消せなかった（一文を出す） */
export type RetakeSlot = { at: string; id: string; sentAt: number; failed: boolean };

export type Retake = {
  slot: RetakeSlot | null;
  /** 送れた語りを置く。声でなければ置かない（前の場所も消す） */
  offer: (at: string, sent: SentNarration) => void;
  fail: (id: string) => void;
  clear: () => void;
  /** 消し終えたときに、その語りがまだ今の場所か（その間にほかの操作をしていないか） */
  isCurrent: (id: string) => boolean;
};

export const RetakeContext = createContext<Retake | null>(null);
export const useRetake = () => useContext(RetakeContext);

/** 送れた語りから場所を作る。声のときだけ */
export function retakeSlotFor(at: string, sent: SentNarration): RetakeSlot | null {
  return sent.kind === "voice" ? { at, id: sent.id, sentAt: sent.at, failed: false } : null;
}

/** ボタンを出しておく残りの時間（ミリ秒。0 以下なら消す） */
export function retakeRemainingMs(slot: RetakeSlot, now: number): number {
  return RETAKE_SHOW_MS - (now - slot.sentAt);
}

/** Home が持つ場所。時間が来たら消す */
export function useRetakeSlot(): Retake {
  const [slot, setSlot] = useState<RetakeSlot | null>(null);
  const current = useRef<RetakeSlot | null>(null);
  current.current = slot;
  useEffect(() => {
    if (!slot) return;
    const t = setTimeout(() => setSlot((s) => (s === slot ? null : s)), Math.max(0, retakeRemainingMs(slot, Date.now())));
    return () => clearTimeout(t);
  }, [slot]);
  const offer = useCallback((at: string, sent: SentNarration) => setSlot(retakeSlotFor(at, sent)), []);
  const fail = useCallback((id: string) => setSlot((s) => (s && s.id === id ? { ...s, failed: true } : s)), []);
  const clear = useCallback(() => setSlot(null), []);
  const isCurrent = useCallback((id: string) => current.current?.id === id, []);
  return useMemo(() => ({ slot, offer, fail, clear, isCurrent }), [slot, offer, fail, clear, isCurrent]);
}

/**
 * 「とりなおす」を押した後の流れ。消す（自動で送り直さない）→ 消えたら場所を消して onRetaken(current)。
 * current は、消す間にほかの操作で場所が替わっていないか（替わっていれば録り始めない）。消せなければ一文に替える
 */
export async function runRetake(
  retake: Pick<Retake, "isCurrent" | "clear" | "fail">,
  id: string,
  onRetaken: (current: boolean) => void,
): Promise<void> {
  try {
    await api.deleteNarration(id);
  } catch {
    retake.fail(id);
    return;
  }
  const current = retake.isCurrent(id);
  if (current) retake.clear();
  onRetaken(current);
}
