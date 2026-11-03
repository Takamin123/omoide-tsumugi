// 問いかけの読み上げ（0019「採るときの形」、0027、0029）。
// - OpenAI の Speaker（偽の fetch）: 送るもの、応答の検証、再試行と締め切り
// - 毎朝の処理（偽の Speaker と D1）: 音声ができる、失敗しても入り口が出る、冪等、固定の入り口には作らない、
//   合言葉なしでは取れない・ほかの家族は 404、ログに文が出ない
// npm test では本物の API を呼ばない。文はすべて架空。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  SPEECH_MAX_RETRY_AFTER_MS,
  SPEECH_RETRY_WAIT_MS,
  createOpenAISpeaker,
} from "../src/server/adapters/openai-speech";
import { notConfiguredClaude } from "../src/server/core/claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeClient, SpeakInput, SpeakResult, Speaker } from "../src/server/core/ports";
import { QUESTION_SPEECH, ensureQuestionAudio } from "../src/server/core/question-speech";
import {
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  makeTestApp,
  onlyPurpose,
  postForm,
  startD1,
  type FakeClaudeReply,
  type TestApp,
} from "./helpers";

/** mp3 の頭（ID3）を持つ、架空の小さなバイト列（本物の音声ではない） */
const fakeMp3 = (n = 0) => new Uint8Array([0x49, 0x44, 0x33, 4, 0, n, 1, 2, 3]);
const QUESTION = "この日の畑のことを、聞かせてください";

// ---- OpenAI の Speaker ----

type Reply = { status: number; body?: Uint8Array | string; contentType?: string; headers?: Record<string, string> } | "timeout" | "network";

