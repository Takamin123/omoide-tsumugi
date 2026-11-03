// むすびの推測で、出所のモデルが分からない応答（meta.model が null）の境界（qa-engineer。0044）。
// （ClaudeCallMeta.model は string なので、null は saveGuessed を直接呼んだときだけ起きる）
// - すでに done の行があるとき、model なしの saveGuessed は done を壊さない
// Claude は偽物。家族はすべて架空。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CLAUDE_SONNET } from "../src/server/core/claude";
import { runMusubiGuess } from "../src/server/core/musubi-guess";
import type { ClaudeClient } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, fakeClaude, makeTestApp, onlyPurpose, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());
afterEach(() => vi.restoreAllMocks());

async function setup(claude: ClaudeClient) {
  const t: TestApp = makeTestApp(d1, { claude: onlyPurpose(claude, "musubi_guess") });
  const f = await createFamily(t);
  const kid = await addMember(t, f.cookie, { relation: "孫", calledAs: "けん" });
  const elder = await addMember(t, kid.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "広島" });
  const photos: string[] = [];
  for (let i = 0; i < 2; i++) photos.push((await addPhoto(t, kid.cookie, 700 + i, { takenAt: "1985-08-01T10:00:00" })).id);
  let seq = 0;
  for (const [i, text] of ["伊勢の旅で、夫婦岩を見たんよ。", "伊勢の旅の宿で、すき焼きを食べた。"].entries()) {
    const nid = crypto.randomUUID();
    const createdAt = 20_000 + ++seq;
    await t.deps.repos.narrations.insertIfAbsent({
      id: nid, familyId: f.familyId, speakerMemberId: elder.id, photoId: photos[i]!, entranceId: null, replyToId: null, requestId: null,
      kind: "text", audioKey: null, audioContentType: null, durationMs: null, transcript: text, transcriptStatus: "done", forDate: "2026-11-02", createdAt,
    });
    const start = text.indexOf("伊勢の旅");
    await t.deps.repos.recordExtractions.saveDone(
      { narrationId: nid, familyId: f.familyId, promptVersion: "extract_records/v1", model: "fake", inputTokens: 1, outputTokens: 1, createdAt },
      [{ id: crypto.randomUUID(), familyId: f.familyId, photoId: photos[i]!, kind: "event", value: "伊勢の旅", toldByMemberId: elder.id, narrationId: nid, quoteStart: start, quoteEnd: start + 4, createdAt }],
    );
  }
  return { t, familyId: f.familyId, photos };
}

const reply = {
  kind: "json" as const,
  value: { musubi: [{ photo_ids: ["p1", "p2"], evidence_record_ids: ["r1", "r2"], reason: "同じ旅の話" }] },
  model: CLAUDE_SONNET,
};
const rows = (table: string, familyId: string) =>
  d1.prepare(`SELECT * FROM ${table} WHERE family_id = ?`).bind(familyId).all<Record<string, unknown>>().then((r) => r.results);

describe("model の分からない推測", () => {
  it("すでに done の行があるとき、model なしの saveGuessed は done を壊さず、むすびを足さない", async () => {
    const fc = fakeClaude({ replies: [reply] });
    const s = await setup(fc.claude);
    expect((await runMusubiGuess(s.t.deps, s.familyId)).status).toBe("done");
    const [run] = await rows("musubi_guess_runs", s.familyId);
    expect(run).toMatchObject({ state: "done", attempts: 1 });
    await s.t.deps.repos.musubi.saveGuessed(
      { familyId: s.familyId, inputKey: run!.input_key as string, promptVersion: "musubi_guess/v1", model: null, inputTokens: 0, outputTokens: 0, createdAt: 2 },
      [{ id: crypto.randomUUID(), familyId: s.familyId, photoIds: s.photos, evidenceRecordIds: ["x"], reason: "x", createdAt: 2 }],
    );
    expect(await rows("musubi_guess_runs", s.familyId)).toEqual([expect.objectContaining({ state: "done", attempts: 1, model: CLAUDE_SONNET })]);
    expect(await rows("musubi", s.familyId)).toHaveLength(1);
  });
});
