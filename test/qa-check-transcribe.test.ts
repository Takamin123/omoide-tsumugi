// 開発用の確かめの入り口（POST /api/check/transcribe）と、語りの受け取りの判定の置き換えの、すき間の確かめ（qa-engineer）。
// 本物の OpenAI は呼ばない。架空の小さなデータだけを使う。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createOpenAITranscribeProbe } from "../src/server/adapters/openai-transcriber";
import { isAcceptableAudio, MAX_AUDIO_BYTES } from "../src/server/routes/narrations";
import { addMember, addPhoto, cookieOf, createFamily, makeTestApp, postForm, startD1 } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

const SECRET = "架空のないしょの言葉";

function fakeFetch(respond: () => Response | Promise<Response>) {
  const sent: { form: FormData }[] = [];
  const impl = vi.fn(async (_url: string, init: RequestInit) => {
    sent.push({ form: init.body as FormData });
    return respond();
  });
  return { impl: impl as unknown as typeof fetch, sent, calls: impl };
}

function checkForm(params: unknown, audio: { bytes?: Uint8Array; type: string } | "none" | "string" = { type: "audio/mp4" }): FormData {
  const form = new FormData();
  form.append("params", typeof params === "string" ? params : JSON.stringify(params));
  if (audio === "string") form.append("audio", "not a file");
  else if (audio !== "none") form.append("audio", new File([audio.bytes ?? new Uint8Array([1, 2, 3, 4])], "a", { type: audio.type }));
  return form;
}

const okParams = { model: "gpt-transcribe", fields: [["language", "ja"]] };

// 置き換える前の、語りの受け取りの判定（narrations.ts にあったもの）をそのまま写す
const OLD_AUDIO_TYPE = /^audio\/[a-z0-9.+-]+(;[ a-z0-9=.,+-]*)?$/i;
const oldAccept = (f: File) => !(f.size === 0 || f.type.length > 100 || !OLD_AUDIO_TYPE.test(f.type));

const audioTypes = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/mp4; codecs=mp4a.40.2",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/ogg;codecs=opus",
  "AUDIO/WEBM",
  "",
  "video/webm",
  "video/mp4",
  "text/html",
  "audio/",
  "audio/webm;codecs=\"opus\"",
  "audio/webm\nx",
  "audio/" + "a".repeat(95),
  "audio/" + "a".repeat(94),
];

describe("語りの受け取りの判定の置き換え（isAcceptableAudio）", () => {
  it.each(audioTypes.map((t) => [JSON.stringify(t), t]))("%s: 置き換える前と同じ判定", (_n, type) => {
    for (const bytes of [new Uint8Array([1]), new Uint8Array([])]) {
      const f = new File([bytes], "a", { type });
      expect(isAcceptableAudio(f)).toBe(oldAccept(f));
    }
  });

  it("確かめの入り口の acceptedByNarrations と、実際の語りの受け取り（202 か 400 か）が一致する", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { cookie } = await createFamily(t);
    const m = await addMember(t, cookie);
    const p = await addPhoto(t, cookie, m.id, 1);
    // File は type を小文字にするので、ブラウザから届きうる形に絞って比べる
    for (const type of ["audio/webm;codecs=opus", "audio/mp4", "audio/x-m4a", "", "video/mp4", "text/html"]) {
      const check = await postForm(t, "/api/check/transcribe", checkForm(okParams, { type }), cookie);
      expect(check.status).toBe(200);
      const accepted = ((await check.json()) as { acceptedByNarrations: boolean }).acceptedByNarrations;

      const form = new FormData();
      form.append("meta", JSON.stringify({ kind: "voice", speakerMemberId: m.id, photoId: p.id, entranceId: null, replyToId: null, text: null }));
      form.append("audio", new File([new Uint8Array([1, 2, 3])], "a", { type }));
      const res = await postForm(t, "/api/narrations", form, cookie);
      expect([type, res.status]).toEqual([type, accepted ? 202 : 400]);
    }
    await t.flush();
  });
});

