// 記録の取り出し（extract_records。0039）: 検査の各違反、保存の形（told、出所、位置）、冪等、未整形の声を飛ばすこと、
// 失敗と取り直し、時間の予算、キーなし、ログに本文が出ないこと、毎朝の処理の中の順番。Claude は偽物。家族はすべて架空。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CLAUDE_HAIKU, notConfiguredClaude } from "../src/server/core/claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeClient, ClaudePurpose, NarrationRow, UncertainSpan } from "../src/server/core/ports";
import {
  RECORD_EXTRACTION_MAX_ATTEMPTS,
  RECORD_MAX_PER_NARRATION,
  RECORD_PRONOUN_VALUES,
  RECORD_VALUE_MAX_CHARS,
  buildRecordInput,
  checkRecords,
  recordsSchema,
  runRecordExtraction,
} from "../src/server/core/record-extraction";
import { PROMPTS } from "../src/server/prompts";
import { addMember, addPhoto, createFamily, fakeClaude, makeTestApp, onlyPurpose, postForm, startD1, type FakeClaudeReply, type FakeClaudeRequest, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

// ---- 検査（データベースなし） ----

const textN = (transcript: string): Pick<NarrationRow, "kind" | "transcript" | "cleanedText" | "uncertainSpans"> => ({
  kind: "text",
  transcript,
  cleanedText: null,
  uncertainSpans: null,
});
const voiceN = (cleaned: string, spans: UncertainSpan[] = []): Pick<NarrationRow, "kind" | "transcript" | "cleanedText" | "uncertainSpans"> => ({
  kind: "voice",
  transcript: "架空の文字起こし",
  cleanedText: cleaned,
  uncertainSpans: spans,
});
const out = (...records: [string, string][]) => ({ records: records.map(([kind, text]) => ({ kind, text })) }) as never;

describe("checkRecords（全か無か）", () => {
  const n = textN("昭和の終わり頃、たかしと駅前の夏祭りに行った。あの人も来とった。");

  it("本文の連続した部分なら通る。空の配列も通る", () => {
    expect(checkRecords(out(["time", "昭和の終わり頃"], ["person", "たかし"], ["place", "駅前"], ["event", "夏祭り"]), n)).toBeNull();
    expect(checkRecords({ records: [] }, n)).toBeNull();
  });

  it("本文にない語（言い換え・補い）は not_found", () => {
    expect(checkRecords(out(["place", "駅の前"]), n)).toBe("not_found");
    expect(checkRecords(out(["time", "1980年代"]), n)).toBe("not_found");
  });

  it("空・長すぎ・多すぎを止める", () => {
    expect(checkRecords(out(["person", " "]), n)).toBe("empty");
    expect(checkRecords(out(["person", ""]), n)).toBe("empty");
    const long = "あ".repeat(RECORD_VALUE_MAX_CHARS + 1);
    expect(checkRecords(out(["event", long]), textN(long))).toBe("too_long");
    expect(checkRecords(out(["event", "あ".repeat(RECORD_VALUE_MAX_CHARS)]), textN(long))).toBeNull();
    const many = Array.from({ length: RECORD_MAX_PER_NARRATION + 1 }, (_, i) => ["person", `人${i}`] as [string, string]);
    expect(checkRecords(out(...many), textN(many.map((m) => m[1]).join("、")))).toBe("too_many");
  });

  it("代名詞・指示語だけの値を止める（「あの人」を person にしない）", () => {
    for (const w of RECORD_PRONOUN_VALUES) {
      expect(checkRecords(out(["person", w]), textN(`むかし${w}がね`)), w).toBe("pronoun");
    }
    // 値の一部に含むだけなら止めない（「あそこの家」は検査では通し、プロンプトに頼る）
    expect(checkRecords(out(["place", "あそこの家"]), textN("あそこの家の犬"))).toBeNull();
  });

  it("同じ範囲を二度返したら duplicate（種類が違っても）", () => {
    expect(checkRecords(out(["event", "夏祭り"], ["event", "夏祭り"]), n)).toBe("duplicate");
    expect(checkRecords(out(["event", "夏祭り"], ["place", "夏祭り"]), n)).toBe("duplicate");
  });

  it("聞き間違いの印の範囲と重なると uncertain_overlap。「……」を含む範囲は not_found", () => {
    const cleaned = "交番で式を挙げたんよ。";
    const v = voiceN(cleaned, [{ start: 0, end: 2 }]);
    expect(checkRecords(out(["place", "交番"]), v)).toBe("uncertain_overlap");
    expect(checkRecords(out(["event", "……で式"]), v)).toBe("not_found");
    expect(checkRecords(out(["event", "式"]), v)).toBeNull();
  });

  it("kind が列挙の外ならスキーマで止まる", () => {
    expect(recordsSchema.safeParse({ records: [{ kind: "thing", text: "x" }] }).success).toBe(false);
    expect(recordsSchema.safeParse({ records: [{ kind: "person" }] }).success).toBe(false);
  });
});

describe("buildRecordInput", () => {
  it("語り手・家族の呼ばれ方・本文・返事の相手（文脈だけ）を渡す", () => {
    const s = buildRecordInput({
      speakerCalledAs: "ばあば",
      familyCalledAs: ["ばあば", "けん"],
      narrationText: "本文の語り",
      context: { speakerCalledAs: "けん", text: "相手の語り" },
    });
    expect(s).toContain("呼ばれ方: ばあば");
    expect(s).toContain("ばあば、けん");
    expect(s).toContain('<context speaker="けん" quotable="no">\n相手の語り\n</context>');
    expect(s).toContain("<narration>\n本文の語り\n</narration>");
    expect(buildRecordInput({ speakerCalledAs: null, familyCalledAs: [], narrationText: "x", context: null })).not.toContain("<context");
  });
});

// ---- 取り出しの流れ（手元の D1） ----

const reply = (records: { kind: string; text: string }[]): FakeClaudeReply => ({
  kind: "json",
  value: { records },
  model: CLAUDE_HAIKU,
  inputTokens: 300,
  outputTokens: 30,
});
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");
const userText = (r: FakeClaudeRequest) =>
  ((r.body as { messages: { content: { type: string; text?: string }[] }[] }).messages[0]!.content)
    .map((p) => (p.type === "text" ? p.text : `[${p.type}]`))
    .join("\n");

interface Setup {
  t: TestApp;
  familyId: string;
  elder: string;
  kid: string;
  photo: string;
}

async function setup(claude: ClaudeClient = notConfiguredClaude, opts: { allPurposes?: boolean } = {}): Promise<Setup> {
  // 写真の登録の背景処理（写真の説明）が台本の応答を食わないよう、ふだんは取り出しの呼び出しだけを通す
  const t = makeTestApp(d1, { claude: opts.allPurposes ? claude : onlyPurpose(claude, "extract_records") });
  const f = await createFamily(t);
  const kid = await addMember(t, f.cookie, { relation: "孫", calledAs: "けん" });
  const elder = await addMember(t, kid.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "広島" });
  const photo = await addPhoto(t, kid.cookie, 1, { takenAt: "1985-08-01T10:00:00" });
  return { t, familyId: f.familyId, elder: elder.id, kid: kid.id, photo: photo.id };
}

