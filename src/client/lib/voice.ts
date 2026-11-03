// 声の語りを送る、ただ一つの流れ。マイクの録音も、デモで選んだ録音済みファイルもここを通る。
// 分岐は入力（Blob をどこから得たか）だけにする。
import type { Narration } from "../../shared/api";
import { api } from "./api";
import { validDurationMs } from "./pure";

/**
 * 録音済みファイルを選ぶ <input> の accept。マイクの録音と同じ流れに乗せるファイルの入口はすべてこれを使う。
 * iPhone の Safari は "audio/*" だけだと、ファイルアプリに保存したボイスメモ（.m4a）を選べないことがあるので、拡張子も並べる。
 */
export const AUDIO_FILE_ACCEPT = "audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm";

/** 語りを送る先。話した人は送らない（サーバーが端末の人に決める。0036） */
export type VoiceTarget = {
  photoId: string;
  entranceId: string | null;
  replyToId: string | null;
};

/**
 * requestId は語り一つごとに呼ぶ側が作り、送り直すときは同じものを渡す（サーバーが一つにまとめる）。
 */
export async function sendVoice(
  audio: Blob,
  target: VoiceTarget,
  requestId: string,
  durationMs: number | null = null,
): Promise<Narration> {
  const { narration } = await api.sendNarration(
    { kind: "voice", text: null, ...target, requestId, durationMs: validDurationMs(durationMs) },
    audio,
  );
  return narration;
}

/**
 * 録音済みファイルの長さを、ブラウザに読ませて測る（ミリ秒）。測れなければ null。
 * 長さは「（13 秒）」の表示にだけ使うので、測れなくても送る。
 */
export function audioDurationMs(blob: Blob, timeoutMs = 3_000): Promise<number | null> {
  if (typeof Audio === "undefined" || typeof URL.createObjectURL !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = "metadata";
    const done = (v: number | null) => {
      clearTimeout(timer);
      a.onloadedmetadata = null;
      a.onerror = null;
      a.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    a.onloadedmetadata = () => done(validDurationMs(a.duration * 1000));
    a.onerror = () => done(null);
    a.src = url;
  });
}

export async function sendText(text: string, target: VoiceTarget, requestId: string): Promise<Narration> {
  const { narration } = await api.sendNarration({ kind: "text", text, ...target, requestId });
  return narration;
}
