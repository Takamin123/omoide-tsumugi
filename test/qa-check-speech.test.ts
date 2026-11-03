// 開発用の読み上げの確かめ（POST /api/check/speech、0019 の試し）の、すき間の確かめ（qa-engineer）。
// 本物の OpenAI は呼ばない。架空の小さなデータだけを使い、音声のファイルは使わない。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenAISpeechProbe } from "../src/server/adapters/openai-speech";
import type { Repositories, SpeechProbe, SpeechProbeInput } from "../src/server/core/ports";
import { addMember, createFamily, makeTestApp, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const SECRET_INPUT = "架空のないしょの問いかけ";
const SECRET_INSTRUCTIONS = "架空のないしょの指示";

const params = {
  model: "gpt-4o-mini-tts",
  input: SECRET_INPUT,
  voice: "coral",
  instructions: SECRET_INSTRUCTIONS,
  speed: 1,
  response_format: "wav",
};

function fakeFetch(respond: () => Response | Promise<Response>) {
  const sent: { body: Record<string, unknown>; init: RequestInit }[] = [];
  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push({ body: JSON.parse(init.body as string), init });
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, sent, calls: impl };
}

const audioResponse = (type: string | null = "audio/wav") =>
  new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2]), { status: 200, headers: type ? { "Content-Type": type } : {} });

/** 家族を作り、最初の一人の cookie を返す（最初の人のリンクの cookie では、確かめの入り口は 403。0036） */
async function memberCookie(t: TestApp): Promise<{ cookie: string }> {
  const f = await createFamily(t);
  return { cookie: (await addMember(t, f.cookie)).cookie };
}

function post(t: TestApp, body: unknown, cookie: string, contentLength: "auto" | "none" | string = "auto") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const headers: Record<string, string> = { "Content-Type": "application/json", Cookie: cookie };
  if (contentLength === "auto") headers["Content-Length"] = String(new TextEncoder().encode(text).byteLength);
  else if (contentLength !== "none") headers["Content-Length"] = contentLength;
  return t.app.request("/api/check/speech", { method: "POST", headers, body: text });
}

/** 指定したバイト数ちょうどの JSON（空白で詰める。JSON としては同じ） */
function jsonOfBytes(p: unknown, bytes: number): string {
  const base = JSON.stringify(p);
  const n = new TextEncoder().encode(base).byteLength;
  if (n > bytes) throw new Error("too small");
  return base + " ".repeat(bytes - n);
}

/** 呼ばれたリポジトリの名前を覚える */
function recordRepos(t: TestApp): string[] {
  const used: string[] = [];
  const real = t.deps.repos;
  t.deps.repos = new Proxy(real, {
    get(target, prop, recv) {
      used.push(String(prop));
      return Reflect.get(target, prop, recv);
    },
  }) as Repositories;
  return used;
}