let seq = 0;
async function addNarration(
  s: Setup,
  o: { kind: "text" | "voice"; speaker?: string; transcript: string | null; cleaned?: { text: string; spans: UncertainSpan[] }; replyToId?: string; createdAt?: number },
): Promise<string> {
  const id = crypto.randomUUID();
  seq++;
  const repo = s.t.deps.repos.narrations;
  await repo.insertIfAbsent({
    id,
    familyId: s.familyId,
    speakerMemberId: o.speaker ?? s.elder,
    photoId: s.photo,
    entranceId: null,
    replyToId: o.replyToId ?? null,
    requestId: null,
    kind: o.kind,
    audioKey: o.kind === "voice" ? `families/${s.familyId}/audio/${id}` : null,
    audioContentType: o.kind === "voice" ? "audio/webm" : null,
    durationMs: null,
    transcript: o.kind === "text" ? o.transcript : null,
    transcriptStatus: o.kind === "text" ? "done" : "pending",
    forDate: "2026-11-02",
    createdAt: o.createdAt ?? 1_000 + seq,
  });
  if (o.kind === "voice" && o.transcript !== null) {
    await repo.setTranscript(s.familyId, id, "done", o.transcript);
    if (o.cleaned) await setCleaned(s, id, o.cleaned);
  }
  return id;
}
const setCleaned = (s: Setup, id: string, c: { text: string; spans: UncertainSpan[] }) =>
  s.t.deps.repos.narrations.setCleaned(s.familyId, id, {
    cleanedText: c.text,
    cleanedModel: CLAUDE_HAIKU,
    cleanedPromptVersion: "clean_transcript/v2",
    uncertainSpans: c.spans,
  });

