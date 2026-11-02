// OpenAI の読み上げ（/v1/audio/speech）。今は開発用の確かめ（POST /api/check/speech）だけが使う（0019 の試しの段階）。
// fetch だけを使うので、Workers でも VPS でも同じものを使える。入力の文や声への指示はログに出さない。
import type { SpeechProbe } from "../core/ports";

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
