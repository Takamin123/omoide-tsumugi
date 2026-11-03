// qa: 問いかけの読み上げ（0029）の境界。question-speech.test.ts で見ていないところを足す。
// - 毎朝の処理の締め切り（9 分）が、本物の Speaker の「送らない」判断まで届くか
// - 音声を作っている間に家族が開いた（shown_at が入った）とき: データベースに入れず、保存した音声を消す
// - 保存した問いかけが検査を通らなければ、読まない
// - データベースの更新の条件（音声がある・見せた・ほかの家族）
// - 音声の取り出し口: ない入り口、保存先に実体がないとき
// - Speaker の応答の検証の境界（大きさの申告、content-type の付け足し、ID3 なしの mp3）
// npm test では本物の API を呼ばない。文・家族はすべて架空。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SPEECH_MAX_AUDIO_BYTES, createOpenAISpeaker } from "../src/server/adapters/openai-speech";
import { notConfiguredClaude } from "../src/server/core/claude";
import { MORNING_SPEECH_DEADLINE_MS, runMorning } from "../src/server/core/morning";
import type { ClaudeClient, EntranceRow, SpeakInput, SpeakResult, Speaker } from "../src/server/core/ports";
import { QUESTION_SPEECH, ensureQuestionAudio } from "../src/server/core/question-speech";
import {
  addMember,
  addPhoto,
  cookieOf,
  createFamily,
  fakeClaude,
  makeTestApp,
  onlyPurpose,
  postForm,
  startD1,
  type FakeClaudeReply,
  type TestApp,
} from "./helpers";

const fakeMp3 = (n = 0) => new Uint8Array([0x49, 0x44, 0x33, 4, 0, n, 1, 2, 3]);
const QUESTION = "この日の川原のことを、聞かせてください";
const NOW = new Date("2026-11-02T18:00:00Z");

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

function fakeSpeaker(onSpeak?: (i: SpeakInput) => Promise<void>, script: SpeakResult[] = []): Speaker & { calls: SpeakInput[] } {
  const queue = [...script];
  const calls: SpeakInput[] = [];
  return {
    calls,
    async speak(i) {
      calls.push(i);
      if (onSpeak) await onSpeak(i);
      return queue.shift() ?? { ok: true, audio: fakeMp3(calls.length), contentType: "audio/mpeg", attempts: 1 };
    },
  };
}

/** cookie は孫（家族の画面の人）、elderCookie は祖母の端末 */
type Setup = { t: TestApp; familyId: string; cookie: string; elderCookie: string; elder: string; grandchild: string };

async function setup(speaker: Speaker | null): Promise<Setup> {
  let inner: ClaudeClient = notConfiguredClaude;
  const late: ClaudeClient = {
    call: (req) => inner.call(req),
    createBatch: (req) => inner.createBatch(req),
    getBatch: (id) => inner.getBatch(id),
    getBatchResults: (req) => inner.getBatchResults(req),
  };
  const t = makeTestApp(d1, { claude: late, ...(speaker ? { speaker } : {}) });
  const f = await createFamily(t);
  // 最初の一人は家族の画面の人（0036）
  const g = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空の孫" });
  const e = await addMember(t, g.cookie, { role: "elder", relation: "祖母", calledAs: "架空のおばあ" });
  const elder = e.id;
  const grandchild = g.id;
  const p = await addPhoto(t, g.cookie, 7);
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId: p.id, entranceId: null, replyToId: null, text: "架空の川原の語り。" }));
  await postForm(t, "/api/narrations", form, g.cookie);
  await t.flush();
  const good: FakeClaudeReply = {
    kind: "json",
    value: { reason: "架空の理由", photo_id: p.id, focus: null, quote: null, question: QUESTION },
    model: "claude-sonnet-5-5",
  };
  inner = onlyPurpose(fakeClaude({ replies: [good, good] }).claude, "entrance");
  return { t, familyId: f.familyId, cookie: g.cookie, elderCookie: e.cookie, elder, grandchild };
}

const rowsOf = async (familyId: string) =>
  (
    await d1
      .prepare("SELECT id, member_id, kind, question_audio_key AS k, shown_at FROM entrances WHERE family_id = ?")
      .bind(familyId)
      .all<{ id: string; member_id: string; kind: string; k: string | null; shown_at: number | null }>()
  ).results;

const speechKeys = (t: TestApp) => t.store.keys().filter((k) => k.includes("/speech/"));