const recordRows = (familyId: string) =>
  d1
    .prepare("SELECT * FROM records WHERE family_id = ? ORDER BY narration_id, quote_start")
    .bind(familyId)
    .all<Record<string, unknown>>()
    .then((r) => r.results);
const extractionRows = (familyId: string) =>
  d1
    .prepare("SELECT * FROM record_extractions WHERE family_id = ? ORDER BY created_at, narration_id")
    .bind(familyId)
    .all<Record<string, unknown>>()
    .then((r) => r.results);

const NARRATION = "これは浜じゃね。昭和の終わり頃、まさるとお父さんと海水浴に行ったんよ。";

describe("runRecordExtraction", () => {
  it("取り出した記録を told として、出所（語り手・語り・写真）と位置つきで入れる。作業の行は done", async () => {
    const fc = fakeClaude({ replies: [reply([{ kind: "place", text: "浜" }, { kind: "time", text: "昭和の終わり頃" }, { kind: "person", text: "まさる" }, { kind: "event", text: "海水浴" }])] });
    const s = await setup(fc.claude);
    const id = await addNarration(s, { kind: "text", transcript: NARRATION });
    const sum = await runRecordExtraction(s.t.deps, s.familyId);
    expect(sum).toMatchObject({ pending: 1, done: 1, records: 4, failed: 0 });

    const rows = await recordRows(s.familyId);
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).toMatchObject({ origin: "told", told_by_member_id: s.elder, narration_id: id, photo_id: s.photo, model: null, prompt_version: null });
      expect(NARRATION.slice(r.quote_start as number, r.quote_end as number)).toBe(r.value);
    }
    expect(rows.map((r) => [r.kind, r.value])).toEqual([
      ["place", "浜"],
      ["time", "昭和の終わり頃"],
      ["person", "まさる"],
      ["event", "海水浴"],
    ]);
    expect(await extractionRows(s.familyId)).toEqual([
      expect.objectContaining({ narration_id: id, state: "done", attempts: 1, prompt_version: PROMPTS.extract_records.version, model: CLAUDE_HAIKU, input_tokens: 300, output_tokens: 30 }),
    ]);
    // Haiku に、用途のプロンプトで頼む
    const call = messageCalls(fc.requests)[0]!;
    expect((call.body as { model: string }).model).toBe(CLAUDE_HAIKU);
    expect((call.body as { system: unknown }).system).toEqual(expect.anything());
  });

  it("渡すのは呼ばれ方と本文だけ。画像・撮影日・ID は渡さない", async () => {
    const fc = fakeClaude({ replies: [reply([])] });
    const s = await setup(fc.claude);
    const id = await addNarration(s, { kind: "text", transcript: NARRATION });
    await runRecordExtraction(s.t.deps, s.familyId);
    const call = messageCalls(fc.requests)[0]!;
    const body = call.body as { messages: { content: { type: string }[] }[] };
    expect(body.messages[0]!.content.every((p) => p.type === "text")).toBe(true);
    const text = userText(call);
    expect(text).toContain(NARRATION);
    expect(text).toContain("呼ばれ方: ばあば");
    expect(text).toMatch(/<family_names>\n(けん、ばあば|ばあば、けん)\n<\/family_names>/);
    expect(text).not.toContain("1985");
    expect(text).not.toContain(id);
    expect(text).not.toContain(s.photo);
  });

  it("0 件でも done を残し、二度目は呼ばない（冪等）", async () => {
    const fc = fakeClaude({ replies: [reply([]), reply([{ kind: "place", text: "浜" }])] });
    const s = await setup(fc.claude);
    await addNarration(s, { kind: "text", transcript: "わしの車じゃ。" });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ done: 1, records: 0 });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 0, done: 0 });
    expect(messageCalls(fc.requests)).toHaveLength(1);
    expect(await recordRows(s.familyId)).toHaveLength(0);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "done", attempts: 1 })]);
  });

  it("saveDone を二度呼んでも記録は一組（done の後は入れない）", async () => {
    const s = await setup();
    const id = await addNarration(s, { kind: "text", transcript: NARRATION });
    const attempt = { narrationId: id, familyId: s.familyId, promptVersion: "extract_records/v1", model: CLAUDE_HAIKU, inputTokens: 1, outputTokens: 1, createdAt: 5 };
    const row = () => ({ id: crypto.randomUUID(), familyId: s.familyId, photoId: s.photo, kind: "place" as const, value: "浜", toldByMemberId: s.elder, narrationId: id, quoteStart: 3, quoteEnd: 4, createdAt: 5 });
    await s.t.deps.repos.recordExtractions.saveDone(attempt, [row()]);
    await s.t.deps.repos.recordExtractions.saveDone(attempt, [row()]);
    expect(await recordRows(s.familyId)).toHaveLength(1);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "done", attempts: 1 })]);
    // done の後に markFailed が来ても変えない
    await s.t.deps.repos.recordExtractions.markFailed(attempt);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "done", attempts: 1 })]);
  });

  it("ほかの家族の語りを指す行は入らない", async () => {
    const s = await setup();
    const other = await setup();
    const id = await addNarration(other, { kind: "text", transcript: NARRATION });
    const attempt = { narrationId: id, familyId: s.familyId, promptVersion: "extract_records/v1", model: CLAUDE_HAIKU, inputTokens: 1, outputTokens: 1, createdAt: 5 };
    await s.t.deps.repos.recordExtractions.saveDone(attempt, [
      { id: crypto.randomUUID(), familyId: s.familyId, photoId: other.photo, kind: "place", value: "浜", toldByMemberId: other.elder, narrationId: id, quoteStart: 3, quoteEnd: 4, createdAt: 5 },
    ]);
    expect(await recordRows(s.familyId)).toHaveLength(0);
    expect(await recordRows(other.familyId)).toHaveLength(0);
  });

  it("未整形の声は飛ばして翌朝に回す。整形されたら取り出す（位置は整形の文字）", async () => {
    const cleaned = "交番で式を挙げたんよ。お仲人さんは校長先生でね。";
    const fc = fakeClaude({ replies: [reply([{ kind: "event", text: "式" }, { kind: "person", text: "校長先生" }])] });
    const s = await setup(fc.claude);
    const id = await addNarration(s, { kind: "voice", transcript: "こうばんで式をあげたんよお仲人さんは校長先生でね" });
    const pending = await addNarration(s, { kind: "voice", transcript: null }); // 文字起こしもまだ
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 0, done: 0 });
    expect(messageCalls(fc.requests)).toHaveLength(0);
    expect(await extractionRows(s.familyId)).toHaveLength(0);

    await setCleaned(s, id, { text: cleaned, spans: [{ start: 0, end: 2 }] });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 1, done: 1, records: 2 });
    // 印の範囲は「……」で渡る
    const text = userText(messageCalls(fc.requests)[0]!);
    expect(text).toContain("……で式を挙げたんよ。");
    expect(text).not.toContain("交番");
    const rows = await recordRows(s.familyId);
    expect(rows.map((r) => [r.value, cleaned.slice(r.quote_start as number, r.quote_end as number)])).toEqual([
      ["式", "式"],
      ["校長先生", "校長先生"],
    ]);
    expect((await extractionRows(s.familyId)).map((r) => r.narration_id)).toEqual([id]);
    void pending;
  });

  it("返事は相手の語りを文脈として渡し、記録は返事の本文からだけ取る", async () => {
    const fc = fakeClaude({ replies: [reply([]), reply([{ kind: "person", text: "親父" }])] });
    const s = await setup(fc.claude);
    const parent = await addNarration(s, { kind: "text", transcript: NARRATION, createdAt: 1 });
    const child = await addNarration(s, { kind: "text", speaker: s.kid, transcript: "親父は後から来ただけじゃ", replyToId: parent, createdAt: 2 });
    await runRecordExtraction(s.t.deps, s.familyId);
    const second = userText(messageCalls(fc.requests)[1]!);
    expect(second).toContain(`<context speaker="ばあば" quotable="no">\n${NARRATION}\n</context>`);
    expect(second).toContain("呼ばれ方: けん");
    const rows = await recordRows(s.familyId);
    expect(rows).toEqual([expect.objectContaining({ narration_id: child, told_by_member_id: s.kid, value: "親父" })]);
  });

  it("相手の語りの語を返事の記録として返したら not_found で止まる", async () => {
    const bad = reply([{ kind: "person", text: "まさる" }]);
    const fc = fakeClaude({ replies: [reply([]), bad, bad] });
    const s = await setup(fc.claude);
    const parent = await addNarration(s, { kind: "text", transcript: NARRATION, createdAt: 1 });
    await addNarration(s, { kind: "text", speaker: s.kid, transcript: "後から来ただけじゃ", replyToId: parent, createdAt: 2 });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ done: 1, failed: 1 });
  });

  it("検査の違反は 1 回だけ再試行する。二度目が合えば done", async () => {
    const fc = fakeClaude({ replies: [reply([{ kind: "person", text: "あの人" }]), reply([{ kind: "place", text: "浜" }])] });
    const s = await setup(fc.claude);
    await addNarration(s, { kind: "text", transcript: NARRATION });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ done: 1, records: 1 });
    expect(messageCalls(fc.requests)).toHaveLength(2);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "done", input_tokens: 600, output_tokens: 60 })]);
  });

  it("二度とも違反なら何も入れずに failed。翌朝に取り直し、上限に届いたらもう呼ばない", async () => {
    const bad = reply([{ kind: "place", text: "駅の前" }]);
    const fc = fakeClaude({ replies: Array.from({ length: RECORD_EXTRACTION_MAX_ATTEMPTS * 2 + 2 }, () => bad) });
    const s = await setup(fc.claude);
    await addNarration(s, { kind: "text", transcript: NARRATION });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void logs.push(String(l)));
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ failed: 1, done: 0 });
    expect(await recordRows(s.familyId)).toHaveLength(0);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "failed", attempts: 1 })]);
    expect(logs.map((l) => JSON.parse(l)).find((l) => l.event === "record_extraction")).toMatchObject({ status: "failed", reason: "check_failed", violation: "not_found", attempts: 2 });
    for (let i = 1; i < RECORD_EXTRACTION_MAX_ATTEMPTS; i++) await runRecordExtraction(s.t.deps, s.familyId);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ state: "failed", attempts: RECORD_EXTRACTION_MAX_ATTEMPTS })]);
    const before = messageCalls(fc.requests).length;
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 0 });
    expect(messageCalls(fc.requests)).toHaveLength(before);
  });

  it("時間の予算を超えたら呼ばずに翌朝へ（作業の行を残さない）", async () => {
    const fc = fakeClaude({ replies: [reply([])] });
    const s = await setup(fc.claude);
    await addNarration(s, { kind: "text", transcript: NARRATION });
    await addNarration(s, { kind: "text", transcript: "わしの車じゃ。" });
    expect(await runRecordExtraction(s.t.deps, s.familyId, { budgetMs: 0 })).toMatchObject({ pending: 2, deferred: 2, done: 0 });
    expect(messageCalls(fc.requests)).toHaveLength(0);
    expect(await extractionRows(s.familyId)).toHaveLength(0);
  });

  it("キーがなければ呼ばず、作業の行を残さない", async () => {
    const s = await setup();
    await addNarration(s, { kind: "text", transcript: NARRATION });
    await addNarration(s, { kind: "text", transcript: "わしの車じゃ。" });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 2, done: 0, failed: 0, notConfigured: true });
    expect(await extractionRows(s.familyId)).toHaveLength(0);
  });

  it("ほかの家族の語りは見ない", async () => {
    const fc = fakeClaude({ replies: [reply([])] });
    const s = await setup(fc.claude);
    const other = await setup();
    await addNarration(other, { kind: "text", transcript: NARRATION });
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 0 });
    expect(messageCalls(fc.requests)).toHaveLength(0);
  });

  it("ログには ID・件数・所要時間だけ。語りの本文と取り出した値を出さない", async () => {
    const SECRET = "ゼットキューの架空の浜";
    const fc = fakeClaude({ replies: [reply([{ kind: "place", text: SECRET }]), reply([{ kind: "person", text: "あの人" }]), reply([{ kind: "person", text: "あの人" }])] });
    const s = await setup(fc.claude);
    const id = await addNarration(s, { kind: "text", transcript: `${SECRET}で遊んだ。ばあばも来た。` });
    await addNarration(s, { kind: "text", transcript: "あの人の家の犬じゃ" });
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: unknown) => void logs.push(String(l)));
    vi.spyOn(console, "error").mockImplementation((l: unknown) => void logs.push(String(l)));
    vi.spyOn(console, "warn").mockImplementation((l: unknown) => void logs.push(String(l)));
    await runRecordExtraction(s.t.deps, s.familyId);
    const all = logs.join("\n") + JSON.stringify(fc.logs);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("あの人");
    expect(all).not.toContain("ばあば");
    const run = logs.map((l) => JSON.parse(l)).find((l) => l.event === "record_extraction_run");
    expect(run).toMatchObject({ familyId: s.familyId, pending: 2, done: 1, failed: 1, records: 1 });
    expect(typeof run.ms).toBe("number");
    expect(logs.map((l) => JSON.parse(l)).find((l) => l.event === "record_extraction" && l.status === "done")).toMatchObject({ narrationId: id, records: 1 });
  });
});

