// 開発用の確かめページ（/check）から、問いかけの読み上げ（POST /api/check/speech、0019 の試し）を呼ぶ。
// 送るのは画面で入れた例文と設定だけ。家族のデータは送らない。
import {
  CHECK_SPEECH_ELAPSED_HEADER,
  CHECK_SPEECH_RESULT_HEADER,
  type CheckSpeechFailure,
  type CheckSpeechParams,
} from "../../shared/check";
import type { TtsRow } from "./report";

export type SpeechOutcome = { row: TtsRow; audio: Blob | null };

/** 作って受け取り終わるまでを測る。音声なら Blob を返す。届かなかったときだけ投げる */
export async function requestSpeech(
  params: CheckSpeechParams,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => performance.now(),
): Promise<SpeechOutcome> {
  const started = now();
  const res = await fetchImpl("/api/check/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
    credentials: "same-origin",
  });
  const kind = res.headers.get(CHECK_SPEECH_RESULT_HEADER);
  if (res.ok && kind === "audio") {
    const audio = await res.blob();
    const elapsed = Number(res.headers.get(CHECK_SPEECH_ELAPSED_HEADER));
    return {
      audio,
      row: {
        params,
        httpStatus: res.status,
        ok: true,
        openaiStatus: 200,
        networkError: null,
        serverMs: Number.isFinite(elapsed) ? elapsed : null,
        totalMs: Math.round(now() - started),
        size: audio.size,
        contentType: res.headers.get("content-type"),
        body: null,
      },
    };
  }
  let body: unknown = await res.text();
  try {
    body = JSON.parse(body as string);
  } catch {
    // 文字のまま
  }
  const failure = res.ok && kind === "failure" ? (body as CheckSpeechFailure) : null;
  return {
    audio: null,
    row: {
      params,
      httpStatus: res.status,
      ok: false,
      openaiStatus: failure?.status ?? null,
      networkError: failure?.networkError ?? null,
      serverMs: failure?.elapsedMs ?? null,
      totalMs: Math.round(now() - started),
      size: null,
      contentType: null,
      body: failure ? failure.body : body,
    },
  };
}
