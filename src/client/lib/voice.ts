// 声の語りを送る、ただ一つの流れ。マイクの録音も、デモで選んだ録音済みファイルもここを通る。
// 分岐は入力（Blob をどこから得たか）だけにする。
import type { Narration } from "../../shared/api";
import { api } from "./api";

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