describe("毎朝の処理の中の順番（0039）", () => {
  it("写真の説明 → 記録の取り出し → 入り口づくり の順に、家族ごとに通る", async () => {
    const order: ClaudePurpose[] = [];
    const recorder: ClaudeClient = {
      call: async (req) => {
        order.push(req.prompt.purpose);
        return notConfiguredClaude.call(req);
      },
      createBatch: (req) => notConfiguredClaude.createBatch(req),
      getBatch: (id) => notConfiguredClaude.getBatch(id),
      getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
    };
    const s = await setup(recorder, { allPurposes: true });
    await addNarration(s, { kind: "text", transcript: NARRATION });
    // 写真の登録の背景処理を済ませてから、朝の処理の呼び出しだけを見る
    await s.t.flush();
    order.length = 0;
    await runMorning(s.t.deps, new Date("2026-11-02T21:00:00Z"), { familyId: s.familyId });
    const firstOf = (p: ClaudePurpose) => order.indexOf(p);
    expect(firstOf("photo_guess")).toBeGreaterThanOrEqual(0);
    expect(firstOf("extract_records")).toBeGreaterThan(order.lastIndexOf("photo_guess"));
    expect(firstOf("entrance")).toBeGreaterThan(order.lastIndexOf("extract_records"));
  });

  it("デモの時計のボタンからも取り出しが走る（Cron と同じ runMorning）", async () => {
    const fc = fakeClaude({ replies: [reply([{ kind: "place", text: "浜" }])] });
    const t = makeTestApp(d1, { claude: onlyPurpose(fc.claude, "extract_records") });
    const f = await createFamily(t, true);
    const a = await addMember(t, f.cookie);
    const photo = await addPhoto(t, a.cookie, 1);
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "text", photoId: photo.id, entranceId: null, replyToId: null, text: NARRATION }));
    expect((await postForm(t, "/api/narrations", form, a.cookie)).status).toBeLessThan(300);
    // 朝 → 昼 → 夜 → 翌朝（翌朝で毎朝の処理）
    for (let i = 0; i < 3; i++) {
      const res = await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: a.cookie } });
      expect(res.status).toBeLessThan(300);
    }
    expect(await recordRows(f.familyId)).toEqual([expect.objectContaining({ value: "浜", origin: "told", told_by_member_id: a.id })]);
  });
});

