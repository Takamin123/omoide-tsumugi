// 実機での確かめ（開発用の /check ページ）の、クライアントとサーバーの約束。
// 家族向けの機能ではない。サーバーの入り口は本番（APP_ENV=production）では閉じ、合言葉の確認も通す。
// 結果は docs/decisions/ に「なぜその仕様にしたか」として残す。
import { z } from "zod";

/** 語りの受け取り（POST /api/narrations）が受け付ける録音の形式。確かめページも同じ判定を見せる */
export const AUDIO_TYPE_PATTERN = /^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,+-]*)?$/i;

/** 確かめで呼んでよいモデル（比べるために、本番で使うもの以外も少しだけ許す） */
export const checkTranscribeModels = ["gpt-transcribe", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "whisper-1"] as const;

/**
 * OpenAI に送ってよい欄の名前。値は人が画面で入れる（公式ドキュメントの書き方を実機で試すため）。
 * file と model はサーバーが入れるので、ここには含めない。
 */
export const checkTranscribeFieldNames = [
  "language",
  // gpt-transcribe は単数の language の代わりに languages[] を使う（両方は送らない）。公式: https://developers.openai.com/api/docs/guides/speech-to-text
  "languages[]",
  "prompt",
  "response_format",
  "temperature",
  "timestamp_granularities[]",
  "include[]",
  // multipart では keywords[] を一語ごとに繰り返すのが公式の形。括弧なしの keywords は受け付けられるかを試すために残す
  "keywords",
  "keywords[]",
  "chunking_strategy",
] as const;

export const checkTranscribeParamsSchema = z.object({
  model: z.enum(checkTranscribeModels),
  /** 同じ名前を何度も送れるように、[名前, 値] の並びで持つ（timestamp_granularities[] など） */
  fields: z
    .array(z.tuple([z.enum(checkTranscribeFieldNames), z.string().max(2_000)]))
    .max(30),
});
export type CheckTranscribeParams = z.infer<typeof checkTranscribeParamsSchema>;

/** POST /api/check/transcribe の応答（200）。OpenAI が失敗しても 200 で、その status と本文をそのまま見せる */
export type CheckTranscribeResult = {
  /** OpenAI の HTTP status。届かなかったときは null */
  status: number | null;
  /** 届かなかったときの種類（timeout など） */
  networkError: string | null;
  elapsedMs: number;
  /** 実際に送ったもの（本番の文字起こしと同じファイル名の付け方を使う） */
  sent: { model: string; fileName: string; contentType: string; size: number; fields: [string, string][] };
  /** 語りの受け取り（POST /api/narrations）が、この形式を受け付けるか */
  acceptedByNarrations: boolean;
  /** 応答の本文。JSON なら解釈したもの、そうでなければ文字列（長すぎるものは切る） */
  body: unknown;
};
