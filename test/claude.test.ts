// Claude の呼び出しの土台。本物の実装（createAnthropicClaude）に、台本どおりに返す偽の API を差し込んで確かめる。
// 本物の API は呼ばない。
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CLAUDE_MAX_IMAGE_BASE64_CHARS, parseRetryAfter } from "../src/server/adapters/anthropic-claude";
import { CLAUDE_PURPOSES, bytesToBase64, notConfiguredClaude } from "../src/server/core/claude";
import { QUESTION_MAX_CHARS, charCount, exceedsChars, findTestingPhrase, questionCount } from "../src/server/core/claude-checks";
import type { ClaudePrompt } from "../src/server/core/ports";
import { PROMPTS } from "../src/server/prompts";
import { fakeClaude, fakeClaudeMessage } from "./helpers";
import { fs, path, repoRoot } from "./node";

const prompt: ClaudePrompt = { purpose: "entrance", version: "entrance/v9", text: "架空のプロンプト本文" };
const schema = z.object({ question: z.string(), photoId: z.string() });
const good = { question: "この日はどんな一日でしたか", photoId: "p1" };
const content = [{ type: "text" as const, text: "架空の入力の本文" }];

describe("call: 合う応答", () => {
  it("検証済みの値と、モデル・版・トークン数を返す", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: good, model: "claude-sonnet-5-5", inputTokens: 120, outputTokens: 30 }] });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r).toEqual({
      ok: true,
      value: good,
      meta: { purpose: "entrance", model: "claude-sonnet-5-5", promptVersion: "entrance/v9", inputTokens: 120, outputTokens: 30, attempts: 1 },
    });
  });

  it("用途の対応表のモデルで、プロンプトを system に、構造化出力のスキーマを付けて送る", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: good }] });
    await f.claude.call({
      prompt: { purpose: "photo_guess", version: "photo_guess/v9", text: "架空" },
      content: [
        { type: "image", mediaType: "image/jpeg", base64: "AAAA" },
        { type: "text", text: "架空" },
      ],
      schema,
    });
    expect(f.requests).toHaveLength(1);
    const body = f.requests[0]!.body as Record<string, any>;
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe("架空");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.properties).toHaveProperty("question");
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
          { type: "text", text: "架空" },
        ],
      },
    ]);
  });
});

