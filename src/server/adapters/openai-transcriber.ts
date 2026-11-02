// OpenAI の文字起こし。fetch だけを使うので、Workers でも VPS でも同じものを使える。
// 応答は外から来るデータとして zod で検証する。エラーの本文や入力はログに出さない。
import { z } from "zod";
import type { Transcriber } from "../core/ports";

export const TRANSCRIBE_MODEL = "gpt-transcribe";
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 60_000;

const responseSchema = z.object({ text: z.string() });

/** 方言の地域を、文字起こしの手がかりとして prompt に入れる。家族には見せない。 */
export function transcribePrompt(dialectRegion: string | null): string {
  const base = "家族が写真を見ながら思い出を語っています。";
  return dialectRegion ? `${base}話し手は${dialectRegion}の方言で話します。方言の言い回しはそのまま書き起こしてください。` : base;
}

export function createOpenAITranscriber(apiKey: string, fetchImpl: typeof fetch = fetch): Transcriber {
  return {
    async transcribe({ audio, dialectRegion }) {
      // 時間切れ・429・5xx は一度だけやり直す
      for (let attempt = 0; attempt < 2; attempt++) {
        const form = new FormData();
        form.append("file", audio, fileName(audio.type));
        form.append("model", TRANSCRIBE_MODEL);
        form.append("language", "ja");
        form.append("response_format", "json");
        form.append("prompt", transcribePrompt(dialectRegion));
        let res: Response;
        try {
          res = await fetchImpl(ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
        } catch {
          if (attempt === 0) continue;
          return { ok: false, reason: "timeout" };
        }
        if (res.ok) {
          const parsed = responseSchema.safeParse(await res.json().catch(() => null));
          if (!parsed.success) return { ok: false, reason: "invalid_response" };
          return { ok: true, text: parsed.data.text.trim() };
        }
        await res.body?.cancel();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt === 0) {
          await new Promise((r) => setTimeout(r, 2_000));
          continue;
        }
        return { ok: false, reason: res.status === 429 ? "rate_limited" : res.status >= 500 ? "upstream" : "rejected" };
      }
      return { ok: false, reason: "upstream" };
    },
  };
}

function fileName(type: string): string {
  if (type.includes("webm")) return "audio.webm";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "audio.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio.mp3";
  if (type.includes("wav")) return "audio.wav";
  if (type.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}
