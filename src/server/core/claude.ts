// Claude の呼び出しの、実装によらない部分: 用途 → モデルの対応表、キーがないときの実装、画像の base64。
import type { ClaudeCallMeta, ClaudeClient, ClaudePrompt, ClaudePurpose } from "./ports";

export const CLAUDE_HAIKU = "claude-haiku-5-5";
export const CLAUDE_SONNET = "claude-sonnet-5-5";

export interface ClaudePurposeSettings {
  model: string;
  /** 応答の上限（考える分を含む）。超えたら truncated として扱う */
  maxTokens: number;
  /** 考える深さ。未設定ならモデルの既定。出し比べで決める */
  effort?: "low" | "medium" | "high";
}

/**
 * 用途 → モデルの対応表（ここ一か所）。
 * 迷ったら、家族に見える言葉を作る用途は Sonnet、見えない整理と整形は Haiku。Opus を使うかは人間が決める（費用）。
 */
export const CLAUDE_PURPOSES: Record<ClaudePurpose, ClaudePurposeSettings> = {
  photo_guess: { model: CLAUDE_HAIKU, maxTokens: 8_000 },
  clean_transcript: { model: CLAUDE_HAIKU, maxTokens: 8_000 },
  entrance: { model: CLAUDE_SONNET, maxTokens: 16_000 },
  extract_records: { model: CLAUDE_HAIKU, maxTokens: 8_000 },
};

/** 送る前に止めたときや、応答がなかったときの記録 */
export function emptyMeta(prompt: ClaudePrompt, attempts = 0): ClaudeCallMeta {
  return {
    purpose: prompt.purpose,
    model: CLAUDE_PURPOSES[prompt.purpose].model,
    promptVersion: prompt.version,
    inputTokens: 0,
    outputTokens: 0,
    attempts,
  };
}

/** キーがないときの Claude。呼ばずに not_configured で返す（呼ぶ側は固定の入り口などに倒す） */
export const notConfiguredClaude: ClaudeClient = {
  async call(req) {
    return { ok: false, reason: "not_configured", meta: emptyMeta(req.prompt) };
  },
  async createBatch() {
    return { ok: false, reason: "not_configured" };
  },
  async getBatch() {
    return { ok: false, reason: "not_configured" };
  },
  async getBatchResults() {
    return { ok: false, reason: "not_configured" };
  },
};

/** バイト列を base64 に（Buffer を使わない。Web 標準の btoa だけ） */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
