// OpenAI の文字起こしを、偽の fetch で確かめる（本物は呼ばない）。
import { describe, expect, it, vi } from "vitest";
import { createOpenAITranscriber, TRANSCRIBE_MODEL, transcribePrompt } from "../src/server/adapters/openai-transcriber";

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

describe("OpenAI の文字起こし", () => {
  it("方言の地域を prompt に入れ、モデルと日本語を指定する", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("model")).toBe(TRANSCRIBE_MODEL);
      expect(form.get("language")).toBe("ja");
      expect(form.get("prompt")).toContain("鹿児島");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return Response.json({ text: " 架空の文字 " });
    });
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: "鹿児島" })).toEqual({ ok: true, text: "架空の文字" });
  });

  it("標準の話し方なら、地域を入れない", () => {
    expect(transcribePrompt(null)).not.toContain("方言");
  });

  it("形の違う応答は invalid_response（拾って使わない）", async () => {
    const tr = createOpenAITranscriber("k", (async () => Response.json({ txt: "x" })) as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null })).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("400 はやり直さず rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null })).toEqual({ ok: false, reason: "rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("接続の失敗は一度だけやり直す", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(Response.json({ text: "架空" }));
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null })).toEqual({ ok: true, text: "架空" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
