// 話者の頭文字の丸（0061）。話者名の行の中、名前の左に置く飾り（aria-hidden）。名前は必ず並べる（色だけで人を区別させない）
import { useContext } from "react";
import { InitialsContext } from "../lib/screen";

export function SpeakerMark({ memberId }: { memberId: string }) {
  const mark = useContext(InitialsContext).get(memberId);
  if (!mark) return null;
  return (
    <span className="initial" aria-hidden="true" style={{ background: mark.bg, color: mark.ink }}>
      {mark.char}
    </span>
  );
}
