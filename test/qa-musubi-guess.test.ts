// qa: むすびの推測（musubi_guess。0044）の足りないところ。
// - 渡す材料の上限（記録 150 件・語りの本文 20,000 字。新しい順に残る）と、作業の表の鍵（順番に依らない）
// - デモの時計のボタン（次の日へ）が、Cron と同じ毎朝の処理を通ってむすびを作ること
// - saveGuessed が、写真の入らないむすびの行を残さないこと
// Claude は偽物。家族はすべて架空。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAUDE_SONNET } from "../src/server/core/claude";
import { MUSUBI_MAX_NARRATION_CHARS, MUSUBI_MAX_RECORDS, buildMusubiInput, musubiInputKey } from "../src/server/core/musubi-guess";
import type { NarrationRow, PhotoRow, RecordRow } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, fakeClaude, makeTestApp, onlyPurpose, startD1, type FakeClaudeReply, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const photo = (id: string): PhotoRow => ({
  id,
  familyId: "f",
  ownerMemberId: "m",
  storageKey: `families/f/photos/${id}`,
  contentHash: id,
  width: 1,
  height: 1,
  takenAt: null,
  latitude: null,
  longitude: null,
  createdAt: 1,
});
const narration = (id: string, photoId: string, text: string, createdAt: number): NarrationRow => ({
  id,
  familyId: "f",
  speakerMemberId: "m",
  photoId,
  entranceId: null,
  replyToId: null,
  requestId: null,
  kind: "text",
  audioKey: null,
  audioContentType: null,
  durationMs: null,
  transcript: text,
  transcriptStatus: "done",
  cleanedText: null,
  cleanedModel: null,
  cleanedPromptVersion: null,
  uncertainSpans: null,
  forDate: "2026-11-02",
  createdAt,
});
const record = (id: string, n: NarrationRow, createdAt: number): RecordRow => ({
  id,
  familyId: "f",
  photoId: n.photoId,
  kind: "event",
  value: "旅",
  origin: "told",
  toldByMemberId: "m",
  narrationId: n.id,
  quoteStart: 0,
  quoteEnd: 1,
  model: null,
  promptVersion: null,
  createdAt,
});

describe("buildMusubiInput の上限（新しい順に残す）", () => {
  it(`記録は新しい順に ${MUSUBI_MAX_RECORDS} 件まで。いちばん古い記録が落ちる`, () => {
    const photos = [photo("pa"), photo("pb")];
    const narrations: NarrationRow[] = [];
    const records: RecordRow[] = [];
    for (let i = 0; i < MUSUBI_MAX_RECORDS + 1; i++) {
      const n = narration(`n${i}`, i % 2 === 0 ? "pa" : "pb", "旅の話", 1000 + i);
      narrations.push(n);
      records.push(record(`r${i}`, n, 2000 + i));
    }
    const input = buildMusubiInput({ records, narrations, photos, calledAs: new Map(), existing: [] })!;
    expect(input.recordIds).toHaveLength(MUSUBI_MAX_RECORDS);
    expect(input.recordIds).not.toContain("r0");
    expect(input.recordIds).toContain(`r${MUSUBI_MAX_RECORDS}`);
  });

  it(`語りの本文は合計 ${MUSUBI_MAX_NARRATION_CHARS} 字まで。超える古い語りの記録は渡さない（本文も渡さない）`, () => {
    const photos = [photo("pa"), photo("pb")];
    const per = MUSUBI_MAX_NARRATION_CHARS / 4;
    const narrations = [0, 1, 2, 3, 4].map((i) => narration(`n${i}`, i % 2 === 0 ? "pa" : "pb", `${"古新"[i === 0 ? 0 : 1]}${String(i)}`.padEnd(per, "あ"), 1000 + i));
    const records = narrations.map((n, i) => record(`r${i}`, n, 2000 + i));
    const input = buildMusubiInput({ records, narrations, photos, calledAs: new Map(), existing: [] })!;
    expect(input.recordIds).toEqual(["r1", "r2", "r3", "r4"]);
    expect(input.text).not.toContain("古0");
    expect(input.text.length).toBeLessThan(MUSUBI_MAX_NARRATION_CHARS + 2_000);
  });

  it("作業の表の鍵は、記録の ID の集合だけで決まる（順番に依らない）", async () => {
    expect(await musubiInputKey(["b", "a", "c"])).toBe(await musubiInputKey(["c", "b", "a"]));
    expect(await musubiInputKey(["a", "b"])).not.toBe(await musubiInputKey(["a", "b", "c"]));
  });
});

// ---- 手元の D1 ----

