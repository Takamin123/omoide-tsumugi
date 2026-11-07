// src/client/lib の、DOM なしで確かめられる振る舞い。
// test/ は tsconfig.worker.json（src/client なし、DOM なし）で型を検査するため、src/client は動的 import で読む。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// exifr は偽物に差し替える。写真のファイルは使わない（架空の値だけ）
const exifrMock = vi.hoisted(() => ({ parse: vi.fn(), gps: vi.fn() }));
vi.mock("exifr", () => ({ default: exifrMock }));

const load = (name: string): Promise<any> => import(name);
const { readExifFacts, readExifTagNames } = await load("../../src/client/lib/photos");
const { api, ApiError } = await load("../../src/client/lib/api");
const { sendVoice, sendText } = await load("../../src/client/lib/voice");
const { errorText } = await load("../../src/client/lib/errors");
const { words } = await load("../../src/client/words");

const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

describe("readExifFacts: 位置は丸めた値だけを返す", () => {
  beforeEach(() => {
    exifrMock.parse.mockReset();
    exifrMock.gps.mockReset();
  });

  it("生の緯度経度を小数第 2 位に丸め、生の値はどこにも残らない", async () => {
    exifrMock.parse.mockResolvedValue({ DateTimeOriginal: "1985:04:07 09:00:00" });
    exifrMock.gps.mockResolvedValue({ latitude: 12.345678, longitude: 123.456789 });
    const facts = await readExifFacts(blob());
    expect(facts).toEqual({ takenAt: "1985-04-07T09:00:00", latitude: 12.35, longitude: 123.46 });
    expect(Object.keys(facts).sort()).toEqual(["latitude", "longitude", "takenAt"]);
    const s = JSON.stringify(facts);
    expect(s).not.toContain("12.345678");
    expect(s).not.toContain("123.456789");
  });

  it("DateTimeOriginal がなければ CreateDate を使う", async () => {
    exifrMock.parse.mockResolvedValue({ CreateDate: "2001:12:31 23:59:59" });
    exifrMock.gps.mockResolvedValue(undefined);
    expect(await readExifFacts(blob())).toEqual({ takenAt: "2001-12-31T23:59:59", latitude: null, longitude: null });
  });

  it("exifr が失敗しても例外にせず、欄を null にする", async () => {
    exifrMock.parse.mockRejectedValue(new Error("broken"));
    exifrMock.gps.mockRejectedValue(new Error("broken"));
    expect(await readExifFacts(blob())).toEqual({ takenAt: null, latitude: null, longitude: null });
  });

  it("片方だけの位置は、位置なし", async () => {
    exifrMock.parse.mockResolvedValue(undefined);
    exifrMock.gps.mockResolvedValue({ latitude: 35.1, longitude: undefined });
    expect(await readExifFacts(blob())).toEqual({ takenAt: null, latitude: null, longitude: null });
  });

  it("日時は文字のまま読む（reviveValues: false）", async () => {
    exifrMock.parse.mockResolvedValue({});
    exifrMock.gps.mockResolvedValue(undefined);
    await readExifFacts(blob());
    expect(exifrMock.parse.mock.calls[0]?.[1]).toMatchObject({ reviveValues: false });
  });
});

describe("readExifTagNames: 項目名だけを返し、位置は読まない（開発用の /check）", () => {
  beforeEach(() => exifrMock.parse.mockReset());

  it("gps: false で読み、値ではなく読めた項目名だけを返す", async () => {
    exifrMock.parse.mockResolvedValue({ Make: "X", Model: "Y", latitude: 12.3 });
    expect(await readExifTagNames(blob())).toEqual(["Make", "Model"]);
    expect((exifrMock.parse.mock.calls[0] as any[])[1]).toMatchObject({ gps: false });
    expect((exifrMock.parse.mock.calls[0] as any[])[1].pick).not.toContain("GPSLatitude");
  });

  it("EXIF がないときは空、読めないときは null（分けて見せる）", async () => {
    exifrMock.parse.mockResolvedValueOnce(undefined);
    expect(await readExifTagNames(blob())).toEqual([]);
    exifrMock.parse.mockRejectedValueOnce(new Error("bad"));
    expect(await readExifTagNames(blob())).toBeNull();
  });
});

