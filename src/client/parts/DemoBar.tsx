// デモの操作。family.canAdvanceClock が真のときだけ出す。
import { useCallback, useState } from "react";
import type { Clock, TimeSlot } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatClock } from "../lib/pure";
import { AUDIO_FILE_ACCEPT } from "../lib/voice";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";

/**
 * 進めている間の状態は App が持つ（useAdvanceClock）。帯はタブごとに描き直されるので、ここに持つと、夜から翌朝の待ちの間に
 * タブを替えたときに「進めています」が消え、ボタンがまた押せるようになる（0062）
 */
export type DemoProps = {
  clock: Clock;
  advancing: boolean;
  /** 夜から翌朝へ進めている間（毎朝の処理が走り、1 分以上かかる）。ほかはすぐ終わるので出さない */
  longWait: boolean;
  error: string | null;
  onAdvance: (from: TimeSlot) => void;
};

type Props = DemoProps & {
  /** 録音済みの音声を、マイクの代わりに送る。渡されたときだけ出す */
  onAudioFile?: (blob: Blob) => void;
  /** 送っている間は、録音済みの音声を選べなくする（マイクと同じ） */
  audioDisabled?: boolean;
};

/** デモの時計を進める。進めている間の状態は、タブを替えても失わないよう、画面の外（App）で持つ */
export function useAdvanceClock(onAdvanced: () => Promise<void>) {
  const [advancing, setAdvancing] = useState(false);
  const [longWait, setLongWait] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * from は押したときの時間帯。サーバーは毎朝の処理の前に時計を保存するので、待ちの間に読み直した時計（もう朝）では決められない。
   * 読み直しまで待ってから押せるようにする（古い時計のまま二度押しさせない）
   */
  const onAdvance = useCallback(
    async (from: TimeSlot) => {
      setAdvancing(true);
      setLongWait(from === "night");
      setError(null);
      try {
        await api.advanceClock();
        await onAdvanced();
      } catch (e) {
        setError(errorText(e));
      } finally {
        setAdvancing(false);
        setLongWait(false);
      }
    },
    [onAdvanced],
  );
  return { advancing, longWait, error, onAdvance };
}

export function DemoBar({ clock, advancing, longWait, error, onAdvance, onAudioFile, audioDisabled }: Props) {
  return (
    <section className="demo stack" aria-label={words.demo.label}>
      <div className="row">
        <span>
          {words.demo.label}: {words.demo.clock(formatClock(clock))}
        </span>
        <button type="button" onClick={() => onAdvance(clock.slot)} disabled={advancing}>
          {words.demo.advance}
        </button>
      </div>
      {longWait && <span role="status">{words.demo.advancing}</span>}
      {onAudioFile && (
        <label className="button" aria-disabled={audioDisabled}>
          {words.demo.sendFile}
          <input
            type="file"
            accept={AUDIO_FILE_ACCEPT}
            className="visually-hidden"
            disabled={audioDisabled}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onAudioFile(f);
            }}
          />
        </label>
      )}
      <ErrorLine text={error} />
    </section>
  );
}
