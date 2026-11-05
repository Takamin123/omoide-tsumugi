// 「録り直す」のボタンと、前の声を消せなかったときの一文（0050）。「送りました」のすぐ下に、横いっぱいに置く。
// 押したらすぐ録り直す（呼ぶ側が録り始める）。前の声はここでは消さない。録り直した声が送れたときに lib/retake.ts が消す。
// 見た目は白地にオレンジの枠と文字、マイクの印。大きさは「話す」「書く」（家族は「声で話す」「文字で書く」）と同じ（人間の決定、2026-11-04）。
import { useRetake } from "../lib/retake";
import { useScreen } from "../lib/screen";
import { MicIcon } from "./MicIcon";

type Props = {
  /** この場所（今日の答えは "answer"、返事は返した先の語りの ID） */
  at: string;
  /** 押したとき。呼ぶ側がその場で録り始める */
  onRetake: () => void;
};

export function Retake({ at, onRetake }: Props) {
  const retake = useRetake();
  const { elder, w } = useScreen();
  const slot = retake?.slot?.at === at ? retake.slot : null;
  if (!retake || !slot || slot.retaking || slot.replacing) return null;
  if (slot.failed) return <p role="alert" className={elder ? "retake-failed" : "sub retake-failed"}>{w.retakeFailed}</p>;
  return (
    <button
      type="button"
      className="retake"
      onClick={() => {
        retake.start(at);
        onRetake();
      }}
    >
      <MicIcon />
      {w.retake}
    </button>
  );
}
