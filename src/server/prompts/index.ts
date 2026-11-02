/// <reference path="./raw.d.ts" />
// 用途ごとの、今使うプロンプト。本文は <用途>/v<N>.md に置き、ビルドに文字列として取り込む（?raw）。
// - 版の文字列は "<用途>/v<N>"。入り口などと一緒に保存し、どの本文で作ったかを引けるようにする
// - 版を上げるときは新しいファイルを足し、ここの import を差し替える。古いファイルは消さない。一度使った版は書き換えない
// - 変えたら出し比べを通し、判断を docs/decisions に残す（implementation-policy 2）
import type { ClaudePrompt, ClaudePurpose } from "../core/ports";
import cleanTranscriptText from "./clean_transcript/v0.md?raw";
import entranceText from "./entrance/v0.md?raw";
import photoGuessText from "./photo_guess/v0.md?raw";

export const PROMPTS: Record<ClaudePurpose, ClaudePrompt> = {
  photo_guess: { purpose: "photo_guess", version: "photo_guess/v0", text: photoGuessText },
  clean_transcript: { purpose: "clean_transcript", version: "clean_transcript/v0", text: cleanTranscriptText },
  entrance: { purpose: "entrance", version: "entrance/v0", text: entranceText },
};