describe("call: 合わない応答と再試行", () => {
  it("スキーマ違反は 2 秒待って一度だけやり直す。トークン数は合計する", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: 1 } }, { kind: "json", value: good }] });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r.ok).toBe(true);
    expect(r.meta.attempts).toBe(2);
    expect(r.meta.inputTokens).toBe(20);
    expect(f.sleeps).toEqual([2000]);
  });

  it("二度とも合わなければ invalid_response。一部を拾わない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "x" } }, { kind: "text", text: "JSON ではない" }] });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r).toMatchObject({ ok: false, reason: "invalid_response", meta: { attempts: 2 } });
    expect(r).not.toHaveProperty("value");
    expect(f.requests).toHaveLength(2);
  });

  it("中身の検査の違反は check_failed として、やり直す", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: good }, { kind: "json", value: good }] });
    const r = await f.claude.call({ prompt, content, schema, check: (v) => (v.photoId === "p1" ? "unknown_photo" : null) });
    expect(r).toMatchObject({ ok: false, reason: "check_failed", violation: "unknown_photo", meta: { attempts: 2 } });
  });

  it("一度目の検査違反、二度目で通れば ok", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { ...good, photoId: "nope" } }, { kind: "json", value: good }] });
    const r = await f.claude.call({ prompt, content, schema, check: (v) => (v.photoId === "p1" ? null : "unknown_photo") });
    expect(r.ok && r.value).toEqual(good);
  });

  it("時間切れはやり直し、二度目も時間切れなら timeout", async () => {
    const f = fakeClaude({ replies: [{ kind: "timeout" }, { kind: "timeout" }] }, { timeoutMs: 20 });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r).toMatchObject({ ok: false, reason: "timeout", meta: { attempts: 2 } });
    expect(f.sleeps).toEqual([2000]);
  });

  it("時間切れの後に合う応答なら ok", async () => {
    const f = fakeClaude({ replies: [{ kind: "timeout" }, { kind: "json", value: good }] }, { timeoutMs: 20 });
    expect((await f.claude.call({ prompt, content, schema })).ok).toBe(true);
  });

  it("接続エラーはやり直す", async () => {
    const f = fakeClaude({ replies: [{ kind: "network" }, { kind: "json", value: good }] });
    expect((await f.claude.call({ prompt, content, schema })).ok).toBe(true);
  });

  it.each([
    ["5", 5000],
    ["120", 30000],
    [undefined, 2000],
  ])("429 は Retry-After（%s）に従い、最長 30 秒待つ", async (retryAfter, waited) => {
    const f = fakeClaude({ replies: [{ kind: "status", status: 429, ...(retryAfter ? { retryAfter } : {}) }, { kind: "json", value: good }] });
    const r = await f.claude.call({ prompt, content, schema });
    expect(r.ok).toBe(true);
    expect(f.sleeps).toEqual([waited]);
  });

  it("429 が続けば rate_limited", async () => {
    const f = fakeClaude({ replies: [{ kind: "status", status: 429 }, { kind: "status", status: 429 }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason: "rate_limited", meta: { attempts: 2 } });
  });

  it.each([
    [500, "upstream"],
    [529, "upstream"],
  ])("%i はやり直す", async (status, reason) => {
    const f = fakeClaude({ replies: [{ kind: "status", status }, { kind: "status", status }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason, meta: { attempts: 2 } });
  });

  it.each([
    [400, "rejected"],
    [404, "rejected"],
    [401, "auth"],
    [403, "auth"],
    [413, "too_large"],
  ])("%i はやり直さない（%s）", async (status, reason) => {
    const f = fakeClaude({ replies: [{ kind: "status", status }, { kind: "json", value: good }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason, meta: { attempts: 1 } });
    expect(f.requests).toHaveLength(1);
    expect(f.sleeps).toEqual([]);
  });

  it("拒否（refusal）はやり直さない", async () => {
    const f = fakeClaude({ replies: [{ kind: "stop", stopReason: "refusal" }, { kind: "json", value: good }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason: "refused", meta: { attempts: 1 } });
  });

  it("上限で切れた（max_tokens）はやり直す", async () => {
    const f = fakeClaude({ replies: [{ kind: "stop", stopReason: "max_tokens" }, { kind: "stop", stopReason: "max_tokens" }] });
    expect(await f.claude.call({ prompt, content, schema })).toMatchObject({ ok: false, reason: "truncated", meta: { attempts: 2 } });
  });

  it("大きすぎる画像は送らずに too_large", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: good }] });
    const big = "A".repeat(CLAUDE_MAX_IMAGE_BASE64_CHARS + 4);
    const r = await f.claude.call({ prompt, content: [{ type: "image", mediaType: "image/jpeg", base64: big }], schema });
    expect(r).toMatchObject({ ok: false, reason: "too_large", meta: { attempts: 0 } });
    expect(f.requests).toHaveLength(0);
  });
});

describe("call: ログ", () => {
  it("一回の呼び出しに一行。ID・モデル・版・トークン数・種類だけで、本文もプロンプトも出さない", async () => {
    const f = fakeClaude({ replies: [{ kind: "json", value: { question: "架空の応答の本文" } }, { kind: "status", status: 400 }] });
    await f.claude.call({ prompt, content, schema, traceId: "trace-1" });
    expect(f.logs).toHaveLength(1);
    expect(f.logs[0]).toMatchObject({ event: "claude_call", traceId: "trace-1", purpose: "entrance", promptVersion: "entrance/v9", ok: false, reason: "rejected", attempts: 2 });
    const all = JSON.stringify(f.logs);
    for (const secret of ["架空のプロンプト本文", "架空の入力の本文", "架空の応答の本文", "fake-anthropic-key"]) expect(all).not.toContain(secret);
  });
});

