// 録音の操作。押すと始まり、もう一度押すと止まる。止めたら Blob と長さを onBlob に渡す。
// 送るのは呼ぶ側（録音済みファイルと同じ関数を通すため）。ごく短い録音は何も言わずに捨てる。
import { useEffect, useRef, useState } from "react";
import { formatElapsed } from "../lib/pure";
import { createMicStart } from "../lib/mic-start";
import { canRecord, MAX_RECORDING_MS, MIN_RECORDING_MS, startRecording, type Recording } from "../lib/recorder";
import { setRecordingNow } from "./PlayVoice";

type RecorderOptions = {
  onBlob: (blob: Blob, durationMs: number) => void;
  onMicError: () => void;
  /** 録音が始まったとき（マイクが使えると分かったとき） */
  onStarted?: () => void;
  /** 止めたが、ごく短い（または空の）録音で送らなかったとき */
  onDiscarded?: () => void;
};

/** 録音の状態と操作。並べ方は呼ぶ側（ReplyBox）が決める */
export function useRecorder({ onBlob, onMicError, onStarted, onDiscarded }: RecorderOptions) {
  const rec = useRef<Recording | null>(null);
  /** マイクの許可を待つ試み。待っている間の二度押しを無視し、やめた試みの結果は捨てる（lib/mic-start.ts） */
  const [mic] = useState(() => createMicStart(startRecording));
  const unmounted = useRef(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  /** マイクの許可を待っている間（押した後、録り始める前）。画面に出すための写し（二度押しの判定は mic.pending） */
  const [waiting, setWaiting] = useState(false);

  // 画面を離れたら録音を止めて捨てる
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      // 許可を待っている途中なら、後で許可が出てもマイクを閉じる
      mic.cancel();
      if (rec.current) setRecordingNow(false);
      rec.current?.cancel();
      rec.current = null;
    };
  }, [mic]);

  async function start() {
    if (mic.pending || rec.current) return;
    if (!canRecord()) return onMicError();
    setWaiting(true);
    const result = await mic.start();
    // 待っている間に画面を離れた・やめた（"stale"。マイクは mic が閉じた）。やめた後の押し直しは、もう次の試みが持っている
    if (result.kind === "stale" || result.kind === "busy") return;
    setWaiting(false);
    if (result.kind === "failed") return onMicError();
    rec.current = result.rec;
    // 流れている声を止め、録っている間は流さない
    setRecordingNow(true);
    onStarted?.();
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
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
      else onDiscarded?.();
    } catch {
      // 空の録音は送らない
      onDiscarded?.();
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

  /** 録っている途中でやめる（送らずに捨てる）。入力欄を閉じたとき */
  function cancel() {
    mic.cancel();
    setWaiting(false);
    const r = rec.current;
    rec.current = null;
    setStartedAt(null);
    if (!r) return;
    setRecordingNow(false);
    r.cancel();
  }

  const recording = startedAt !== null;
  return {
    recording,
    /** マイクの許可を待っている間（押した後、録り始める前）。この間は押しても何も起きない */
    starting: waiting && !recording,
    /** 経過時間の表示（"0:12"）。録っていなければ null */
    elapsed: recording ? formatElapsed(now - startedAt) : null,
    toggle: () => void (recording ? stop() : start()),
    cancel,
  };
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
