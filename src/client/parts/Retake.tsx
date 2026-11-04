// 「とりなおす」のボタンと、消せなかったときの一文（0050）。「送りました」のすぐ下に置く。
// 押したら押せない形（aria-disabled）で消すのを待つ。消えたら onRetaken（呼ぶ側がその場で録り始める）。
// 消せなかったら一文を出し、録り始めない。自動で送り直さない。
import { useEffect, useRef, useState, type RefObject } from "react";
import { runRetake, useRetake } from "../lib/retake";
import { useScreen } from "../lib/screen";

type Props = {
  /** この場所（今日の答えは "answer"、返事は返した先の語りの ID） */
  at: string;
  /** 消えたとき。current は、その間にほかの操作をしていないか（していなければ録り始める） */
  onRetaken: (current: boolean) => void;
  /** 消せずにボタンが消えたとき、操作の位置を移す先（「はなす」「へんじ」） */
  focusAfter: RefObject<HTMLElement | null>;
};

export function Retake({ at, onRetaken, focusAfter }: Props) {
  const retake = useRetake();
  const { elder, w } = useScreen();
  const [deleting, setDeleting] = useState(false);
  const busy = useRef(false);
  const slot = retake?.slot?.at === at ? retake.slot : null;
  const failed = !!slot?.failed;
  // 押したボタンが一文に替わって位置が失われたら、次の主なボタンへ（ほかの場所の位置は奪わない）
  const pressed = useRef<string | null>(null);
  const failedId = slot?.failed ? slot.id : null;
  useEffect(() => {
    if (!failedId || pressed.current !== failedId) return;
    pressed.current = null;
    if (document.activeElement === null || document.activeElement === document.body) focusAfter.current?.focus();
  }, [failedId, focusAfter]);
  if (!retake || !slot) return null;
  if (failed) return <p role="alert" className={elder ? "retake-failed" : "sub retake-failed"}>{w.retakeFailed}</p>;

  const press = () => {
    if (busy.current) return;
    busy.current = true;
    pressed.current = slot.id;
    setDeleting(true);
    void runRetake(retake, slot.id, onRetaken).finally(() => {
      busy.current = false;
      setDeleting(false);
    });
  };
  return (
    <button type="button" className="aux retake" aria-disabled={deleting ? "true" : undefined} onClick={press}>
      {w.retake}
    </button>
  );
}