/** 本物の Speaker に偽の fetch をつなぐ。now をずらして、毎朝の処理の始まりから時間がたったことにする */
function realSpeakerShifted(shiftMs: number) {
  const requests: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(fakeMp3(), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as typeof fetch;
  const speaker = createOpenAISpeaker("fake-openai-key", { fetch: fetchImpl, sleep: async () => {}, now: () => Date.now() + shiftMs });
  return { speaker, requests };
}

describe("qa: 毎朝の処理の締め切り（9 分）", () => {
  it("Speaker に渡す締め切りは、処理の始まりから 9 分", async () => {
    const speaker = fakeSpeaker();
    const s = await setup(speaker);
    const before = Date.now();
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const after = Date.now();
    expect(speaker.calls).toHaveLength(2);
    for (const c of speaker.calls) {
      expect(c.deadline).toBeGreaterThanOrEqual(before + MORNING_SPEECH_DEADLINE_MS);
      expect(c.deadline).toBeLessThanOrEqual(after + MORNING_SPEECH_DEADLINE_MS);
    }
  });

  it("締め切りを過ぎていたら送らない。入り口は出て、音声の URL は null", async () => {
    const { speaker, requests } = realSpeakerShifted(MORNING_SPEECH_DEADLINE_MS + 60_000);
    const s = await setup(speaker);
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(requests).toEqual([]);
    expect(summary).toMatchObject({ created: 2, byClaude: 2, failed: [], speech: { made: 0 } });
    expect(summary.speech.failed.map((f) => f.reason)).toEqual(["past_deadline", "past_deadline"]);
    expect(speechKeys(s.t)).toEqual([]);
    s.t.setNow(NOW);
    const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elderCookie } });
    const e = ((await res.json()) as { entrance: { question: string; questionAudioUrl: string | null } }).entrance;
    expect(e).toMatchObject({ question: QUESTION, questionAudioUrl: null });
  });

  it("締め切りまで 5 秒を切っていたら送らない。まだ余裕があれば送って作る", async () => {
    const tight = realSpeakerShifted(MORNING_SPEECH_DEADLINE_MS - 2_000);
    const a = await setup(tight.speaker);
    const sa = await runMorning(a.t.deps, NOW, { familyId: a.familyId });
    expect(tight.requests).toEqual([]);
    expect(sa.speech.made).toBe(0);

    const room = realSpeakerShifted(MORNING_SPEECH_DEADLINE_MS - 120_000);
    const b = await setup(room.speaker);
    const sb = await runMorning(b.t.deps, NOW, { familyId: b.familyId });
    expect(room.requests).toHaveLength(2);
    expect(sb.speech).toEqual({ made: 2, failed: [] });
  });
});

describe("qa: 作っている間に家族が開いた", () => {
  it("データベースに入れず、保存した音声を消す。失敗にも作ったにも数えない", async () => {
    let familyId = "";
    const speaker = fakeSpeaker(async () => {
      // 読み上げを待っている間に、家族が画面を開いた（shown_at が入る）
      await d1.prepare("UPDATE entrances SET shown_at = ? WHERE family_id = ?").bind(Date.now(), familyId).run();
    });
    const s = await setup(speaker);
    familyId = s.familyId;
    const del = vi.spyOn(s.t.store, "delete");
    const summary = await runMorning(s.t.deps, NOW, { familyId });
    expect(speaker.calls).toHaveLength(2);
    expect(summary.speech).toEqual({ made: 0, failed: [] });
    expect(del).toHaveBeenCalledTimes(2);
    expect(speechKeys(s.t)).toEqual([]);
    expect((await rowsOf(familyId)).every((r) => r.k === null)).toBe(true);
  });
});

describe("qa: ensureQuestionAudio の直接の境界", () => {
  const base = (over: Partial<EntranceRow>): EntranceRow =>
    ({
      id: "e-fake",
      familyId: "f-fake",
      memberId: "m-fake",
      forDate: "2026-11-03",
      kind: "claude",
      photoId: "p-fake",
      question: QUESTION,
      questionAudioKey: null,
      questionAudioModel: null,
      questionAudioVoice: null,
      shownAt: null,
      createdAt: 0,
      ...over,
    }) as EntranceRow;

  it("保存した問いかけが検査を通らなければ、読まない（試す問いかけ・長すぎ・空）", async () => {
    const speaker = fakeSpeaker();
    const t = makeTestApp(d1, { speaker });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    for (const q of ["この日のこと、覚えていますか？", "あ".repeat(500), ""]) {
      const r = await ensureQuestionAudio(t.deps, base({ question: q }));
      expect(r).toEqual({ status: "failed", reason: "question_check" });
    }
    expect(speaker.calls).toEqual([]);
    for (const l of logs) expect(l).not.toContain("覚えていますか");
  });

  it("キーなし・固定・もうある・もう見せた、は読まない", async () => {
    const speaker = fakeSpeaker();
    const t = makeTestApp(d1, { speaker });
    const none = makeTestApp(d1);
    expect(await ensureQuestionAudio(none.deps, base({}))).toEqual({ status: "skipped", why: "not_configured" });
    expect(await ensureQuestionAudio(t.deps, base({ kind: "fixed", question: null }))).toEqual({ status: "skipped", why: "not_claude" });
    expect(await ensureQuestionAudio(t.deps, base({ questionAudioKey: "families/x/speech/y.mp3" }))).toEqual({ status: "skipped", why: "exists" });
    expect(await ensureQuestionAudio(t.deps, base({ shownAt: 1 }))).toEqual({ status: "skipped", why: "shown" });
    expect(speaker.calls).toEqual([]);
  });
});