describe("音声はメモリに載せず、ストリームのまま返す", () => {
  it("adapter は成功の本文を読まず、res.body をそのまま返す", async () => {
    const upstream = audioResponse();
    const body = upstream.body;
    const probe = createOpenAISpeechProbe("k", (async () => upstream) as unknown as typeof fetch);
    const r = await probe.probe({ model: "tts-1", input: "a", voice: "alloy", instructions: null, speed: 1, responseFormat: "mp3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.audio).toBe(body);
    expect(upstream.bodyUsed).toBe(false);
  });

  it("入り口は、上流の音声が終わる前に応答を返し、届いた分から読める", async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const audio = new ReadableStream<Uint8Array>({
      start(c) {
        push = c;
      },
    });
    push.enqueue(new Uint8Array([1, 2, 3]));
    const probe: SpeechProbe = { probe: async () => ({ ok: true, status: 200, elapsedMs: 5, contentType: "audio/mpeg", audio }) };
    const t = makeTestApp(d1, { speechProbe: probe });
    const { cookie } = await memberCookie(t);
    // 上流をまだ閉じていない。全部を読んでから返すつくりなら、ここで止まる
    const res = await Promise.race([
      post(t, params, cookie),
      new Promise<"stuck">((r) => setTimeout(() => r("stuck"), 2_000)),
    ]);
    expect(res).not.toBe("stuck");
    const reader = (res as Response).body!.getReader();
    const first = await reader.read();
    expect(Array.from(first.value!)).toEqual([1, 2, 3]);
    push.enqueue(new Uint8Array([4]));
    push.close();
    const rest: number[] = [];
    for (let c = await reader.read(); !c.done; c = await reader.read()) rest.push(...c.value);
    expect(rest).toEqual([4]);
  });
});

describe("応答のヘッダー", () => {
  it("Content-Type は上流のもの（wav）をそのまま", async () => {
    const f = fakeFetch(() => audioResponse("audio/wav"));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-check-speech")).toBe("audio");
  });

  it("上流に Content-Type がなければ application/octet-stream", async () => {
    const f = fakeFetch(() => audioResponse(null));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    expect(res.headers.get("x-check-speech")).toBe("audio");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("失敗の応答も Cache-Control: no-store。x-check-elapsed-ms は付けない（音声のときだけ）", async () => {
    const f = fakeFetch(() => Response.json({ error: { message: "x" } }, { status: 429 }));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-check-speech")).toBe("failure");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.get("x-check-elapsed-ms")).toBeNull();
  });
});

describe("境界値（ちょうどは通し、一つ越えたら 400 か 413。越えたら OpenAI を呼ばない）", () => {
  it.each([
    ["文 500 字ちょうど", { input: "あ".repeat(500) }],
    ["声への指示 1,000 字ちょうど", { instructions: "あ".repeat(1_000) }],
    ["speed 0.25", { speed: 0.25 }],
    ["speed 4", { speed: 4 }],
    ["tts-1-hd と flac", { model: "tts-1-hd", response_format: "flac" }],
    ["opus", { response_format: "opus" }],
    ["aac", { response_format: "aac" }],
  ])("%s → 通る", async (_n, patch) => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, { ...params, ...patch }, cookie);
    expect(res.headers.get("x-check-speech")).toBe("audio");
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.sent[0]!.body).toMatchObject(patch);
  });

  it.each([
    ["声への指示 1,001 字", { instructions: "あ".repeat(1_001) }],
    ["instructions がない", { instructions: undefined }],
    ["instructions が null", { instructions: null }],
    ["speed がない", { speed: undefined }],
    ["speed が NaN 相当（null）", { speed: null }],
    ["文が数", { input: 1 }],
    ["配列", null],
  ])("%s → 400", async (_n, patch) => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, patch === null ? [params] : { ...params, ...patch }, cookie);
    expect(res.status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("文は前後の空白を落として送る（trim）。501 字でも、空白を落として 500 字なら通る", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, { ...params, input: ` ${"あ".repeat(500)} ` }, cookie);
    expect(res.headers.get("x-check-speech")).toBe("audio");
    expect(f.sent[0]!.body.input).toBe("あ".repeat(500));
  });

  it("Content-Length 16,384 バイトちょうどは通り、16,385 は 413", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const ok = await post(t, jsonOfBytes(params, 16 * 1024), cookie);
    expect(ok.headers.get("x-check-speech")).toBe("audio");
    const big = await post(t, jsonOfBytes(params, 16 * 1024 + 1), cookie);
    expect(big.status).toBe(413);
    expect(f.calls).toHaveBeenCalledTimes(1);
  });

  it("Content-Length がない、または数でないときは 400（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    expect((await post(t, params, cookie, "none")).status).toBe(400);
    expect((await post(t, params, cookie, "abc")).status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("知らない欄（familyId など）は OpenAI へ送らない", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    await post(t, { ...params, familyId: "fam-x", stream_format: "sse" }, cookie);
    expect(Object.keys(f.sent[0]!.body).sort()).toEqual(["input", "instructions", "model", "response_format", "speed", "voice"]);
  });

  it("空白でない指示は、そのまま（前後の空白も落とさずに）送る", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    await post(t, { ...params, instructions: " ゆっくり " }, cookie);
    expect(f.sent[0]!.body.instructions).toBe(" ゆっくり ");
  });
});