// ---- qa で足したもの: 重ねて走らせたとき、取り出しの失敗が入り口づくりを止めないこと、家族をまたいだ書き込み ----

describe("冪等（同じ朝を二度・ボタンを重ねて押す。qa）", () => {
  it("同じ家族の取り出しを同時に二つ走らせても、記録は一組で、作業の行は done が一つ", async () => {
    const r = reply([{ kind: "place", text: "浜" }, { kind: "person", text: "まさる" }]);
    const fc = fakeClaude({ replies: [r, r] });
    const s = await setup(fc.claude);
    const id = await addNarration(s, { kind: "text", transcript: NARRATION });
    await Promise.all([runRecordExtraction(s.t.deps, s.familyId), runRecordExtraction(s.t.deps, s.familyId)]);
    const rows = await recordRows(s.familyId);
    expect(rows.map((x) => x.value)).toEqual(["浜", "まさる"]);
    expect(await extractionRows(s.familyId)).toEqual([expect.objectContaining({ narration_id: id, state: "done", attempts: 1 })]);
  });

  it("同じ日の毎朝の処理を二度（Cron の後にボタンなど）走らせても、取り出しの呼び出しは一回", async () => {
    const fc = fakeClaude({ replies: [reply([{ kind: "place", text: "浜" }]), reply([{ kind: "place", text: "浜" }])] });
    const s = await setup(fc.claude);
    await addNarration(s, { kind: "text", transcript: NARRATION });
    await s.t.flush();
    const at = new Date("2026-11-02T21:00:00Z");
    await runMorning(s.t.deps, at, { familyId: s.familyId });
    await runMorning(s.t.deps, at, { familyId: s.familyId });
    expect(messageCalls(fc.requests)).toHaveLength(1);
    expect(await recordRows(s.familyId)).toHaveLength(1);
  });

  it("デモの時計のボタンを重ねて押しても、記録は一組", async () => {
    const r = reply([{ kind: "place", text: "浜" }]);
    const fc = fakeClaude({ replies: [r, r, r] });
    const t = makeTestApp(d1, { claude: onlyPurpose(fc.claude, "extract_records") });
    const f = await createFamily(t, true);
    const a = await addMember(t, f.cookie);
    const photo = await addPhoto(t, a.cookie, 1);
    const form = new FormData();
    form.append("meta", JSON.stringify({ kind: "text", photoId: photo.id, entranceId: null, replyToId: null, text: NARRATION }));
    expect((await postForm(t, "/api/narrations", form, a.cookie)).status).toBeLessThan(300);
    const press = () => t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: a.cookie } });
    for (let i = 0; i < 2; i++) expect((await press()).status).toBeLessThan(300);
    // 夜 → 翌朝 を二つ同時に（どちらか、または両方が朝の処理を走らせる）
    const res = await Promise.all([press(), press()]);
    for (const x of res) expect(x.status).toBeLessThan(300);
    // さらに一巡して、次の朝も重ねない
    for (let i = 0; i < 3; i++) await press();
    expect(await recordRows(f.familyId)).toEqual([expect.objectContaining({ value: "浜", origin: "told" })]);
    expect(await extractionRows(f.familyId)).toEqual([expect.objectContaining({ state: "done", attempts: 1 })]);
  });
});

