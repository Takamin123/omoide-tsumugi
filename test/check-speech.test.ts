// 開発用の確かめの入り口（POST /api/check/speech、0019 の試し）。本物の OpenAI は呼ばない（fetch を偽物に差し替える）。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenAISpeechProbe } from "../src/server/adapters/openai-speech";
import { createFamily, makeTestApp, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const SECRET_INPUT = "架空のひみつの問いかけ";
const SECRET_INSTRUCTIONS = "架空のひみつの指示";
const FAKE_AUDIO = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]);

const params = {
  model: "gpt-4o-mini-tts",
  input: SECRET_INPUT,
  voice: "marin",
  instructions: SECRET_INSTRUCTIONS,
  speed: 0.9,
  response_format: "mp3",
};

/** 偽の fetch。送られた JSON を覚え、決めた応答を返す */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const sent: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> });
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, sent, calls: impl };
}

const audioResponse = () => new Response(FAKE_AUDIO, { status: 200, headers: { "Content-Type": "audio/mpeg" } });

function post(t: TestApp, body: unknown, cookie: string) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return t.app.request("/api/check/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": String(new TextEncoder().encode(text).byteLength), Cookie: cookie },
    body: text,
  });
}

describe("POST /api/check/speech", () => {
  it("本番では、合言葉があっても 404（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { appEnv: "production", speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("合言葉なしなら 401", async () => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const res = await post(t, params, "");
    expect(res.status).toBe(401);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("入れた値をそのまま JSON で送り、音声をそのまま返す", async () => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("x-check-speech")).toBe("audio");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Number(res.headers.get("x-check-elapsed-ms"))).toBeGreaterThanOrEqual(0);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FAKE_AUDIO);

    expect(f.calls).toHaveBeenCalledTimes(1);
    const { url, body, headers } = f.sent[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(headers.Authorization).toBe("Bearer k");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(body).toEqual({
      model: "gpt-4o-mini-tts",
      input: SECRET_INPUT,
      voice: "marin",
      instructions: SECRET_INSTRUCTIONS,
      speed: 0.9,
      response_format: "mp3",
    });
  });

  it("instructions が空なら送らない。組み合わせは検査せずに送る（tts-1 と marin）", async () => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, { ...params, model: "tts-1", instructions: "  " }, cookie);
    expect(res.status).toBe(200);
    expect(f.sent[0]!.body).not.toHaveProperty("instructions");
    expect(f.sent[0]!.body).toMatchObject({ model: "tts-1", voice: "marin" });
  });

  it("OpenAI が 400 を返しても 200 で、status と本文をそのまま入れる（やり直さない）", async () => {
    const upstream = { error: { message: "Invalid voice.", type: "invalid_request_error" } };
    const f = fakeFetch(() => Response.json(upstream, { status: 400 }));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-check-speech")).toBe("failure");
    expect(await res.json()).toEqual({ status: 400, networkError: null, elapsedMs: expect.any(Number), body: upstream });
    expect(f.calls).toHaveBeenCalledTimes(1);
  });

  it("200 でも JSON が返ったら音声ではないので、失敗として本文を見せる", async () => {
    const f = fakeFetch(() => Response.json({ unexpected: true }));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.headers.get("x-check-speech")).toBe("failure");
    expect(await res.json()).toMatchObject({ status: 200, body: { unexpected: true } });
  });

  it("JSON でない失敗の本文は、先頭 20,000 字まで", async () => {
    const f = fakeFetch(() => new Response("あ".repeat(25_000), { status: 500 }));
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const body = (await (await post(t, params, cookie)).json()) as { body: string };
    expect(body.body).toHaveLength(20_000);
  });

  it("届かなかったときは status が null で、種類が入る", async () => {
    const f = fakeFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.headers.get("x-check-speech")).toBe("failure");
    expect(await res.json()).toMatchObject({ status: null, networkError: "timeout", body: null });
  });

  it("ログには文と声への指示の中身を出さず、長さだけを出す", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    await (await post(t, params, cookie)).arrayBuffer();
    const lines = [...log.mock.calls, ...err.mock.calls].map((a) => a.map(String).join(" "));
    expect(lines.join("\n")).not.toContain(SECRET_INPUT);
    expect(lines.join("\n")).not.toContain(SECRET_INSTRUCTIONS);
    const entry = lines.map((l) => JSON.parse(l)).find((l) => l.event === "check_speech");
    expect(entry).toEqual({
      event: "check_speech",
      model: "gpt-4o-mini-tts",
      voice: "marin",
      responseFormat: "mp3",
      speed: 0.9,
      inputChars: SECRET_INPUT.length,
      instructionsChars: SECRET_INSTRUCTIONS.length,
      status: 200,
      networkError: null,
      elapsedMs: expect.any(Number),
    });
  });

  it("キーがないときは internal（invalid_request にしない）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeTestApp(d1);
    const { cookie } = await createFamily(t);
    const res = await post(t, params, cookie);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it("大きすぎる本文は 413（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, { ...params, instructions: "x".repeat(20_000) }, cookie);
    expect(res.status).toBe(413);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON でない", "{"],
    ["知らないモデル", { ...params, model: "gpt-9-tts" }],
    ["知らない声", { ...params, voice: "nobody" }],
    ["pcm（ブラウザで鳴らせない）", { ...params, response_format: "pcm" }],
    ["空の文", { ...params, input: "   " }],
    ["長すぎる文", { ...params, input: "あ".repeat(501) }],
    ["speed が範囲の外（小さい）", { ...params, speed: 0.2 }],
    ["speed が範囲の外（大きい）", { ...params, speed: 4.1 }],
    ["speed が文字", { ...params, speed: "1" }],
  ])("%s → 400（OpenAI を呼ばない）", async (_name, p) => {
    const f = fakeFetch(audioResponse);
    const t = makeTestApp(d1, { speechProbe: createOpenAISpeechProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await post(t, p, cookie);
    expect(res.status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });
});
