// 録音の操作。押すと始まり、もう一度押すと止まる。止めたら Blob を onBlob に渡す。
// 送るのは呼ぶ側（録音済みファイルと同じ関数を通すため）。ごく短い録音は何も言わずに捨てる。
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "../lib/pure";
import { canRecord, MAX_RECORDING_MS, MIN_RECORDING_MS, startRecording, type Recording } from "../lib/recorder";

type Props = {
  onBlob: (blob: Blob) => void;
  onMicError: () => void;
  /** 録音が始まったとき（マイクが使えると分かったとき） */
  onStarted?: () => void;
  disabled?: boolean;
  startLabel: string;
  stopLabel: string;
  variant: "mic" | "primary";
};

export function VoiceRecorder({ onBlob, onMicError, onStarted, disabled, startLabel, stopLabel, variant }: Props) {
  const rec = useRef<Recording | null>(null);
  /** マイクの許可を待っている間の二度押しを無視する */
  const starting = useRef(false);
  const unmounted = useRef(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const recording = startedAt !== null;

  // 画面を離れたら録音を止めて捨てる
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      rec.current?.cancel();
      rec.current = null;
    };
  }, []);

  async function start() {
    if (starting.current || rec.current) return;
    if (!canRecord()) return onMicError();
    starting.current = true;
    try {
      const r = await startRecording();
      if (unmounted.current) {
        // 待っている間に画面を離れた。マイクをすぐ閉じる
        r.cancel();
        return;
      }
      rec.current = r;
      onStarted?.();
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
    } catch {
      onMicError();
    } finally {
      starting.current = false;
    }
  }

  async function stop() {
    const r = rec.current;
    rec.current = null;
    setStartedAt(null);
    if (!r) return;
    try {
      const { blob, durationMs } = await r.stop();
      if (durationMs >= MIN_RECORDING_MS) onBlob(blob);
    } catch {
      // 空の録音は送らない
    }
  }

  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n - startedAt >= MAX_RECORDING_MS) void stopRef.current();
    }, 500);
    return () => clearInterval(t);
  }, [startedAt]);

  const className = variant === "mic" ? `mic${recording ? " recording" : ""}` : "primary";
  return (
    <div className="stack" style={{ alignItems: variant === "mic" ? "center" : "stretch" }}>
      <button
        type="button"
        className={className}
        onClick={() => void (recording ? stop() : start())}
        disabled={disabled && !recording}
        aria-pressed={recording}
      >
        {recording ? stopLabel : startLabel}
      </button>
      {recording && <p className="elapsed">{formatElapsed(now - startedAt)}</p>}
    </div>
  );
}
