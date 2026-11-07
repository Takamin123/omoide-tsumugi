// デモの操作。family.canAdvanceClock が真のときだけ出す。
import { useCallback, useState } from "react";
import type { Clock } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatClock } from "../lib/pure";
import { AUDIO_FILE_ACCEPT } from "../lib/voice";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";

/**
 * 進めている間の状態は App が持つ（useAdvanceClock）。帯はタブごとに描き直されるので、ここに持つと、翌朝への待ちの間に
 * タブを替えたときに「進めています」が消え、ボタンがまた押せるようになる（0062）
 */
export type DemoProps = {
  clock: Clock;
  /** 翌朝へ進めている間（毎朝の処理が走り、1 分以上かかる） */
  advancing: boolean;
  error: string | null;
  onAdvance: (from: string) => void;
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
  const [error, setError] = useState<string | null>(null);
  /** from は押したときの画面の日付。読み直しまで待ってから押せるようにする（古い日付のまま二度押しさせない） */
  const onAdvance = useCallback(
    async (from: string) => {
      setAdvancing(true);
      setError(null);
      try {
        await api.advanceClock(from);
        await onAdvanced();
      } catch (e) {
        setError(errorText(e));
      } finally {
        setAdvancing(false);
      }
    },
    [onAdvanced],
  );
  return { advancing, error, onAdvance };
}

export function DemoBar({ clock, advancing, error, onAdvance, onAudioFile, audioDisabled }: Props) {
  return (
    <section className="demo stack" aria-label={words.demo.label}>
      <div className="row">
        <span>
          {words.demo.label}: {words.demo.clock(formatClock(clock))}
        </span>
        <button type="button" onClick={() => onAdvance(clock.date)} disabled={advancing}>
          {words.demo.advance}
        </button>
      </div>
      {advancing && <span role="status">{words.demo.advancing}</span>}
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
