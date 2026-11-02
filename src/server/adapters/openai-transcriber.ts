// OpenAI の文字起こし。fetch だけを使うので、Workers でも VPS でも同じものを使える。
// 応答は外から来るデータとして zod で検証する。エラーの本文や入力はログに出さない。
import { z } from "zod";
import type { Transcriber, TranscribeProbe } from "../core/ports";

export const TRANSCRIBE_MODEL = "gpt-transcribe";
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const TIMEOUT_MS = 60_000;

/** keywords[] の件数の上限。公式に上限の記述がないので控えめにする（0013） */
export const MAX_TRANSCRIBE_KEYWORDS = 20;
// keywords に <、>、改行が入ると、API がリクエスト全体を断る
const FORBIDDEN_KEYWORD_CHARS = /[<>\r\n]/;

/** 送る keywords。空・禁止文字を含む語を除き、重複をまとめ、上限で切る。 */
export function transcribeKeywords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of words) {
    if (FORBIDDEN_KEYWORD_CHARS.test(raw)) continue;
    const w = raw.trim();
    if (!w || out.includes(w)) continue;
    out.push(w);
    if (out.length >= MAX_TRANSCRIBE_KEYWORDS) break;
  }
  return out;
}

const responseSchema = z.object({ text: z.string() });

/** 方言の地域を、文字起こしの手がかりとして prompt に入れる。家族には見せない。 */
export function transcribePrompt(dialectRegion: string | null): string {
  const base = "家族が写真を見ながら思い出を語っています。";
  return dialectRegion ? `${base}話し手は${dialectRegion}の方言で話します。方言の言い回しはそのまま書き起こしてください。` : base;
}

export function createOpenAITranscriber(apiKey: string, fetchImpl: typeof fetch = fetch): Transcriber {
  return {
    async transcribe({ audio, dialectRegion, keywords }) {
      const sendKeywords = transcribeKeywords(keywords);
      // 時間切れ・429・5xx は一度だけやり直す
      for (let attempt = 0; attempt < 2; attempt++) {
        const form = new FormData();
        form.append("file", audio, fileName(audio.type));
        form.append("model", TRANSCRIBE_MODEL);
        // gpt-transcribe の形。whisper 世代の language とは両方送らない（0013）
        form.append("languages[]", "ja");
        form.append("response_format", "json");
        form.append("prompt", transcribePrompt(dialectRegion));
        for (const k of sendKeywords) form.append("keywords[]", k);
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

/** 送るファイルの名前。OpenAI は名前の拡張子で形式を見るので、録音の形式から決める（確かめの入り口も同じものを使う） */
export function fileName(type: string): string {
  if (type.includes("webm")) return "audio.webm";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "audio.m4a";
  if (type.includes("mpeg") || type.includes("mp3")) return "audio.mp3";
  if (type.includes("wav")) return "audio.wav";
  if (type.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

const PROBE_BODY_MAX_CHARS = 20_000;

/**
 * 開発用の確かめ（POST /api/check/transcribe）のための、生の呼び出し。
 * 人が入れた欄をそのまま送り、OpenAI の status と本文を検証せずに返す。再試行はしない。
 * 家族の流れでは使わない（家族の流れは createOpenAITranscriber で、応答を検証する）。
 */
export function createOpenAITranscribeProbe(apiKey: string, fetchImpl: typeof fetch = fetch): TranscribeProbe {
  return {
    async probe({ audio, model, fields }) {
      const name = fileName(audio.type);
      const form = new FormData();
      form.append("file", audio, name);
      form.append("model", model);
      for (const [k, v] of fields) form.append(k, v);
      const started = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return { status: null, networkError: timedOut ? "timeout" : "network", elapsedMs: Date.now() - started, fileName: name, body: null };
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        return { status: res.status, networkError: "body_read", elapsedMs: Date.now() - started, fileName: name, body: null };
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, PROBE_BODY_MAX_CHARS);
      }
      return { status: res.status, networkError: null, elapsedMs: Date.now() - started, fileName: name, body };
    },
  };
}