describe("Batch", () => {
  const items = [
    { customId: "photo-a", content },
    { customId: "photo-b", content },
  ];

  it("作る: 各件を custom_id と、用途のモデル・スキーマ付きの params で送る", async () => {
    const f = fakeClaude();
    const r = await f.claude.createBatch({ prompt, schema, items });
    expect(r).toEqual({ ok: true, value: { batchId: "msgbatch_fake", status: "in_progress", counts: expect.any(Object) } });
    const body = f.requests[0]!.body as { requests: { custom_id: string; params: Record<string, any> }[] };
    expect(body.requests.map((x) => x.custom_id)).toEqual(["photo-a", "photo-b"]);
    expect(body.requests[0]!.params.model).toBe(CLAUDE_PURPOSES.entrance.model);
    expect(body.requests[0]!.params.output_config.format.type).toBe("json_schema");
  });

  it("作る: custom_id が決まりに合わない、重なる、空なら送らない", async () => {
    const f = fakeClaude();
    expect(await f.claude.createBatch({ prompt, schema, items: [{ customId: "日本語", content }] })).toEqual({ ok: false, reason: "rejected" });
    expect(await f.claude.createBatch({ prompt, schema, items: [items[0]!, items[0]!] })).toEqual({ ok: false, reason: "rejected" });
    expect(await f.claude.createBatch({ prompt, schema, items: [] })).toEqual({ ok: false, reason: "rejected" });
    expect(f.requests).toHaveLength(0);
  });

  it("作る: 失敗してもやり直さない（同じ Batch を二つ作らない）", async () => {
    const f = fakeClaude({ batchReplies: [{ kind: "status", status: 500 }] });
    expect(await f.claude.createBatch({ prompt, schema, items })).toEqual({ ok: false, reason: "upstream" });
    expect(f.requests).toHaveLength(1);
  });

  it("状態を見る", async () => {
    const f = fakeClaude({ batch: { status: "in_progress", rows: [{}, {}] } });
    expect(await f.claude.getBatch("msgbatch_fake")).toEqual({
      ok: true,
      value: { batchId: "msgbatch_fake", status: "in_progress", counts: { processing: 2, succeeded: 0, errored: 0, canceled: 0, expired: 0 } },
    });
  });

  it("状態を見る: 5xx は一度やり直す", async () => {
    const f = fakeClaude({ batchReplies: [{ kind: "status", status: 503 }] });
    expect((await f.claude.getBatch("msgbatch_fake")).ok).toBe(true);
    expect(f.sleeps).toEqual([2000]);
  });

  it("結果: 行ごとに zod で検証し、行ごとに全か無か。custom_id で引ける", async () => {
    const f = fakeClaude({
      batch: {
        status: "ended",
        rows: [
          { custom_id: "photo-b", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: { question: 1 } }) } },
          { custom_id: "photo-a", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: good, model: "claude-sonnet-5-5", inputTokens: 7, outputTokens: 3 }) } },
          { custom_id: "photo-c", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "x" } } } },
          { custom_id: "photo-d", result: { type: "expired" } },
          { custom_id: "photo-e", result: { type: "succeeded", message: fakeClaudeMessage({ kind: "json", value: { ...good, photoId: "zz" } }) } },
          { custom_id: "photo-f", result: { type: "succeeded", message: { broken: true } } },
          { result: { type: "succeeded" } },
        ],
      },
    });
    const r = await f.claude.getBatchResults({ batchId: "msgbatch_fake", prompt, schema, check: (v) => (v.photoId === "zz" ? "unknown_photo" : null) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.value.map((x) => [x.customId, x]));
    expect(byId.size).toBe(6);
    expect(byId.get("photo-a")).toEqual({
      customId: "photo-a",
      ok: true,
      value: good,
      meta: { purpose: "entrance", model: "claude-sonnet-5-5", promptVersion: "entrance/v9", inputTokens: 7, outputTokens: 3, attempts: 1 },
    });
    expect(byId.get("photo-b")).toMatchObject({ ok: false, reason: "invalid_response" });
    expect(byId.get("photo-b")).not.toHaveProperty("value");
    expect(byId.get("photo-c")).toMatchObject({ ok: false, reason: "rejected" });
    expect(byId.get("photo-d")).toMatchObject({ ok: false, reason: "expired" });
    expect(byId.get("photo-e")).toMatchObject({ ok: false, reason: "check_failed", violation: "unknown_photo" });
    expect(byId.get("photo-f")).toMatchObject({ ok: false, reason: "invalid_response" });
    expect(JSON.stringify(f.logs)).not.toContain("この日は");
  });

  it("結果: 終わっていない Batch は rejected（やり直さない）", async () => {
    const f = fakeClaude({ batch: { status: "in_progress" } });
    expect(await f.claude.getBatchResults({ batchId: "msgbatch_fake", prompt, schema })).toEqual({ ok: false, reason: "rejected" });
    expect(f.sleeps).toEqual([]);
  });
});

