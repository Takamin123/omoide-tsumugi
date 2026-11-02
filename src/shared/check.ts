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

// ---- 問いかけの読み上げ（POST /api/check/speech）。0019 の試し。毎朝の処理の仕組みではない ----
// 公式（2026-11-03 に確かめた）:
//   https://developers.openai.com/api/docs/guides/text-to-speech
//   https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
// tts-1、tts-1-hd、gpt-4o-mini-tts は 2027-01-06 に終了する（0019 の見直す条件）。

/** 確かめで呼んでよい読み上げのモデル */
export const checkSpeechModels = ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"] as const;

/**
 * 公式の声の一覧（13）。ballad、verse、marin、cedar は tts-1 / tts-1-hd では使えない。
 * 組み合わせの検査はしない（OpenAI が断るかどうかも確かめのうちなので、そのまま送る）。
 */
export const checkSpeechVoices = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
] as const;

/** tts-1 / tts-1-hd で使えない声（画面で印を付けるため） */
export const checkSpeechVoicesNotForTts1: readonly (typeof checkSpeechVoices)[number][] = ["ballad", "verse", "marin", "cedar"];

/** 返してもらう形式。pcm はヘッダーのない生の音で、ブラウザの audio で鳴らせないので入れない */
export const checkSpeechFormats = ["mp3", "aac", "opus", "wav", "flac"] as const;

/** 公式の上限は 4096 字。問いかけは 60 字以内（0017）なので、確かめでも短く抑える */
export const CHECK_SPEECH_MAX_INPUT = 500;
export const CHECK_SPEECH_MAX_INSTRUCTIONS = 1_000;

export const checkSpeechParamsSchema = z.object({
  model: z.enum(checkSpeechModels),
  input: z.string().trim().min(1).max(CHECK_SPEECH_MAX_INPUT),
  voice: z.enum(checkSpeechVoices),
  /** 空なら送らない（tts-1 / tts-1-hd は instructions を受けない） */
  instructions: z.string().max(CHECK_SPEECH_MAX_INSTRUCTIONS),
  /** 公式の範囲は 0.25〜4.0 */
  speed: z.number().min(0.25).max(4),
  response_format: z.enum(checkSpeechFormats),
});
export type CheckSpeechParams = z.infer<typeof checkSpeechParamsSchema>;

/** 応答の種類を表すヘッダー。audio なら本文は音声、failure なら CheckSpeechFailure の JSON */
export const CHECK_SPEECH_RESULT_HEADER = "x-check-speech";
/** OpenAI が応答の頭を返すまでの時間（ミリ秒）。音声のときだけ付ける */
export const CHECK_SPEECH_ELAPSED_HEADER = "x-check-elapsed-ms";

/** POST /api/check/speech で、OpenAI が音声を返さなかったとき（200 で返す）。status と本文をそのまま見せる */
export type CheckSpeechFailure = {
  /** OpenAI の HTTP status。届かなかったときは null */
  status: number | null;
  networkError: string | null;
  elapsedMs: number;
  body: unknown;
};