function speakerWith(replies: Reply[], opts: { now?: () => number } = {}) {
  const queue = [...replies];
  const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    const r = queue.shift() ?? { status: 500 };
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "timeout") throw new DOMException("timed out", "TimeoutError");
    return new Response(r.body ?? JSON.stringify({ error: { message: "fake" } }), {
      status: r.status,
      headers: { "content-type": r.contentType ?? (r.status === 200 ? "audio/mpeg" : "application/json"), ...(r.headers ?? {}) },
    });
  }) as typeof fetch;
  const speaker = createOpenAISpeaker("fake-openai-key", {
    fetch: fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { speaker, requests, sleeps };
}

const input = (deadline?: number): SpeakInput => ({ text: QUESTION, settings: QUESTION_SPEECH, ...(deadline !== undefined ? { deadline } : {}) });

describe("createOpenAISpeaker", () => {
  it("一か所の設定どおりに送り、音声を返す", async () => {
    const s = speakerWith([{ status: 200, body: fakeMp3() }]);
    const r = await s.speaker.speak(input());
    expect(r).toMatchObject({ ok: true, contentType: "audio/mpeg", attempts: 1 });
    expect(r.ok && [...r.audio]).toEqual([...fakeMp3()]);
    expect(s.requests).toHaveLength(1);
    expect(s.requests[0]!.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(s.requests[0]!.auth).toBe("Bearer fake-openai-key");
    expect(s.requests[0]!.body).toEqual({
      model: "gpt-4o-mini-tts",
      input: QUESTION,
      voice: "marin",
      instructions: QUESTION_SPEECH.instructions,
      speed: 1.0,
      response_format: "mp3",
    });
  });

  it("5xx・接続の失敗・時間切れは 1 回だけ、2 秒待ってやり直す", async () => {
    for (const first of [{ status: 503 }, "network", "timeout"] as Reply[]) {
      const s = speakerWith([first, { status: 200, body: fakeMp3() }]);
      expect(await s.speaker.speak(input())).toMatchObject({ ok: true, attempts: 2 });
      expect(s.sleeps).toEqual([SPEECH_RETRY_WAIT_MS]);
    }
    const s = speakerWith([{ status: 500 }, { status: 500 }, { status: 200, body: fakeMp3() }]);
    expect(await s.speaker.speak(input())).toEqual({ ok: false, reason: "upstream", attempts: 2 });
    expect(s.requests).toHaveLength(2);
  });

  it("429 は Retry-After に従う（最長 30 秒）", async () => {
    const a = speakerWith([{ status: 429, headers: { "retry-after": "7" } }, { status: 200, body: fakeMp3() }]);
    expect(await a.speaker.speak(input())).toMatchObject({ ok: true });
    expect(a.sleeps).toEqual([7_000]);
    const b = speakerWith([{ status: 429, headers: { "retry-after": "120" } }, { status: 429 }]);
    expect(await b.speaker.speak(input())).toEqual({ ok: false, reason: "rate_limited", attempts: 2 });
    expect(b.sleeps).toEqual([SPEECH_MAX_RETRY_AFTER_MS]);
  });

  it("429 以外の 4xx と認証の失敗はやり直さない", async () => {
    const a = speakerWith([{ status: 400 }, { status: 200, body: fakeMp3() }]);
    expect(await a.speaker.speak(input())).toEqual({ ok: false, reason: "rejected", attempts: 1 });
    const b = speakerWith([{ status: 401 }]);
    expect(await b.speaker.speak(input())).toEqual({ ok: false, reason: "auth", attempts: 1 });
    expect(a.sleeps.concat(b.sleeps)).toEqual([]);
  });

  it("音声でない応答・空・mp3 の頭でないものは壊れた応答（やり直して、だめなら失敗）", async () => {
    for (const bad of [
      { status: 200, body: JSON.stringify({ ok: true }), contentType: "application/json" },
      { status: 200, body: new Uint8Array([]) },
      { status: 200, body: new Uint8Array([1, 2, 3, 4]) },
    ] as Reply[]) {
      const s = speakerWith([bad, bad]);
      expect(await s.speaker.speak(input())).toEqual({ ok: false, reason: "invalid_response", attempts: 2 });
    }
  });

  it("締め切りまでの残りが短ければ送らない。再試行が締め切りに収まらなければ、やり直さない", async () => {
    const clock = 1_000_000;
    const a = speakerWith([{ status: 200, body: fakeMp3() }], { now: () => clock });
    expect(await a.speaker.speak(input(clock + 1_000))).toEqual({ ok: false, reason: "past_deadline", attempts: 0 });
    expect(a.requests).toHaveLength(0);

    const b = speakerWith([{ status: 500 }, { status: 200, body: fakeMp3() }], { now: () => clock });
    expect(await b.speaker.speak(input(clock + 6_000))).toEqual({ ok: false, reason: "upstream", attempts: 1 });
    expect(b.requests).toHaveLength(1);
    expect(b.sleeps).toEqual([]);
  });
});

// ---- 毎朝の処理につないだとき（D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

/** 偽の Speaker。台本どおりに返し、尽きたら成功。呼ばれた入力を覚える */
function fakeSpeaker(script: SpeakResult[] = []): Speaker & { calls: SpeakInput[] } {
  const queue = [...script];
  const calls: SpeakInput[] = [];
  return {
    calls,
    async speak(i) {
      calls.push(i);
      return queue.shift() ?? { ok: true, audio: fakeMp3(calls.length), contentType: "audio/mpeg", attempts: 1 };
    },
  };
}

const NOW = new Date("2026-11-02T18:00:00Z"); // 日本時間 11/3 3:00

/** cookie は孫（家族の画面の人）、elderCookie は祖母の端末 */
type Setup = {
  t: TestApp;
  familyId: string;
  cookie: string;
  elderCookie: string;
  elder: string;
  grandchild: string;
  speaker: ReturnType<typeof fakeSpeaker>;
};

/** 祖母と孫、孫の写真一枚と文字の語り。Claude は二人とも通る応答を返す（claude: false なら固定の入り口） */
async function setup(opts: { speaker?: ReturnType<typeof fakeSpeaker> | null; claude?: boolean; isDemo?: boolean } = {}): Promise<Setup> {
  let inner: ClaudeClient = notConfiguredClaude;
  const late: ClaudeClient = {
    call: (req) => inner.call(req),
    createBatch: (req) => inner.createBatch(req),
    getBatch: (id) => inner.getBatch(id),
    getBatchResults: (req) => inner.getBatchResults(req),
  };
  const speaker = opts.speaker === undefined ? fakeSpeaker() : opts.speaker;
  const t = makeTestApp(d1, { claude: opts.claude === false ? notConfiguredClaude : late, ...(speaker ? { speaker } : {}) });
  const f = await createFamily(t, opts.isDemo ?? false);
  // 最初の一人は家族の画面の人（0036）
  const g = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const e = await addMember(t, g.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const elder = e.id;
  const grandchild = g.id;
  const p = await addPhoto(t, g.cookie, 1);
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId: p.id, entranceId: null, replyToId: null, text: "架空の畑の語り。" }));
  await postForm(t, "/api/narrations", form, g.cookie);
  await t.flush();
  const good: FakeClaudeReply = {
    kind: "json",
    value: { receiver_present: "unknown", reason: "架空の理由", photo_id: p.id, focus: null, quote: null, question: QUESTION },
    model: "claude-sonnet-5-5",
  };
  inner = onlyPurpose(fakeClaude({ replies: [good, good] }).claude, "entrance");
  return { t, familyId: f.familyId, cookie: g.cookie, elderCookie: e.cookie, elder, grandchild, speaker: speaker ?? fakeSpeaker() };
}