describe("qa: setQuestionAudio の更新の条件", () => {
  it("音声がある・見せた・ほかの家族の ID では入れない", async () => {
    const s = await setup(null);
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const [a, b] = await rowsOf(s.familyId);
    const repo = s.t.deps.repos.entrances;
    const audio = { key: `families/${s.familyId}/speech/x.mp3`, model: "m", voice: "v" };

    // ほかの家族の ID を付けても入らない
    const other = await createFamily(s.t);
    expect(await repo.setQuestionAudio(other.familyId, a!.id, audio)).toBe(false);
    // 一度目は入る、二度目は入らない（上書きしない）
    expect(await repo.setQuestionAudio(s.familyId, a!.id, audio)).toBe(true);
    expect(await repo.setQuestionAudio(s.familyId, a!.id, { ...audio, key: "families/x/speech/other.mp3" })).toBe(false);
    expect((await rowsOf(s.familyId)).find((r) => r.id === a!.id)!.k).toBe(audio.key);
    // 見せた入り口には入らない
    await repo.markShown(s.familyId, b!.id, Date.now());
    expect(await repo.setQuestionAudio(s.familyId, b!.id, audio)).toBe(false);
  });
});

describe("qa: 音声の取り出し口", () => {
  it("ない ID・音声のない入り口・保存先に実体がないときは 404。中身を出さない", async () => {
    const s = await setup(fakeSpeaker());
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const rows = await rowsOf(s.familyId);

    const missing = await s.t.app.request("/api/entrances/no-such-id/question-audio", { headers: { Cookie: s.cookie } });
    expect(missing.status).toBe(404);

    // 保存先から消えている
    const r0 = rows[0]!;
    await s.t.store.delete(r0.k!);
    const gone = await s.t.app.request(`/api/entrances/${r0.id}/question-audio`, { headers: { Cookie: s.cookie } });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "not_found" });

    // 間違った合言葉は 401
    const bad = await s.t.app.request(`/api/entrances/${rows[1]!.id}/question-audio`, { headers: { Cookie: cookieOf("fake-wrong-token") } });
    expect(bad.status).toBe(401);
  });

  it("音声の取り出しでは、見せた印（shown_at）を入れない", async () => {
    const s = await setup(fakeSpeaker());
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const [r] = await rowsOf(s.familyId);
    const res = await s.t.app.request(`/api/entrances/${r!.id}/question-audio`, { headers: { Cookie: s.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await rowsOf(s.familyId)).find((x) => x.id === r!.id)!.shown_at).toBeNull();
  });
});

describe("qa: Speaker の応答の検証の境界", () => {
  function speakerReplying(make: () => Response) {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      return make();
    }) as unknown as typeof fetch;
    return { speaker: createOpenAISpeaker("fake-openai-key", { fetch: fetchImpl, sleep: async () => {} }), count: () => n };
  }
  const input: SpeakInput = { text: QUESTION, settings: QUESTION_SPEECH };

  it("content-type に付け足しがあっても audio/* なら受け取り、付け足しを落として返す", async () => {
    const { speaker } = speakerReplying(() => new Response(fakeMp3(), { status: 200, headers: { "content-type": "Audio/MPEG; charset=binary" } }));
    expect(await speaker.speak(input)).toMatchObject({ ok: true, contentType: "audio/mpeg" });
  });

  it("ID3 なしのフレームの同期の印で始まる mp3 も受け取る", async () => {
    const { speaker } = speakerReplying(() => new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0]), { status: 200, headers: { "content-type": "audio/mpeg" } }));
    expect(await speaker.speak(input)).toMatchObject({ ok: true });
  });

  it("申告された大きさが上限を超えたら、読まずに壊れた応答とする", async () => {
    const { speaker, count } = speakerReplying(
      () =>
        new Response(fakeMp3(), {
          status: 200,
          headers: { "content-type": "audio/mpeg", "content-length": String(SPEECH_MAX_AUDIO_BYTES + 1) },
        }),
    );
    expect(await speaker.speak(input)).toEqual({ ok: false, reason: "invalid_response", attempts: 2 });
    expect(count()).toBe(2);
  });

  it("実際の大きさが上限を超えたら、壊れた応答とする", async () => {
    const big = new Uint8Array(SPEECH_MAX_AUDIO_BYTES + 1);
    big.set([0x49, 0x44, 0x33]);
    const { speaker } = speakerReplying(() => new Response(big, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    expect(await speaker.speak(input)).toMatchObject({ ok: false, reason: "invalid_response" });
  });

  it("text/html など audio でない 200 は受け取らない", async () => {
    const { speaker } = speakerReplying(() => new Response(fakeMp3(), { status: 200, headers: { "content-type": "text/html" } }));
    expect(await speaker.speak(input)).toMatchObject({ ok: false, reason: "invalid_response" });
  });
});