describe("POST /api/check/transcribe のすき間", () => {
  it("本番では、キーがなくても 404（500 にならない。入り口があることを見せない）", async () => {
    const t = makeTestApp(d1, { appEnv: "production" });
    const { cookie } = await createFamily(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(okParams), cookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("本番では、params が壊れていても 404（中身を見る前に閉じる）", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { appEnv: "production", transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    expect((await postForm(t, "/api/check/transcribe", checkForm("{"), cookie)).status).toBe(404);
  });

  it("プレビュー（APP_ENV=preview）では開いている", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { appEnv: "preview", transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    expect((await postForm(t, "/api/check/transcribe", checkForm(okParams), cookie)).status).toBe(200);
  });

  it("でたらめな合言葉なら 401（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const res = await postForm(t, "/api/check/transcribe", checkForm(okParams), cookieOf("wrong-token"));
    expect(res.status).toBe(401);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("Content-Length が上限を超えたら 413（OpenAI を呼ばない）", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await t.app.request("/api/check/transcribe", {
      method: "POST",
      body: "x",
      headers: { Cookie: cookie, "Content-Type": "multipart/form-data; boundary=b", "Content-Length": String(MAX_AUDIO_BYTES + 1) },
    });
    expect(res.status).toBe(413);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("Content-Length がなければ 400", async () => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await t.app.request("/api/check/transcribe", { method: "POST", body: checkForm(okParams), headers: { Cookie: cookie } });
    expect(res.status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it.each([
    ["audio がない", checkForm(okParams, "none")],
    ["audio が文字列", checkForm(okParams, "string")],
    ["params がない", (() => { const fd = new FormData(); fd.append("audio", new File([new Uint8Array([1])], "a", { type: "audio/mp4" })); return fd; })()],
    ["欄が 31 個", checkForm({ model: "gpt-transcribe", fields: Array.from({ length: 31 }, () => ["timestamp_granularities[]", "word"]) })],
    ["欄の値が 2,001 字", checkForm({ model: "gpt-transcribe", fields: [["prompt", "あ".repeat(2_001)]] })],
    ["欄が組でない", checkForm({ model: "gpt-transcribe", fields: [["language"]] })],
    ["model を欄で上書きしようとする", checkForm({ model: "gpt-transcribe", fields: [["model", "whisper-1"]] })],
  ])("%s → 400（OpenAI を呼ばない）", async (_n, form) => {
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    expect((await postForm(t, "/api/check/transcribe", form, cookie)).status).toBe(400);
    expect(f.calls).not.toHaveBeenCalled();
  });

  it("欄が 30 個ちょうど、値が 2,000 字ちょうどなら通る", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const fields = [["prompt", "あ".repeat(2_000)], ...Array.from({ length: 29 }, () => ["keywords[]", "架空"])];
    const res = await postForm(t, "/api/check/transcribe", checkForm({ model: "whisper-1", fields }), cookie);
    expect(res.status).toBe(200);
    expect([...f.sent[0]!.form.keys()]).toHaveLength(32);
  });

  it("送った録音の中身は、受け取ったものと同じ", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ text: "x" }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const bytes = new Uint8Array([9, 8, 7, 6, 5]);
    await postForm(t, "/api/check/transcribe", checkForm(okParams, { bytes, type: "audio/webm;codecs=opus" }), cookie);
    const file = f.sent[0]!.form.get("file") as File;
    expect(file.name).toBe("audio.webm");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it.each([429, 500, 503])("OpenAI が %i でも、やり直さずに 200 で返す", async (status) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ error: { message: "x" } }, { status }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const res = await postForm(t, "/api/check/transcribe", checkForm(okParams), cookie);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: number }).status).toBe(status);
    expect(f.calls).toHaveBeenCalledTimes(1);
  });

  it("つながらない（TypeError）ときは networkError が network", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const body = await (await postForm(t, "/api/check/transcribe", checkForm(okParams), cookie)).json();
    expect(body).toMatchObject({ status: null, networkError: "network", body: null });
  });

  it("OpenAI の誤りの本文（入力の言葉を含む）も、ログには出ない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeFetch(() => Response.json({ error: { message: `bad prompt: ${SECRET}` } }, { status: 400 }));
    const t = makeTestApp(d1, { transcribeProbe: createOpenAITranscribeProbe("k", f.impl) });
    const { cookie } = await createFamily(t);
    const params = { model: "gpt-transcribe", fields: [["prompt", SECRET], ["keywords", SECRET], ["languages[]", "ja"]] };
    const res = await postForm(t, "/api/check/transcribe", checkForm(params), cookie);
    expect(res.status).toBe(200);
    const all = [...log.mock.calls, ...err.mock.calls, ...warn.mock.calls].map((a) => a.map(String).join(" ")).join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("bad prompt");
    expect(all).not.toContain("Bearer");
  });

  it("キーがないときのログにも、入れた値は出ない", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = makeTestApp(d1);
    const { cookie } = await createFamily(t);
    await postForm(t, "/api/check/transcribe", checkForm({ model: "gpt-transcribe", fields: [["prompt", SECRET]] }), cookie);
    const all = [...log.mock.calls, ...err.mock.calls].map((a) => a.map(String).join(" ")).join("\n");
    expect(all).not.toContain(SECRET);
  });
});
