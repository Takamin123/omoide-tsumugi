// OpenAI の読み上げ（/v1/audio/speech）。
// - createOpenAISpeaker: 本番の問いかけの読み上げ（毎朝の処理。0019、0029）。応答を検証し、再試行する
// - createOpenAISpeechProbe: 開発用の確かめ（POST /api/check/speech）。生のまま返す
// fetch だけを使うので、Workers でも VPS でも同じものを使える。入力の文や声への指示はログに出さない。
import type { SpeakResult, Speaker, SpeechFailure, SpeechProbe } from "../core/ports";
import { parseRetryAfter } from "./anthropic-claude";

const ENDPOINT = "https://api.openai.com/v1/audio/speech";
const TIMEOUT_MS = 60_000;
const PROBE_BODY_MAX_CHARS = 20_000;

/**
 * 人が入れた値をそのまま送り、音声ならストリームのまま返す。音声でなければ status と本文を検証せずに返す。再試行はしない。
 * 組み合わせ（tts-1 と instructions、tts-1 と marin など）も検査しない。OpenAI が断るかどうかを見るため。
 */
export function createOpenAISpeechProbe(apiKey: string, fetchImpl: typeof fetch = fetch): SpeechProbe {
  return {
    async probe({ model, input, voice, instructions, speed, responseFormat }) {
      const body: Record<string, unknown> = { model, input, voice };
      if (instructions != null) body.instructions = instructions;
      body.speed = speed;
      body.response_format = responseFormat;
      const started = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        return { ok: false, status: null, networkError: timedOut ? "timeout" : "network", elapsedMs: Date.now() - started, body: null };
      }
      const elapsedMs = Date.now() - started;
      const contentType = res.headers.get("content-type") ?? "";
      // 失敗の本文は JSON で来る。成功でも JSON なら音声ではないので、失敗として本文を見せる
      if (res.ok && res.body && !contentType.toLowerCase().includes("json")) {
        return { ok: true, status: res.status, elapsedMs, contentType: contentType || "application/octet-stream", audio: res.body };
      }
      let text: string;
      try {
        text = await res.text();
      } catch {
        return { ok: false, status: res.status, networkError: "body_read", elapsedMs, body: null };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text.slice(0, PROBE_BODY_MAX_CHARS);
      }
      return { ok: false, status: res.status, networkError: null, elapsedMs, body: parsed };
    },
  };
}

// ---- 本番の読み上げ ----

/** 送る回数（再試行は 1 回。implementation-policy 2） */
export const SPEECH_MAX_ATTEMPTS = 2;
/** 再試行の前に待つ時間 */
export const SPEECH_RETRY_WAIT_MS = 2_000;
/** 429 の Retry-After に従って待つ上限 */
export const SPEECH_MAX_RETRY_AFTER_MS = 30_000;
/** 締め切りまでの残りがこれより短ければ、送らない（送っても返る前に切れる） */
export const SPEECH_MIN_CALL_MS = 5_000;
/** 受け取る音声の大きさの上限（60 字の問いかけの mp3 は数百 KB に収まる。超えたら壊れた応答とみなす） */
export const SPEECH_MAX_AUDIO_BYTES = 5 * 1024 * 1024;

const RETRYABLE: ReadonlySet<SpeechFailure> = new Set<SpeechFailure>(["timeout", "network", "rate_limited", "upstream", "invalid_response"]);

export interface OpenAISpeakerOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 一回の時間切れ（テスト用。既定は 60 秒） */
  timeoutMs?: number;
}

type Attempt = { ok: true; audio: Uint8Array; contentType: string } | { ok: false; reason: SpeechFailure; retryAfterMs?: number };

/** mp3 の頭（ID3 の札、またはフレームの同期の印） */
function looksLikeMp3(b: Uint8Array): boolean {
  if (b.length < 3) return false;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;
  return b[0] === 0xff && (b[1]! & 0xe0) === 0xe0;
}

/**
 * 問いかけの読み上げ。応答は外から来るデータとして、形式（audio/*、mp3 の頭）と大きさを確かめてから返す。
 * 時間切れは 60 秒（締め切りの残りが短ければその分）。時間切れ・429・5xx・接続の失敗・壊れた応答は 1 回だけやり直す。
 * 429 は Retry-After に従う（最長 30 秒）。締め切りに収まらない再試行はしない。ログは出さない（呼ぶ側が ID と種類だけを出す）
 */
export function createOpenAISpeaker(apiKey: string, options: OpenAISpeakerOptions = {}): Speaker {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  async function once(body: string, limitMs: number): Promise<Attempt> {
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(limitMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, reason: timedOut ? "timeout" : "network" };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      const s = res.status;
      if (s === 429) {
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        return retryAfterMs === undefined ? { ok: false, reason: "rate_limited" } : { ok: false, reason: "rate_limited", retryAfterMs };
      }
      if (s === 401 || s === 403) return { ok: false, reason: "auth" };
      if (s >= 500) return { ok: false, reason: "upstream" };
      return { ok: false, reason: "rejected" };
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const declared = Number(res.headers.get("content-length") ?? "NaN");
    if (!contentType.startsWith("audio/") || (Number.isFinite(declared) && declared > SPEECH_MAX_AUDIO_BYTES)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "invalid_response" };
    }
    let audio: Uint8Array;
    try {
      audio = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, reason: timedOut ? "timeout" : "network" };
    }
    if (audio.byteLength === 0 || audio.byteLength > SPEECH_MAX_AUDIO_BYTES || !looksLikeMp3(audio)) {
      return { ok: false, reason: "invalid_response" };
    }
    return { ok: true, audio, contentType };
  }

  return {
    async speak({ text, settings, deadline }): Promise<SpeakResult> {
      const body = JSON.stringify({
        model: settings.model,
        input: text,
        voice: settings.voice,
        instructions: settings.instructions,
        speed: settings.speed,
        response_format: settings.format,
      });
      let last: SpeechFailure = "past_deadline";
      for (let attempt = 1; attempt <= SPEECH_MAX_ATTEMPTS; attempt++) {
        const remaining = deadline === undefined ? Infinity : deadline - now();
        if (remaining < SPEECH_MIN_CALL_MS) return { ok: false, reason: attempt === 1 ? "past_deadline" : last, attempts: attempt - 1 };
        const r = await once(body, Math.min(timeoutMs, remaining));
        if (r.ok) return { ok: true, audio: r.audio, contentType: r.contentType, attempts: attempt };
        last = r.reason;
        if (!RETRYABLE.has(r.reason) || attempt >= SPEECH_MAX_ATTEMPTS) return { ok: false, reason: r.reason, attempts: attempt };
        const wait =
          r.reason === "rate_limited" && r.retryAfterMs !== undefined
            ? Math.min(Math.max(r.retryAfterMs, 0), SPEECH_MAX_RETRY_AFTER_MS)
            : SPEECH_RETRY_WAIT_MS;
        if (deadline !== undefined && now() + wait + SPEECH_MIN_CALL_MS > deadline) return { ok: false, reason: r.reason, attempts: attempt };
        await sleep(wait);
      }
      return { ok: false, reason: last, attempts: SPEECH_MAX_ATTEMPTS };
    },
  };
}
