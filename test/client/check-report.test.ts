// 開発用の確かめページ（/check）の、記録の組み立てと応答の読み取り。
// test/ は tsconfig.worker.json で型を検査するため、src/client は動的 import で読む。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";

const load = (name: string): Promise<any> => import(name);
const { buildReport, pickTimings, extOf, acceptedByNarrations, FIELD_TEMPLATES, UNSPOKEN_KEYWORD } = await load(
  "../../src/client/check/report",
);
const { checkTranscribeFieldNames, checkTranscribeModels } = await load("../../src/shared/check");

// 架空の値だけ
const secretName = "IMG_家族旅行_0001.HEIC";
const lat = 35.512345;
const lng = 139.654321;

function sampleReport(): any {
  return {
    device: { userAgent: "UA-test", screenWidth: 390, innerWidth: 390, devicePixelRatio: 3, at: "2026-11-02" },
    recorderSupport: [
      { type: "audio/webm;codecs=opus", supported: false },
      { type: "audio/mp4", supported: true },
    ],
    photos: [
      {
        picker: "accept-image",
        ext: "heic",
        mime: "image/heic",
        size: 2048,
        takenAt: "1970-08-01T10:00:00",
        hasLocation: true,
        exifTags: ["Make", "Model"],
        resize: { ok: true, width: 1600, height: 1200, size: 1024 },
        // 余計な欄が混ざっても出さない
        name: secretName,
        latitude: lat,
        longitude: lng,
        location: { latitude: 35.51, longitude: 139.65 },
      },
      {
        picker: "no-accept",
        ext: "jpg",
        mime: "image/jpeg",
        size: 1024,
        takenAt: null,
        hasLocation: false,
        exifTags: [],
        resize: { ok: false, error: "UnreadableImageError" },
      },
    ],
    audios: [
      {
        source: "file",
        ext: "m4a",
        type: "audio/mp4",
        size: 4096,
        durationMs: null,
        decodedMs: 3210,
        decodeError: null,
        acceptedByNarrations: true,
        name: "祖母の声.m4a",
      },
    ],
    transcribes: [
      {
        source: "mic",
        model: "gpt-transcribe",
        fields: [["languages[]", "ja"], ["keywords[]", "鶴見川"]],
        httpStatus: 200,
        openaiStatus: 200,
        networkError: null,
        elapsedMs: 1234,
        sentContentType: "audio/mp4",
        acceptedByNarrations: true,
        body: { text: "昭和四十五年の夏に、鶴見川のほとりで撮った写真です。", words: [{ word: "昭和", start: 0, end: 0.4 }] },
      },
    ],
    voices: [{ name: "Kyoko", lang: "ja-JP", localService: true, default: false }],
    memo: "",
  };
}

describe("buildReport: 記録に位置とファイル名を入れない", () => {
  const md = buildReport(sampleReport());

  it("緯度経度（生の値も丸めた値も）が入らない", () => {
    expect(md).not.toContain("35.5");
    expect(md).not.toContain("139.6");
    expect(md).not.toMatch(/latitude|longitude/);
  });

  it("写真・録音のファイル名が入らない（拡張子だけ）", () => {
    expect(md).not.toContain(secretName);
    expect(md).not.toContain("IMG_");
    expect(md).not.toContain("祖母の声");
    expect(md).toContain("| heic |");
    expect(md).toContain("| m4a |");
  });

  it("位置は「あり／なし」だけ、EXIF の有無と縮小の結果を出す", () => {
    expect(md).toMatch(/\| あり \| あり（Make, Model） \|/);
    expect(md).toMatch(/\| なし \| なし \| 失敗 UnreadableImageError \|/);
  });

  it("端末、録音の形式、文字起こし、声を出す", () => {
    expect(md).toContain("UA-test");
    expect(md).toContain("| audio/mp4 | ○ |");
    expect(md).toContain("`keywords[]` = \"鶴見川\"");
    expect(md).toContain("words: 1 個");
    expect(md).toContain("鶴見川のほとり");
    expect(md).toContain("| Kyoko | ja-JP | true | false |");
  });

  it("表の中の | と改行を逃がす", () => {
    const r = sampleReport();
    r.voices = [{ name: "a|b\nc", lang: "ja", localService: false, default: true }];
    expect(buildReport(r)).toContain("| a\\|b c |");
  });

  it("長い本文は切る", () => {
    const r = sampleReport();
    r.transcribes[0].body = "あ".repeat(10_000);
    const out = buildReport(r);
    expect(out).toContain("10000 文字のうち先頭 4000 文字");
    expect(out.length).toBeLessThan(8_000);
  });

  it("EXIF が読めなかったときは「読めない」（なしと分ける）", () => {
    const r = sampleReport();
    r.photos[1].exifTags = null;
    expect(buildReport(r)).toMatch(/\| なし \| 読めない \| 失敗/);
  });

  it("何もないときも組み立てられる", () => {
    const r = sampleReport();
    r.photos = [];
    r.audios = [];
    r.transcribes = [];
    r.voices = [];
    expect(buildReport(r)).toContain("（なし）");
  });
});