describe("閉じる・断る", () => {
  it("本番では、キーがなくても 404（500 にしない）", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(404);
  });

  it("本番で合言葉なしでも、OpenAI を呼ばない（401 か 404）", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { appEnv: "production", speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const res = await post(t, params, "");
    expect([401, 404]).toContain(res.status);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("合言葉なしでは、本文が壊れていても 401（中身を見る前に断る）", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    expect((await post(t, "{", "")).status).toBe(401);
    expect(f.calls).not.toHaveBeenCalled();
  });
});

describe("家族のデータを読まない", () => {
  it("リポジトリは合言葉の確認（families）だけ。語り・写真・人は読まない。写真の置き場にも触れない", async () => {
    const f = fakeFetch(() => audioResponse());
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const used = recordRepos(t);
    const photoGet = vi.spyOn(t.store, "get");
    const res = await post(t, params, cookie);
    expect(res.headers.get("x-check-speech")).toBe("audio");
    expect([...new Set(used)]).toEqual(["families"]);
    expect(photoGet).not.toHaveBeenCalled();
    // 送るのは人が入れた欄だけ
    expect(JSON.stringify(f.sent[0]!.body)).not.toMatch(/family|member|photo|narration/i);
  });
});

describe("ログ", () => {
  it("OpenAI の断りの本文が文や指示をなぞっていても、ログには出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ error: { message: `bad input: ${SECRET_INPUT} / ${SECRET_INSTRUCTIONS}` } }, { status: 400 }));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    // 画面には本文を見せる（確かめの道具なので）
    expect(JSON.stringify(await res.json())).toContain(SECRET_INPUT);
    const all = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls].map((a) => a.map(String).join(" ")).join("\n");
    expect(all).not.toContain(SECRET_INPUT);
    expect(all).not.toContain(SECRET_INSTRUCTIONS);
    expect(all).not.toContain("bad input");
    expect(all).toContain('"status":400');
  });

  it("届かなかったとき（fetch が TypeError）は network。キーもログに出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("sk-fake-secret-key", f.impl) });
    const { cookie } = await memberCookie(t);
    const res = await post(t, params, cookie);
    expect(await res.json()).toMatchObject({ status: null, networkError: "network", body: null });
    const all = [...log.mock.calls, ...err.mock.calls].map((a) => a.map(String).join(" ")).join("\n");
    expect(all).not.toContain("sk-fake-secret-key");
    expect(all).toContain('"networkError":"network"');
  });
});

describe("adapter の送り方", () => {
  it("時間切れの signal を付け、一度だけ送る（再試行しない）", async () => {
    const f = fakeFetch(() => new Response("x", { status: 503 }));
    const probe = createOpenAISpeechProbe("k", f.impl);
    const input: SpeechProbeInput = { model: "tts-1", input: "a", voice: "alloy", instructions: null, speed: 1, responseFormat: "mp3" };
    const r = await probe.probe(input);
    expect(r).toMatchObject({ ok: false, status: 503, networkError: null, body: "x" });
    expect(f.calls).toHaveBeenCalledTimes(1);
    expect(f.sent[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(f.sent[0]!.init.method).toBe("POST");
  });

  it("本文の読み出しに失敗したら body_read", async () => {
    const broken = new ReadableStream({
      pull(c) {
        c.error(new Error("broken"));
      },
    });
    const f = fakeFetch(() => new Response(broken, { status: 500, headers: { "Content-Type": "application/json" } }));
    const r = await createOpenAISpeechProbe("k", f.impl).probe({
      model: "tts-1",
      input: "a",
      voice: "alloy",
      instructions: null,
      speed: 1,
      responseFormat: "mp3",
    });
    expect(r).toMatchObject({ ok: false, status: 500, networkError: "body_read", body: null });
  });
});
