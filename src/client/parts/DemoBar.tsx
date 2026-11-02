// デモの操作。family.canAdvanceClock が真のときだけ出す。
import { useState } from "react";
import type { Clock } from "../../shared/api";
import { api } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatClock } from "../lib/pure";
import { words } from "../words";
import { ErrorLine } from "./ErrorLine";

export type DemoProps = { clock: Clock; onAdvanced: () => void };

type Props = DemoProps & {
  /** 録音済みの音声を、マイクの代わりに送る。渡されたときだけ出す */
  onAudioFile?: (blob: Blob) => void;
  /** 送っている間は、録音済みの音声を選べなくする（マイクと同じ） */
  audioDisabled?: boolean;
};

export function DemoBar({ clock, onAdvanced, onAudioFile, audioDisabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function advance() {
    setBusy(true);
    setError(null);
    try {
      await api.advanceClock();
      onAdvanced();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="demo stack" aria-label={words.demo.label}>
      <div className="row">
        <span>
          {words.demo.label}: {words.demo.clock(formatClock(clock))}
        </span>
        <button type="button" onClick={advance} disabled={busy}>
          {words.demo.advance}
        </button>
      </div>
      {onAudioFile && (
        <label className="button" aria-disabled={audioDisabled}>
          {words.demo.sendFile}
          <input
            type="file"
            accept="audio/*"
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
