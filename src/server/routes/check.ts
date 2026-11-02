// 実機での確かめ（開発用の /check ページ）の入り口。家族向けの機能ではない。
// 本番（APP_ENV=production）では閉じる（404）。合言葉の確認も、ほかの入り口と同じく通す（PUBLIC_ROUTES には入れない）。
// 録音の形式を確かめる道具なので、形式の検査はせずに OpenAI へ送り、語りの受け取りが受け付けるかは別に返す。
import { Hono } from "hono";
import { checkTranscribeParamsSchema, type CheckTranscribeResult } from "../../shared/check";
import type { AppEnv } from "./env";
import { checkContentLength, fail, parseJsonString, parseWith, readForm } from "./http";
import { isAcceptableAudio, MAX_AUDIO_BYTES } from "./narrations";

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
});
