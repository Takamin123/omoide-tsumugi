// 声の語りを送る、ただ一つの流れ。マイクの録音も、デモで選んだ録音済みファイルもここを通る。
// 分岐は入力（Blob をどこから得たか）だけにする。
import type { Narration } from "../../shared/api";
import { api } from "./api";

/**
 * 録音済みファイルを選ぶ <input> の accept。マイクの録音と同じ流れに乗せるファイルの入口はすべてこれを使う。
 * iPhone の Safari は "audio/*" だけだと、ファイルアプリに保存したボイスメモ（.m4a）を選べないことがあるので、拡張子も並べる。
 */
export const AUDIO_FILE_ACCEPT = "audio/*,.m4a,.mp3,.wav,.aac,.ogg,.webm";

export type VoiceTarget = {
  speakerMemberId: string;
  photoId: string;
  entranceId: string | null;
  replyToId: string | null;
};

/**
 * requestId は語り一つごとに呼ぶ側が作り、送り直すときは同じものを渡す（サーバーが一つにまとめる）。
 */
export async function sendVoice(audio: Blob, target: VoiceTarget, requestId: string): Promise<Narration> {
  const { narration } = await api.sendNarration({ kind: "voice", text: null, ...target, requestId }, audio);
  return narration;
}

export async function sendText(text: string, target: VoiceTarget, requestId: string): Promise<Narration> {
  const { narration } = await api.sendNarration({ kind: "text", text, ...target, requestId });
  return narration;
}
