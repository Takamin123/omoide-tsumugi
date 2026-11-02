// 実機での確かめ（開発用の /check ページ）の入り口。家族向けの機能ではない。
// 本番（APP_ENV=production）では閉じる（404）。合言葉の確認も、ほかの入り口と同じく通す（PUBLIC_ROUTES には入れない）。
// 録音の形式を確かめる道具なので、形式の検査はせずに OpenAI へ送り、語りの受け取りが受け付けるかは別に返す。
import { Hono } from "hono";
import {
  CHECK_SPEECH_ELAPSED_HEADER,
  CHECK_SPEECH_RESULT_HEADER,
  checkSpeechParamsSchema,
  checkTranscribeParamsSchema,
  type CheckSpeechFailure,
  type CheckTranscribeResult,
} from "../../shared/check";
import type { AppEnv } from "./env";
import { checkContentLength, fail, parseJsonString, parseWith, readForm, readJson } from "./http";
import { isAcceptableAudio, MAX_AUDIO_BYTES } from "./narrations";

/** 読み上げの確かめで受け取る JSON の大きさの上限（文 500 字と声への指示 1,000 字が入る） */
const MAX_SPEECH_REQUEST_BYTES = 16 * 1024;

export const check = new Hono<AppEnv>().post("/check/transcribe", async (c) => {
  const deps = c.get("deps");
  if (deps.config.appEnv === "production") return fail(c, "not_found");

  const size = checkContentLength(c, MAX_AUDIO_BYTES);
  if (size === "too_large") return fail(c, "too_large");
  if (size === "missing") return fail(c, "invalid_request");
  const form = await readForm(c);
  if (!form) return fail(c, "invalid_request");
  const params = parseWith(checkTranscribeParamsSchema, parseJsonString(form.get("params")));
  if (!params) return fail(c, "invalid_request");
  const audio = form.get("audio");
  if (!(audio instanceof File)) return fail(c, "invalid_request");
  if (audio.size > MAX_AUDIO_BYTES) return fail(c, "too_large");

  if (!deps.transcribeProbe) {
    console.error(JSON.stringify({ event: "check_transcribe", error: "not_configured" }));
    return fail(c, "internal");
  }

  const r = await deps.transcribeProbe.probe({ audio, model: params.model, fields: params.fields });
  // 本文・文字起こし・プロンプト・keywords の値は出さない。欄は名前だけ
  console.log(
    JSON.stringify({
      event: "check_transcribe",
      model: params.model,
      status: r.status,
      networkError: r.networkError,
      contentType: audio.type.slice(0, 100),
      size: audio.size,
      elapsedMs: r.elapsedMs,
      fields: params.fields.map(([name]) => name),
    }),
  );

  const result: CheckTranscribeResult = {
    status: r.status,
    networkError: r.networkError,
    elapsedMs: r.elapsedMs,
    sent: { model: params.model, fileName: r.fileName, contentType: audio.type, size: audio.size, fields: params.fields },
    acceptedByNarrations: isAcceptableAudio(audio),
    body: r.body,
  };
  return c.json(result);
})
// 問いかけの読み上げ（0019 の試し）。人が入れた文と設定をそのまま OpenAI に送り、音声をそのまま返す。家族のデータは読まない
.post("/check/speech", async (c) => {
  const deps = c.get("deps");
  if (deps.config.appEnv === "production") return fail(c, "not_found");

  const size = checkContentLength(c, MAX_SPEECH_REQUEST_BYTES);
  if (size === "too_large") return fail(c, "too_large");
  if (size === "missing") return fail(c, "invalid_request");
  const params = parseWith(checkSpeechParamsSchema, await readJson(c));
  if (!params) return fail(c, "invalid_request");

  if (!deps.speechProbe) {
    console.error(JSON.stringify({ event: "check_speech", error: "not_configured" }));
    return fail(c, "internal");
  }

  const instructions = params.instructions.trim() === "" ? null : params.instructions;
  const r = await deps.speechProbe.probe({
    model: params.model,
    input: params.input,
    voice: params.voice,
    instructions,
    speed: params.speed,
    responseFormat: params.response_format,
  });
  // 文と声への指示の中身は出さない。長さだけ
  console.log(
    JSON.stringify({
      event: "check_speech",
      model: params.model,
      voice: params.voice,
      responseFormat: params.response_format,
      speed: params.speed,
      inputChars: params.input.length,
      instructionsChars: instructions?.length ?? 0,
      status: r.status,
      networkError: r.ok ? null : r.networkError,
      elapsedMs: r.elapsedMs,
    }),
  );

  if (r.ok) {
    // メモリに載せず、そのまま流す
    return new Response(r.audio, {
      status: 200,
      headers: {
        "Content-Type": r.contentType,
        "Cache-Control": "no-store",
        [CHECK_SPEECH_RESULT_HEADER]: "audio",
        [CHECK_SPEECH_ELAPSED_HEADER]: String(r.elapsedMs),
      },
    });
  }
  const failure: CheckSpeechFailure = { status: r.status, networkError: r.networkError, elapsedMs: r.elapsedMs, body: r.body };
  c.header(CHECK_SPEECH_RESULT_HEADER, "failure");
  c.header("Cache-Control", "no-store");
  return c.json(failure);
});