describe("取り出しの失敗は入り口づくりを止めない（qa）", () => {
  const entranceCount = async (s: Setup, forDate: string) => {
    const members = await s.t.deps.repos.members.list(s.familyId);
    const got = await Promise.all(members.map((m) => s.t.deps.repos.entrances.get(s.familyId, m.id, forDate)));
    return { members: members.length, entrances: got.filter((e) => e !== null).length };
  };

  it("未処理の語りの読み出しでデータベースが投げても、毎朝の処理は投げず、全員の入り口ができる", async () => {
    const s = await setup();
    await addNarration(s, { kind: "text", transcript: NARRATION });
    await s.t.flush();
    vi.spyOn(s.t.deps.repos.recordExtractions, "listPending").mockRejectedValue(new Error("D1_ERROR"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const sum = await runMorning(s.t.deps, new Date("2026-11-02T21:00:00Z"), { familyId: s.familyId });
    const c = await entranceCount(s, "2026-11-03");
    expect(c.members).toBeGreaterThan(0);
    expect(c.entrances).toBe(c.members);
    expect(sum.failed).toEqual([]);
  });

  it("保存（saveDone）でデータベースが投げても、残りの語りを続け、入り口もできる。投げた語りは作業の行を残さず翌朝に", async () => {
    const r = reply([{ kind: "place", text: "浜" }]);
    const fc = fakeClaude({ replies: [r, r, r] });
    const s = await setup(fc.claude);
    const first = await addNarration(s, { kind: "text", transcript: NARRATION, createdAt: 1 });
    const second = await addNarration(s, { kind: "text", transcript: "浜で泳いだ。", createdAt: 2 });
    await s.t.flush();
    const repo = s.t.deps.repos.recordExtractions;
    const real = repo.saveDone.bind(repo);
    const spy = vi.spyOn(repo, "saveDone").mockImplementation(async (attempt, rows) => {
      if (attempt.narrationId === first) throw new Error("D1_ERROR");
      return real(attempt, rows);
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    await runMorning(s.t.deps, new Date("2026-11-02T21:00:00Z"), { familyId: s.familyId });
    const c = await entranceCount(s, "2026-11-03");
    expect(c.entrances).toBe(c.members);
    expect((await extractionRows(s.familyId)).map((x) => x.narration_id)).toEqual([second]);
    // 翌朝は投げた語りだけを取り直す
    spy.mockRestore();
    expect(await runRecordExtraction(s.t.deps, s.familyId)).toMatchObject({ pending: 1, done: 1 });
    expect((await recordRows(s.familyId)).map((x) => x.narration_id).sort()).toEqual([first, second].sort());
  });
});

describe("家族をまたいだ作業の行（qa）", () => {
  it("ほかの家族の語りを指す saveDone / markFailed は、記録も作業の行も残さない（その家族の取り出しを止めない）", async () => {
    const s = await setup();
    const other = await setup();
    const id = await addNarration(other, { kind: "text", transcript: NARRATION });
    const attempt = { narrationId: id, familyId: s.familyId, promptVersion: "extract_records/v1", model: CLAUDE_HAIKU, inputTokens: 1, outputTokens: 1, createdAt: 5 };
    await s.t.deps.repos.recordExtractions.saveDone(attempt, []).catch(() => {});
    await s.t.deps.repos.recordExtractions.markFailed(attempt).catch(() => {});
    const leaked = await d1.prepare("SELECT family_id, state FROM record_extractions WHERE narration_id = ?").bind(id).all();
    expect(leaked.results).toEqual([]);
    expect((await other.t.deps.repos.recordExtractions.listPending(other.familyId, RECORD_EXTRACTION_MAX_ATTEMPTS, 50)).map((n) => n.id)).toEqual([id]);
  });
});