type Call = { url: string; init: RequestInit };
function stubFetch(responses: (() => Response | Promise<Response>)[]): Call[] {
  const calls: Call[] = [];
  let i = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    return r!();
  });
  return calls;
}
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api: エラーは種類（ErrorKind）だけにする", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("本文の error を種類にする", async () => {
    stubFetch([() => jsonRes(404, { error: "not_demo" })]);
    const err = await api.advanceClock("2026-11-02").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("not_demo");
    expect(err.status).toBe(404);
  });

  it("本文が JSON でなければ、ステータスから決める", async () => {
    stubFetch([() => new Response("<html>oops</html>", { status: 401 })]);
    expect((await api.getFamily().catch((e: unknown) => e)).kind).toBe("unauthorized");
  });

  it("知らない種類の文字列は使わない（サーバーの文を出さない）", async () => {
    stubFetch([() => jsonRes(413, { error: "なにかの日本語の文" })]);
    expect((await api.getFamily().catch((e: unknown) => e)).kind).toBe("too_large");
  });

  it("つながらないときは internal", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("network");
    });
    const err = await api.getFamily().catch((e: unknown) => e);
    expect(err.kind).toBe("internal");
    expect(err.status).toBe(0);
  });

  it("家族に見せる文は words.errors から引く。外のエラー文は出さない", () => {
    expect(errorText(new ApiError("unauthorized", 401))).toBe(words.errors.unauthorized);
    expect(errorText(new Error("TypeError: secret detail"))).toBe(words.errors.internal);
  });

  it("204 は本文を読まない", async () => {
    stubFetch([() => new Response(null, { status: 204 })]);
    await expect(api.startSession("t".repeat(43))).resolves.toBeUndefined();
  });
});

describe("語りを送る流れ（voice.ts）", () => {
  afterEach(() => vi.unstubAllGlobals());
  const target = { photoId: "p-1", entranceId: "e-1", replyToId: null };
  const requestId = "0b3d6c1e-2f4a-4b8c-9d0e-1f2a3b4c5d6e";
  const narration = { id: "n-1" };

  it("声: meta は kind=voice・text=null・requestId つき、audio を付けて /api/narrations に送る", async () => {
    const calls = stubFetch([() => jsonRes(202, { narration })]);
    const audio = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "audio/mp4" });
    await expect(sendVoice(audio, target, requestId)).resolves.toEqual(narration);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/narrations");
    expect(calls[0]!.init.method).toBe("POST");
    const form = calls[0]!.init.body as FormData;
    const meta = JSON.parse(form.get("meta") as string);
    // 長さを渡さなければ null（画面は秒を出さない）
    expect(meta).toEqual({ kind: "voice", text: null, ...target, requestId, durationMs: null });
    const sent = form.get("audio") as File;
    expect(sent.name).toBe("voice.m4a");
    expect(sent.size).toBe(4);
  });

  it("声: 測った長さは整数のミリ秒で送り、測れていない・ありえない値は null にする", async () => {
    const lens: unknown[] = [];
    for (const ms of [13_400.6, 0, -5, Number.NaN, Number.POSITIVE_INFINITY, 2 * 60 * 60_000]) {
      const calls = stubFetch([() => jsonRes(202, { narration })]);
      await sendVoice(new Blob([new Uint8Array([1])], { type: "audio/webm" }), target, requestId, ms);
      lens.push(JSON.parse((calls[0]!.init.body as FormData).get("meta") as string).durationMs);
    }
    expect(lens).toEqual([13_401, null, null, null, null, null]);
  });

  it("話した人の ID は送らない（サーバーが端末の人に決める。0036）", async () => {
    const calls = stubFetch([() => jsonRes(202, { narration }), () => jsonRes(202, { narration })]);
    await sendVoice(new Blob([new Uint8Array([1])], { type: "audio/webm" }), target, requestId);
    await sendText("むかしの話", target, requestId);
    for (const c of calls) {
      const meta = JSON.parse((c.init.body as FormData).get("meta") as string);
      expect(Object.keys(meta)).not.toContain("speakerMemberId");
    }
  });

  it("サーバーの約束（narrationMetaSchema）に合う", async () => {
    const { narrationMetaSchema } = await load("../../src/shared/api");
    const calls = stubFetch([() => jsonRes(202, { narration })]);
    await sendVoice(new Blob([new Uint8Array([1])], { type: "audio/webm" }), target, requestId);
    await sendText("むかしの話", target, requestId);
    for (const c of calls) {
      const meta = JSON.parse((c.init.body as FormData).get("meta") as string);
      expect(narrationMetaSchema.safeParse(meta).success).toBe(true);
    }
    expect((calls[1]!.init.body as FormData).get("audio")).toBeNull();
  });

  it("録音の種類からファイル名を決める（録音済みファイルの種類もそのまま通る）", async () => {
    const cases: [string, string][] = [
      ["audio/webm;codecs=opus", "voice.webm"],
      ["audio/ogg;codecs=opus", "voice.ogg"],
      ["audio/mpeg", "voice.mp3"],
      ["audio/wav", "voice.wav"],
      ["audio/x-m4a", "voice.m4a"],
      ["", "voice.webm"],
    ];
    for (const [type, name] of cases) {
      const calls = stubFetch([() => jsonRes(202, { narration })]);
      await sendVoice(new Blob([new Uint8Array([1])], { type }), target, requestId);
      expect(((calls[0]!.init.body as FormData).get("audio") as File).name).toBe(name);
    }
  });
});