const reply = (photo_ids: string[], evidence_record_ids: string[]): FakeClaudeReply => ({
  kind: "json",
  value: { musubi: [{ photo_ids, evidence_record_ids, reason: "同じ旅の話" }] },
  model: CLAUDE_SONNET,
  inputTokens: 10,
  outputTokens: 10,
});

let seq = 0;
async function addTold(t: TestApp, familyId: string, speaker: string, photoId: string, text: string, value: string): Promise<string> {
  const nid = crypto.randomUUID();
  const createdAt = 50_000 + ++seq;
  await t.deps.repos.narrations.insertIfAbsent({
    id: nid,
    familyId,
    speakerMemberId: speaker,
    photoId,
    entranceId: null,
    replyToId: null,
    requestId: null,
    kind: "text",
    audioKey: null,
    audioContentType: null,
    durationMs: null,
    transcript: text,
    transcriptStatus: "done",
    forDate: "2026-11-02",
    createdAt,
  });
  const rid = crypto.randomUUID();
  const start = text.indexOf(value);
  await t.deps.repos.recordExtractions.saveDone(
    { narrationId: nid, familyId, promptVersion: "extract_records/v1", model: "fake", inputTokens: 1, outputTokens: 1, createdAt },
    [{ id: rid, familyId, photoId, kind: "event", value, toldByMemberId: speaker, narrationId: nid, quoteStart: start, quoteEnd: start + value.length, createdAt }],
  );
  return rid;
}

const rows = (table: string, familyId: string) =>
  d1.prepare(`SELECT * FROM ${table} WHERE family_id = ?`).bind(familyId).all<Record<string, unknown>>().then((r) => r.results);

describe("デモの時計のボタンも、同じ毎朝の処理でむすびを推測する", () => {
  it("次の日へを一押しすると、翌朝の処理でむすびの推測が走り、guessed のむすびが入る", async () => {
    const fc = fakeClaude({ replies: [reply(["p1", "p2"], ["r1", "r2"])] });
    const t = makeTestApp(d1, { claude: onlyPurpose(fc.claude, "musubi_guess") });
    const f = await createFamily(t, true);
    const m = await addMember(t, f.cookie, { relation: "孫", calledAs: "けん" });
    const p1 = await addPhoto(t, m.cookie, 301);
    const p2 = await addPhoto(t, m.cookie, 302);
    await addTold(t, f.familyId, m.id, p1.id, "伊勢の旅で夫婦岩を見た。", "伊勢の旅");
    await addTold(t, f.familyId, m.id, p2.id, "伊勢の旅の宿のすき焼き。", "伊勢の旅");

    const res = await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: m.cookie } });
    expect(((await res.json()) as { clock: { slot: string } }).clock.slot).toBe("morning");
    const ms = await rows("musubi", f.familyId);
    expect(ms).toEqual([expect.objectContaining({ created_by: "guessed" })]);
    expect((await rows("musubi_photos", f.familyId)).map((r) => r.photo_id).sort()).toEqual([p1.id, p2.id].sort());
    expect(await rows("musubi_guess_runs", f.familyId)).toEqual([expect.objectContaining({ state: "done" })]);
  });
});

describe("saveGuessed は写真の入らないむすびを残さない", () => {
  // 今は落ちる（むすびの行だけが残る）。runMusubiGuess からは起きない（resolveMusubi がその家族の写真だけに絞る）が、
  // リポジトリの約束（その家族の写真だけ）の守りとして見つけたもの
  it("写真がどれもほかの家族のものなら、むすびの行も入れない（作業の行は done）", async () => {
    const t = makeTestApp(d1);
    const a = await createFamily(t);
    const am = await addMember(t, a.cookie);
    await addPhoto(t, am.cookie, 401);
    const b = await createFamily(t);
    const bm = await addMember(t, b.cookie);
    const bp1 = await addPhoto(t, bm.cookie, 402);
    const bp2 = await addPhoto(t, bm.cookie, 403);
    await t.deps.repos.musubi.saveGuessed(
      { familyId: a.familyId, inputKey: "k-foreign", promptVersion: "musubi_guess/v1", model: CLAUDE_SONNET, inputTokens: 0, outputTokens: 0, createdAt: 1 },
      [{ id: crypto.randomUUID(), familyId: a.familyId, photoIds: [bp1.id, bp2.id], evidenceRecordIds: ["x"], reason: "x", createdAt: 1 }],
    );
    expect(await rows("musubi_photos", a.familyId)).toEqual([]);
    expect(await rows("musubi_photos", b.familyId)).toEqual([]);
    expect(await rows("musubi", a.familyId)).toEqual([]);
  });
});