/** cookie の人の今日の入り口（既定は祖母の端末） */
const todayOf = async (s: Setup, cookie = s.elderCookie) => {
  const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: cookie } });
  return ((await res.json()) as { entrance: { id: string; question: string | null; questionAudioUrl: string | null } }).entrance;
};
const audioRows = async (familyId: string) =>
  (
    await d1
      .prepare("SELECT member_id, kind, question_audio_key AS k, question_audio_model AS m, question_audio_voice AS v FROM entrances WHERE family_id = ?")
      .bind(familyId)
      .all<{ member_id: string; kind: string; k: string | null; m: string | null; v: string | null }>()
  ).results;

describe("毎朝の処理: 問いかけの読み上げ", () => {
  it("Claude の入り口に音声を作り、家族ごとの鍵で保存する。合言葉を確かめてから private, no-store で返す", async () => {
    const s = await setup();
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ byClaude: 2, speech: { made: 2, failed: [] } });
    expect(s.speaker.calls).toHaveLength(2);
    expect(s.speaker.calls[0]).toMatchObject({ text: QUESTION, settings: QUESTION_SPEECH, traceId: summary.runId });
    expect(typeof s.speaker.calls[0]!.deadline).toBe("number");

    const rows = await audioRows(s.familyId);
    for (const r of rows) {
      expect(r).toMatchObject({ kind: "claude", m: "gpt-4o-mini-tts", v: "marin" });
      expect(r.k).toMatch(new RegExp(`^families/${s.familyId}/speech/[0-9a-f-]+-[0-9a-f-]+\\.mp3$`));
    }
    expect(s.t.store.keys().filter((k) => k.includes("/speech/")).sort()).toEqual(rows.map((r) => r.k).sort());

    s.t.setNow(NOW);
    const e = await todayOf(s);
    expect(e.questionAudioUrl).toBe(`/api/entrances/${e.id}/question-audio`);
    // 応答に鍵・モデル・声を出さない
    const body = JSON.stringify(e);
    for (const secret of ["families/", "speech/", "gpt-4o-mini-tts", "marin"]) expect(body).not.toContain(secret);

    const ok = await s.t.app.request(e.questionAudioUrl!, { headers: { Cookie: s.cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await ok.arrayBuffer()).slice(0, 3)).toEqual(new Uint8Array([0x49, 0x44, 0x33]));

    // 合言葉なしは 401、ほかの家族の合言葉では 404
    const none = await s.t.app.request(e.questionAudioUrl!);
    expect(none.status).toBe(401);
    const other = await createFamily(s.t);
    const otherMember = await addMember(s.t, other.cookie);
    const cross = await s.t.app.request(e.questionAudioUrl!, { headers: { Cookie: otherMember.cookie } });
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual({ error: "not_found" });
  });

  it("作るのが失敗しても入り口は出る（音声の URL は null）。保存もしない", async () => {
    const speaker = fakeSpeaker([
      { ok: false, reason: "upstream", attempts: 2 },
      { ok: false, reason: "timeout", attempts: 2 },
    ]);
    const s = await setup({ speaker });
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ created: 2, byClaude: 2, failed: [], speech: { made: 0 } });
    expect(summary.speech.failed.map((f) => f.reason).sort()).toEqual(["timeout", "upstream"]);
    expect(s.t.store.keys().filter((k) => k.includes("/speech/"))).toEqual([]);
    s.t.setNow(NOW);
    const e = await todayOf(s);
    expect(e).toMatchObject({ question: QUESTION, questionAudioUrl: null });
    expect((await s.t.app.request(`/api/entrances/${e.id}/question-audio`, { headers: { Cookie: s.cookie } })).status).toBe(404);
  });

  it("保存先が落ちても、入り口づくりは止めない（音声の失敗に数えるだけ）", async () => {
    const s = await setup();
    const put = vi.spyOn(s.t.store, "put").mockRejectedValue(new Error("fake"));
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(put).toHaveBeenCalled();
    expect(summary).toMatchObject({ created: 2, byClaude: 2, failed: [], speech: { made: 0 } });
    expect(summary.speech.failed).toHaveLength(2);
  });

  it("冪等: 同じ日にもう一度呼んでも、音声のある入り口には作らない", async () => {
    const s = await setup();
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const before = (await audioRows(s.familyId)).map((r) => r.k);
    const again = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(again).toMatchObject({ existing: 2, speech: { made: 0, failed: [] } });
    expect(s.speaker.calls).toHaveLength(2);
    expect((await audioRows(s.familyId)).map((r) => r.k)).toEqual(before);
    expect(s.t.store.keys().filter((k) => k.includes("/speech/"))).toHaveLength(2);
  });

  it("失敗した入り口は、まだ見せていなければ同じ日の再実行で作る。一度見せた入り口には後から足さない", async () => {
    const speaker = fakeSpeaker([
      { ok: false, reason: "upstream", attempts: 2 },
      { ok: false, reason: "upstream", attempts: 2 },
    ]);
    const s = await setup({ speaker });
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    // 祖母だけが開いた
    s.t.setNow(NOW);
    await todayOf(s);
    const again = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(again.speech).toEqual({ made: 1, failed: [] });
    const rows = await audioRows(s.familyId);
    expect(rows.find((r) => r.member_id === s.elder)!.k).toBeNull();
    expect(rows.find((r) => r.member_id === s.grandchild)!.k).not.toBeNull();
  });

  it("固定の入り口には作らない", async () => {
    const s = await setup({ claude: false });
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ created: 2, byClaude: 0, speech: { made: 0, failed: [] } });
    expect(s.speaker.calls).toEqual([]);
    expect((await audioRows(s.familyId)).every((r) => r.kind === "fixed" && r.k === null)).toBe(true);
    // 直接呼んでも、データベースが固定の入り口には入れない
    const e = (await audioRows(s.familyId))[0]!;
    const id = (await d1.prepare("SELECT id FROM entrances WHERE family_id = ? AND member_id = ?").bind(s.familyId, e.member_id).first<{ id: string }>())!.id;
    expect(await s.t.deps.repos.entrances.setQuestionAudio(s.familyId, id, { key: "k", model: "m", voice: "v" })).toBe(false);
  });

  it("キーがなければ（speaker が null）作らない。入り口はそのまま", async () => {
    const s = await setup({ speaker: null });
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ byClaude: 2, speech: { made: 0, failed: [] } });
    expect((await audioRows(s.familyId)).every((r) => r.k === null)).toBe(true);
  });

  it("デモの時計のボタンでも、同じ関数を通って音声ができる", async () => {
    const s = await setup({ isDemo: true });
    for (let i = 0; i < 3; i++) {
      const res = await s.t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: s.cookie } });
      expect(res.status).toBe(200);
    }
    expect(s.speaker.calls).toHaveLength(2);
    expect((await audioRows(s.familyId)).every((r) => r.k !== null)).toBe(true);
  });

  it("ログに問いかけの文を出さない（ID・モデル・声・長さ・所要時間だけ）", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    const speaker = fakeSpeaker([{ ok: false, reason: "rejected", attempts: 1 }]);
    const s = await setup({ speaker });
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const speech = lines.filter((l) => l.includes('"question_speech"')).map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(speech).toHaveLength(2);
    const ok = speech.find((l) => l.ok === true)!;
    expect(Object.keys(ok).sort()).toEqual(["attempts", "bytes", "entranceId", "event", "familyId", "model", "ms", "ok", "traceId", "voice"]);
    expect(speech.find((l) => l.ok === false)).toMatchObject({ reason: "rejected" });
    for (const l of lines) {
      expect(l).not.toContain(QUESTION);
      expect(l).not.toContain(QUESTION_SPEECH.instructions);
      expect(l).not.toContain("/speech/");
    }
  });

  it("音声を保存した後に更新が落ちたら、保存した音声を消してから投げる", async () => {
    const s = await setup();
    await runMorning({ ...s.t.deps, speaker: null }, NOW, { familyId: s.familyId });
    const e = (await s.t.deps.repos.entrances.get(s.familyId, s.elder, "2026-11-03"))!;
    vi.spyOn(s.t.deps.repos.entrances, "setQuestionAudio").mockRejectedValue(new Error("fake_db"));
    await expect(ensureQuestionAudio(s.t.deps, e)).rejects.toThrow("fake_db");
    expect(s.t.store.keys().filter((k) => k.includes("/speech/"))).toEqual([]);
  });
});
