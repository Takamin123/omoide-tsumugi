// 開発用の確かめページ（/check）の、問いかけの読み上げ（0019 の試し）。偽の fetch だけを使う。
// test/ は tsconfig.worker.json で型を検査するため、src/client は動的 import で読む。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";

const load = (name: string): Promise<any> => import(name);
const { requestSpeech } = await load("../../src/client/check/speech");
const { buildReport, QUESTION_SAMPLES, TTS_DEFAULT_INSTRUCTIONS, TTS_DISCLOSURE } = await load("../../src/client/check/report");
const { checkSpeechParamsSchema, checkSpeechVoices, checkSpeechModels } = await load("../../src/shared/check");

const params = {
  model: "gpt-4o-mini-tts",
  input: "この日のことで、心に残っていることを聞かせてください。",
  voice: "marin",
  instructions: "ゆっくり",
  speed: 1,
  response_format: "mp3",
};

/** 時計を 0 → 250 と進める */
function clock() {
  let n = 0;
  return () => {
    const v = n;
    n += 250;
    return v;
  };
}

describe("requestSpeech", () => {
  it("音声なら Blob と、大きさ・時間・type を返す。送るのは JSON の params だけ", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array(10), { headers: { "content-type": "audio/mpeg", "x-check-speech": "audio", "x-check-elapsed-ms": "120" } }),
    );
    const { row, audio } = await requestSpeech(params, fetchImpl, clock());
    expect(fetchImpl).toHaveBeenCalledWith("/api/check/speech", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
    expect(JSON.parse((fetchImpl.mock.calls[0] as any)[1].body)).toEqual(params);
    expect(audio.size).toBe(10);
    expect(row).toMatchObject({ ok: true, httpStatus: 200, openaiStatus: 200, serverMs: 120, totalMs: 250, size: 10, contentType: "audio/mpeg" });
  });

  it("OpenAI の失敗は、その status と本文を拾う", async () => {
    const failure = { status: 400, networkError: null, elapsedMs: 80, body: { error: { message: "bad voice" } } };
    const fetchImpl = vi.fn(async () => Response.json(failure, { headers: { "x-check-speech": "failure" } }));
    const { row, audio } = await requestSpeech(params, fetchImpl, clock());
    expect(audio).toBeNull();
    expect(row).toMatchObject({ ok: false, httpStatus: 200, openaiStatus: 400, serverMs: 80, size: null, body: failure.body });
  });

  it("アプリの断り（401、404）は、HTTP の status と本文のまま", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 }));
    const { row, audio } = await requestSpeech(params, fetchImpl, clock());
    expect(audio).toBeNull();
    expect(row).toMatchObject({ ok: false, httpStatus: 404, openaiStatus: null, serverMs: null, body: { error: "not_found" } });
  });
});

describe("例文と初期値", () => {
  it("例文は 0017 の問いかけの検査に合う（60 字以内、末尾、禁止語なし、文は一つ）", () => {
    const banned = ["覚えて", "ご記憶", "思い出せ", "分かりますか", "わかりますか", "知っていますか", "誰ですか", "どこですか", "いつですか", "何年", "正しい", "当て", "クイズ", "写真を", "送って", "見せて", "撮って", "AI", "私", "分析", "！"];
    expect(QUESTION_SAMPLES.length).toBeGreaterThanOrEqual(2);
    for (const q of QUESTION_SAMPLES as string[]) {
      expect(q.length).toBeLessThanOrEqual(60);
      expect(q.replace(/。$/, "")).toMatch(/(か|か？|ください)$/);
      expect(q.replace(/。$/, "")).not.toContain("。");
      for (const b of banned) expect(q).not.toContain(b);
      expect(checkSpeechParamsSchema.safeParse({ ...params, input: q }).success).toBe(true);
    }
  });

  it("初期の指示と明示の文、声とモデルの一覧", () => {
    expect(TTS_DISCLOSURE).toBe("AI の声で読みます");
    expect(TTS_DEFAULT_INSTRUCTIONS).toContain("ゆっくり");
    expect(TTS_DEFAULT_INSTRUCTIONS).toContain("日本語");
    expect(checkSpeechModels).toEqual(["gpt-4o-mini-tts", "tts-1", "tts-1-hd"]);
    expect([...checkSpeechVoices].sort()).toEqual(
      ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"].sort(),
    );
  });
});

describe("記録に読み上げを入れる", () => {
  const base = {
    device: { userAgent: "UA", screenWidth: 1, innerWidth: 1, devicePixelRatio: 1, at: "x" },
    recorderSupport: [],
    photos: [],
    audios: [],
    transcribes: [],
    voices: [],
    memo: "",
  };

  it("ttsRuns がないときも組み立てられる", () => {
    expect(buildReport(base)).toContain("## 問いかけの読み上げ（OpenAI）");
  });

  it("設定と結果を表にし、失敗のときは本文を入れる", () => {
    const md = buildReport({
      ...base,
      ttsRuns: [
        { params, httpStatus: 200, ok: true, openaiStatus: 200, networkError: null, serverMs: 120, totalMs: 300, size: 2048, contentType: "audio/mpeg", body: null },
        { params: { ...params, model: "tts-1", instructions: "" }, httpStatus: 200, ok: false, openaiStatus: 400, networkError: null, serverMs: 50, totalMs: 90, size: null, contentType: null, body: { error: "bad" } },
      ],
    });
    expect(md).toContain("| 1 | gpt-4o-mini-tts | marin | mp3 | 1 | 音声 | 120 ms | 300 ms | 2 KB | audio/mpeg |");
    expect(md).toContain("失敗 HTTP 200 / OpenAI 400");
    expect(md).toContain(`- 文: ${params.input}`);
    expect(md).toContain("- 声への指示: （送らない）");
    expect(md).toContain('"error": "bad"');
  });
});