describe("キーがないとき", () => {
  it("呼ばずに not_configured を返す", async () => {
    expect(await notConfiguredClaude.call({ prompt, content, schema })).toEqual({
      ok: false,
      reason: "not_configured",
      meta: { purpose: "entrance", model: "claude-sonnet-5-5", promptVersion: "entrance/v9", inputTokens: 0, outputTokens: 0, attempts: 0 },
    });
    expect(await notConfiguredClaude.createBatch({ prompt, schema, items: [] })).toEqual({ ok: false, reason: "not_configured" });
  });
});

describe("用途とモデル、プロンプトの版", () => {
  it("見えない整理と整形は Haiku、入り口づくりは Sonnet", () => {
    expect(CLAUDE_PURPOSES.photo_guess.model).toBe("claude-haiku-5-5");
    expect(CLAUDE_PURPOSES.clean_transcript.model).toBe("claude-haiku-5-5");
    expect(CLAUDE_PURPOSES.entrance.model).toBe("claude-sonnet-5-5");
  });

  it.each(Object.entries(PROMPTS))("%s: 版の文字列がファイルと合い、本文がビルドに入っている", (purpose, p) => {
    expect(p.purpose).toBe(purpose);
    expect(p.version).toMatch(new RegExp(`^${purpose}/v\\d+$`));
    const file = path.join(repoRoot, "src/server/prompts", `${p.version}.md`);
    expect(fs.existsSync(file)).toBe(true);
    expect(p.text).toBe(fs.readFileSync(file, "utf8"));
    expect(p.text.trim().length).toBeGreaterThan(0);
  });
});

describe("検査の部品", () => {
  it.each([
    ["この日のことを覚えていますか？", "remember"],
    ["覚えてる？", "remember"],
    ["おぼえとる？", "remember"],
    ["見覚えはありますか", "remember"],
    ["この場所を思い出せますか", "recall"],
    ["おもいだせる？", "recall"],
    ["記憶にありますか", "recall"],
    ["写っているのが誰か分かりますか？", "quiz"],
    ["誰かわかる?", "quiz"],
    ["この人をご存じですか", "quiz"],
    ["どこでしょう？", "identify"],
    ["これは何でしょう？", "quiz"],
    ["この人は誰ですか？", "identify"],
    ["お名前は？", "identify"],
    ["覚えて　いますか", "remember"],
  ])("試す言い回しを止める: %s", (text, kind) => {
    expect(findTestingPhrase(text)).toBe(kind);
  });

  it.each(["この日はどんな一日でしたか？", "このころの思い出を聞かせてください", "この海で、どんなことをしましたか", "誰と一緒でしたか", "どこへ行った帰りでしたか", "いつか行ってみたい場所はありますか"])(
    "開かれた問いかけは通す: %s",
    (text) => {
      expect(findTestingPhrase(text)).toBeNull();
    },
  );

  it("文字数は見た目の一字で数える", () => {
    expect(charCount("あいう")).toBe(3);
    expect(charCount("👨‍👩‍👧")).toBe(1);
    expect(exceedsChars("あ".repeat(QUESTION_MAX_CHARS), QUESTION_MAX_CHARS)).toBe(false);
    expect(exceedsChars("あ".repeat(QUESTION_MAX_CHARS + 1), QUESTION_MAX_CHARS)).toBe(true);
  });

  it("問いの印を数える（全角も半角も）", () => {
    expect(questionCount("どんな日でしたか？")).toBe(1);
    expect(questionCount("誰と？ どこで?")).toBe(2);
    expect(questionCount("聞かせてください")).toBe(0);
  });
});

describe("その他", () => {
  it("bytesToBase64 は大きなバイト列も正しく変える", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    expect(bytesToBase64(bytes)).toBe(btoa(s));
  });

  it("Retry-After は秒でも日付でも読む", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6_000);
    expect(parseRetryAfter("nonsense")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});
