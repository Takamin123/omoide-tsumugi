// OpenAI の文字起こしを、偽の fetch で確かめる（本物は呼ばない）。
import { describe, expect, it, vi } from "vitest";
import {
  createOpenAITranscriber,
  MAX_TRANSCRIBE_KEYWORDS,
  TRANSCRIBE_MODEL,
  transcribeKeywords,
  transcribePrompt,
} from "../src/server/adapters/openai-transcriber";

const audio = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });

describe("OpenAI の文字起こし", () => {
  it("方言の地域を prompt に入れ、モデルと日本語を指定する", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get("model")).toBe(TRANSCRIBE_MODEL);
      expect(form.getAll("languages[]")).toEqual(["ja"]);
      expect(form.has("language")).toBe(false);
      expect(form.get("prompt")).toContain("鹿児島");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
      return Response.json({ text: " 架空の文字 " });
    });
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: "鹿児島", keywords: [] })).toEqual({ ok: true, text: "架空の文字" });
  });

  it("標準の話し方なら、地域を入れない", () => {
    expect(transcribePrompt(null)).not.toContain("方言");
  });

  it("形の違う応答は invalid_response（拾って使わない）", async () => {
    const tr = createOpenAITranscriber("k", (async () => Response.json({ txt: "x" })) as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null, keywords: [] })).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("400 はやり直さず rejected", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null, keywords: [] })).toEqual({ ok: false, reason: "rejected" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("接続の失敗は一度だけやり直す", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(Response.json({ text: "架空" }));
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    expect(await tr.transcribe({ audio, dialectRegion: null, keywords: [] })).toEqual({ ok: true, text: "架空" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keywords[] を一語ごとに繰り返して送る。prompt には語を並べない", async () => {
    let form: FormData | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      form = init.body as FormData;
      return Response.json({ text: "架空" });
    });
    const tr = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch);
    await tr.transcribe({ audio, dialectRegion: "鹿児島", keywords: ["ばあば", "けんちゃん"] });
    expect(form!.getAll("keywords[]")).toEqual(["ばあば", "けんちゃん"]);
    expect(form!.has("keywords")).toBe(false);
    const prompt = String(form!.get("prompt"));
    expect(prompt).not.toContain("ばあば");
    expect(prompt).not.toContain("けんちゃん");
    expect(prompt).toBe(transcribePrompt("鹿児島"));
  });

  it("keywords がなければ keywords[] の欄を付けない", async () => {
    let form: FormData | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      form = init.body as FormData;
      return Response.json({ text: "架空" });
    });
    await createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch).transcribe({ audio, dialectRegion: null, keywords: ["", "  "] });
    expect(form!.has("keywords[]")).toBe(false);
  });

  it("やり直しのときも、同じ欄を送る", async () => {
    const forms: FormData[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      forms.push(init.body as FormData);
      return forms.length === 1 ? new Response("{}", { status: 500 }) : Response.json({ text: "架空" });
    });
    vi.useFakeTimers();
    try {
      const p = createOpenAITranscriber("k", fetchImpl as unknown as typeof fetch).transcribe({ audio, dialectRegion: null, keywords: ["ばあば"] });
      await vi.runAllTimersAsync();
      expect(await p).toEqual({ ok: true, text: "架空" });
    } finally {
      vi.useRealTimers();
    }
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect(f.getAll("keywords[]")).toEqual(["ばあば"]);
      expect(f.getAll("languages[]")).toEqual(["ja"]);
    }
  });
});

describe("送る keywords の絞り込み", () => {
  it("空と前後の空白を除き、重複をまとめる（順は保つ）", () => {
    expect(transcribeKeywords(["ばあば", " ", "", " じいじ ", "ばあば", "じいじ"])).toEqual(["ばあば", "じいじ"]);
  });

  it("<、>、改行（CR、LF）を含む語は送らない（API がリクエスト全体を断るため）", () => {
    expect(transcribeKeywords(["<b>", "a>b", "上の\nけん", "下の\rけん", "末尾改行\n", "ばあば"])).toEqual(["ばあば"]);
  });

  it("上限の件数で切る", () => {
    const many = Array.from({ length: MAX_TRANSCRIBE_KEYWORDS + 5 }, (_, i) => `架空の呼び名${i}`);
    const out = transcribeKeywords(many);
    expect(out).toHaveLength(MAX_TRANSCRIBE_KEYWORDS);
    expect(out[0]).toBe("架空の呼び名0");
  });

  it("上限は控えめな数の定数", () => {
    expect(MAX_TRANSCRIBE_KEYWORDS).toBeGreaterThan(0);
    expect(MAX_TRANSCRIBE_KEYWORDS).toBeLessThanOrEqual(50);
  });
});
