// 録音（MediaRecorder）。画面からは start / stop だけを使う。
// 録った Blob は、録音済みファイルと同じ送る関数（voice.ts の sendVoice）に渡す。

/** 録音の形式の候補。先頭から順に、ブラウザが対応するものを使う（確かめページも同じ一覧を見せる） */
export const preferredTypes = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"] as const;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return preferredTypes.find((t) => MediaRecorder.isTypeSupported(t));
}

export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export type Recording = { stop: () => Promise<{ blob: Blob; durationMs: number }>; cancel: () => void };

/** これより短い録音は押し間違いとして送らない。これより長くなったら止める */
export const MIN_RECORDING_MS = 1_000;
export const MAX_RECORDING_MS = 5 * 60_000;

/** 録音を始める。マイクの許可がなければ失敗する */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const release = () => stream.getTracks().forEach((t) => t.stop());
  recorder.start();
  const startedAt = Date.now();
  return {
    stop: () =>
      new Promise<{ blob: Blob; durationMs: number }>((resolve, reject) => {
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
          if (blob.size === 0) reject(new Error("empty"));
          else resolve({ blob, durationMs: Date.now() - startedAt });
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = release;
      if (recorder.state !== "inactive") recorder.stop();
      else release();
    },
  };
}
