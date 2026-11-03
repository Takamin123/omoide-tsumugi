// 開発用の確かめの入り口（POST /api/check/transcribe）。本物の OpenAI は呼ばない（fetch を偽物に差し替える）。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenAITranscribeProbe } from "../src/server/adapters/openai-transcriber";
import { addMember, addPhoto, createFamily, makeTestApp, postForm, startD1, type TestApp } from "./helpers";

/** 家族を作り、最初の一人（家族の画面の人）を入れて、その人の cookie を返す（確かめの入り口は人のいるリンクで開く。0036） */
async function memberOf(t: TestApp): Promise<{ cookie: string; id: string }> {
  return addMember(t, (await createFamily(t)).cookie);
}

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const SECRET_WORDS = "架空の秘密のことば";

function checkForm(params: unknown, audio: { bytes?: Uint8Array; type: string } = { type: "audio/mp4" }): FormData {
  const form = new FormData();
  form.append("params", typeof params === "string" ? params : JSON.stringify(params));
  form.append("audio", new File([audio.bytes ?? new Uint8Array([1, 2, 3, 4])], "a", { type: audio.type }));
  return form;
}

/** 偽の fetch。送られた multipart を覚え、決めた応答を返す */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const sent: { url: string; form: FormData; auth: string }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, form: init.body as FormData, auth: (init.headers as Record<string, string>).Authorization! });
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, sent, calls: impl };
}

const params = {
  model: "gpt-transcribe",
  fields: [
    ["language", "ja"],
    ["response_format", "verbose_json"],
    ["timestamp_granularities[]", "word"],
    ["timestamp_granularities[]", "segment"],
    ["prompt", SECRET_WORDS],
    ["keywords[]", SECRET_WORDS],
  ],
};

describe("POST /api/check/transcribe", () => {
  it("本番では、合言葉があっても 404（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { appEnv: "production", transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(params), cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("合言葉なしなら 401", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const res = await postForm(t, "/api/check/transcribe", checkForm(params), "");
    expect(res.status).toBe(401);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("OpenAI が 400 を返しても 200 で、status と本文をそのまま入れる", async () => {
    const upstream = { error: { message: "Invalid file format.", type: "invalid_request_error" } };
    const f = fakeFetch(() => Response.json(upstream, { status: 400 }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(params, { type: "audio/mp4" }), cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 400,
      networkError: null,
      body: upstream,
      acceptedByNarrations: true,
      sent: { model: "gpt-transcribe", fileName: "audio.m4a", contentType: "audio/mp4", size: 4, fields: params.fields },
    });
    expect(f.calls).toHaveBeenCalledTimes(1); // やり直さない
  });

  it("送った欄は、並びどおりに multipart に入る（file と model が先）", async () => {
    const f = fakeFetch(() => Response.json({ text: "x", words: [] }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(params), cookie);
    expect(res.status).toBe(200);
    const { url, form, auth } = f.sent[0]!;
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(auth).toBe("Bearer k");
    const entries = [...form.entries()];
    expect(entries.map(([k]) => k)).toEqual(["file", "model", ...params.fields.map(([k]) => k)]);
    expect(entries.slice(1).map(([, v]) => v)).toEqual(["gpt-transcribe", ...params.fields.map(([, v]) => v)]);
    expect((form.get("file") as File).name).toBe("audio.m4a");
  });

  it("形式の検査はしない: 空の type も送り、語りの受け取りでは受け付けないと返す", async () => {
    const f = fakeFetch(() => new Response("not json at all", { status: 415 }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(params, { type: "" }), cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 415, body: "not json at all", acceptedByNarrations: false });
    expect((f.sent[0]!.form.get("file") as File).name).toBe("audio.webm");
  });

  it("JSON でない本文は、先頭 20,000 字まで", async () => {
    const f = fakeFetch(() => new Response("あ".repeat(25_000), { status: 500 }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const body = (await (await postForm(t, "/api/check/transcribe", checkForm(params), cookie)).json()) as { body: string };
    expect(body.body).toHaveLength(20_000);
  });

  it("届かなかったときは status が null で、種類が入る", async () => {
    const f = fakeFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const body = await (await postForm(t, "/api/check/transcribe", checkForm(params), cookie)).json();
    expect(body).toMatchObject({ status: null, networkError: "timeout", body: null });
    expect(f.calls).toHaveBeenCalledTimes(1);
  });

  it("ログには本文・プロンプト・keywords の値を出さず、欄の名前だけを出す", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ text: SECRET_WORDS }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    await postForm(t, "/api/check/transcribe", checkForm(params), cookie);
    const lines = [...log.mock.calls, ...err.mock.calls].map((a) => a.map(String).join(" "));
    expect(lines.join("\n")).not.toContain(SECRET_WORDS);
    const entry = lines.map((l) => JSON.parse(l)).find((l) => l.event === "check_transcribe");
    expect(entry).toEqual({
      event: "check_transcribe",
      model: "gpt-transcribe",
      status: 200,
      networkError: null,
      contentType: "audio/mp4",
      size: 4,
      elapsedMs: expect.any(Number),
      fields: params.fields.map(([k]) => k),
    });
  });

  it("キーがないときは internal（invalid_request にしない）", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeTestApp(d1);
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(params), cookie);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });

  it.each([
    ["params が JSON でない", "{"],
    ["知らない欄の名前", { model: "gpt-transcribe", fields: [["file", "x"]] }],
    ["知らないモデル", { model: "gpt-9", fields: [] }],
  ])("%s → 400", async (_name, p) => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await memberOf(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(p), cookie);
    expect(res.status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });
});

describe("本番の文字起こしのログ（transcribe_done）", () => {
  it("録音の形式と大きさを出し、文字起こしの本文は出さない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const t = makeTestApp(d1);
    const { cookie } = await memberOf(t);
    const photo = await addPhoto(t, cookie, 1);
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "voice", photoId: photo.id, entranceId: null, replyToId: null, text: null }));
    form.append("audio", new File([new Uint8Array([1, 2, 3, 4, 5])], "a", { type: "audio/mp4" }));
    const res = await postForm(t, "/api/narrations", form, cookie);
    expect(res.status).toBe(202);
    await t.flush();
    const lines = log.mock.calls.map((a) => a.map(String).join(" "));
    expect(lines.join("\n")).not.toContain("架空の語り");
    const entry = lines.map((l) => JSON.parse(l)).find((l) => l.event === "transcribe_done");
    expect(entry).toMatchObject({ status: "done", contentType: "audio/mp4", audioBytes: 5 });
  });
});
