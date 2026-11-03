// 録音の操作。押すと始まり、もう一度押すと止まる。止めたら Blob と長さを onBlob に渡す。
// 送るのは呼ぶ側（録音済みファイルと同じ関数を通すため）。ごく短い録音は何も言わずに捨てる。
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "../lib/pure";
import { canRecord, MAX_RECORDING_MS, MIN_RECORDING_MS, startRecording, type Recording } from "../lib/recorder";
import { setRecordingNow } from "./PlayVoice";

type RecorderOptions = {
  onBlob: (blob: Blob, durationMs: number) => void;
  onMicError: () => void;
  /** 録音が始まったとき（マイクが使えると分かったとき） */
  onStarted?: () => void;
};

/** 録音の状態と操作。祖父母の画面は、これを使って自分で並べる */
export function useRecorder({ onBlob, onMicError, onStarted }: RecorderOptions) {
  const rec = useRef<Recording | null>(null);
  /** マイクの許可を待っている間の二度押しを無視する */
  const starting = useRef(false);
  const unmounted = useRef(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  // 画面を離れたら録音を止めて捨てる
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (rec.current) setRecordingNow(false);
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
      // 流れている声を止め、録っている間は流さない
      setRecordingNow(true);
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
    setRecordingNow(false);
    try {
      const { blob, durationMs } = await r.stop();
      if (durationMs >= MIN_RECORDING_MS) onBlob(blob, durationMs);
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

  const recording = startedAt !== null;
  return {
    recording,
    /** 経過時間の表示（"0:12"）。録っていなければ null */
    elapsed: recording ? formatElapsed(now - startedAt) : null,
    toggle: () => void (recording ? stop() : start()),
  };
}

type Props = RecorderOptions & {
  disabled?: boolean;
  startLabel: string;
  stopLabel: string;
};

/** 家族の画面の録音のボタン（横いっぱい）と経過時間 */
export function VoiceRecorder({ disabled, startLabel, stopLabel, ...options }: Props) {
  const r = useRecorder(options);
  return (
    <div className="stack">
      {r.elapsed !== null && <RecordingTime elapsed={r.elapsed} />}
      <button
        type="button"
        className={r.recording ? "primary stop" : "primary"}
        onClick={r.toggle}
        disabled={disabled && !r.recording}
        aria-pressed={r.recording}
      >
        {r.recording ? stopLabel : startLabel}
      </button>
    </div>
  );
}

/** 録っている間の印（赤い点。色だけに頼らず、経過時間の数字を並べる） */
export function RecordingTime({ elapsed }: { elapsed: string }) {
  return (
    <p className="elapsed" aria-live="off">
      <span className="rec-dot" aria-hidden="true" />
      {elapsed}
    </p>
  );
}