describe("pickTimings: 本文から words / segments を拾う", () => {
  it("words と segments の始めの数個を、言葉・start・end で返す", () => {
    const body = {
      words: Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 0.5 })),
      segments: [{ text: "一つ目", start: 0, end: 2.5, id: 0 }],
    };
    const t = pickTimings(body, 3);
    expect(t.words).toEqual([
      { text: "w0", start: 0, end: 0.5 },
      { text: "w1", start: 1, end: 1.5 },
      { text: "w2", start: 2, end: 2.5 },
    ]);
    expect(t.wordCount).toBe(20);
    expect(t.segments).toEqual([{ text: "一つ目", start: 0, end: 2.5 }]);
    expect(t.segmentCount).toBe(1);
  });

  it("なければ null。本文が文字や null でも落ちない", () => {
    expect(pickTimings({ text: "x" })).toEqual({ words: null, segments: null, wordCount: 0, segmentCount: 0 });
    expect(pickTimings("error text").words).toBeNull();
    expect(pickTimings(null).segments).toBeNull();
  });

  it("形の崩れた要素は、読めるところだけ拾う", () => {
    const t = pickTimings({ words: [null, { word: 1, start: "0" }] });
    expect(t.words).toEqual([
      { text: "null", start: null, end: null },
      { text: "1", start: null, end: null },
    ]);
  });
});

describe("小さな関数とひな形", () => {
  it("extOf は拡張子だけを小文字で返す", () => {
    expect(extOf("a/b.HEIC")).toBe("heic");
    expect(extOf("noext")).toBe("");
    expect(extOf(".hidden")).toBe("");
    expect(extOf("x.")).toBe("");
  });

  it("acceptedByNarrations は語りの受け取りと同じ判定", () => {
    expect(acceptedByNarrations("audio/mp4")).toBe(true);
    expect(acceptedByNarrations("audio/webm;codecs=opus")).toBe(true);
    expect(acceptedByNarrations("")).toBe(false);
    expect(acceptedByNarrations("video/mp4")).toBe(false);
  });

  it("ひな形の欄の名前とモデルは、約束の一覧にある", () => {
    for (const t of FIELD_TEMPLATES) {
      expect(checkTranscribeModels).toContain(t.model);
      for (const [name] of t.fields) expect(checkTranscribeFieldNames).toContain(name);
    }
    expect(checkTranscribeFieldNames).toContain(UNSPOKEN_KEYWORD[0]);
  });

  it("「本番と同じ」は、本番の文字起こしが実際に送る欄と同じ（keywords は例の呼ばれ方）", async () => {
    const { createOpenAITranscriber, TRANSCRIBE_MODEL } = await load("../../src/server/adapters/openai-transcriber");
    const prod = FIELD_TEMPLATES.find((t: any) => t.label === "本番と同じ");
    const keywords = prod.fields.filter(([n]: [string]) => n === "keywords[]").map(([, v]: [string, string]) => v);
    let sent: [string, string][] = [];
    const fakeFetch = async (_url: string, init: { body: FormData }) => {
      sent = [...init.body.entries()]
        .filter(([n]) => n !== "file" && n !== "model")
        .map(([n, v]) => [n, String(v)] as [string, string]);
      return new Response(JSON.stringify({ text: "x" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await createOpenAITranscriber("k", fakeFetch).transcribe({ audio: new Blob(["a"], { type: "audio/webm" }), dialectRegion: null, keywords });
    expect(prod.model).toBe(TRANSCRIBE_MODEL);
    expect(prod.fields).toEqual(sent);
  });
});
