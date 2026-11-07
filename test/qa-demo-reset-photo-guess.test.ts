// デモの初期化だけが写真の説明を Batch にしない（0038 の追記）ことの境界（qa-engineer）。
// - runMorning に渡す引数: 初期化は { familyId, photoGuess: { noBatch, budgetMs: 90 秒 }, recordExtraction: { budgetMs: 120 秒 } }、時計のボタンは { familyId } のまま
// - 時計のボタンは、しきい値を超えたら従来どおり Batch
// - 初期化の予算: 毎朝の 60 秒では止まらず、90 秒を過ぎたら残りを release（回数に数えない・Batch なし）し、入り口づくりは続く
// - キーなしの初期化: 作業の行を残さない
// Claude は偽物。写真・録音は架空の数バイト。家族はすべて架空。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import {
  PHOTO_GUESS_CALL_CONCURRENCY,
  PHOTO_GUESS_CALL_THRESHOLD,
  PHOTO_GUESS_DEMO_RESET_BUDGET_MS,
  PHOTO_GUESS_TIME_BUDGET_MS,
} from "../src/server/core/photo-guess";
import type { ClaudeClient } from "../src/server/core/ports";
import { RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS } from "../src/server/core/record-extraction";
import { SEED_MEMBERS, SEED_NARRATIONS, SEED_PHOTOS, seedPhotoKey, seedVoiceKey } from "../src/server/demo/seed";
import { createR2PhotoStore } from "../src/server/platform/cloudflare/r2-photo-store";
import {
  DEMO_RESET_TOKEN,
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  makeTestApp,
  startD1,
  type FakeClaudeRequest,
  type TestApp,
} from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

// runMorning を本物のまま包んで、渡された引数を記録する
const morningCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("../src/server/core/morning", async (importOriginal) => {
  const m = await importOriginal<typeof import("../src/server/core/morning")>();
  return {
    ...m,
    runMorning: (...args: Parameters<typeof m.runMorning>) => {
      morningCalls.push(args);
      return m.runMorning(...args);
    },
  };
});

vi.setConfig({ testTimeout: 60_000 });

let d1: D1Database;
let bucket: R2Bucket;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, bucket, dispose } = await startD1());
  for (const p of SEED_PHOTOS) await bucket.put(seedPhotoKey(p), new Uint8Array([0xff, 0xd8, 1, 2]), { httpMetadata: { contentType: "image/jpeg" } });
  for (const n of SEED_NARRATIONS) {
    if (n.kind !== "voice") continue;
    await bucket.put(seedVoiceKey(n), new Uint8Array([7, 7, 7]), { httpMetadata: { contentType: "audio/mp4" } });
  }
}, 60_000);
afterAll(() => dispose());
afterEach(() => {
  vi.restoreAllMocks();
  morningCalls.length = 0;
});

const NOW = new Date("2026-11-02T00:00:00Z");
const guessJson = { kind: "json" as const, value: { description: "屋外。大人が二人並んで立っている。" }, model: "claude-haiku-5-5" };
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");
const batchCreates = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages/batches");

function appWithR2(): TestApp {
  const t = makeTestApp(d1, { now: NOW });
  t.deps.photos = createR2PhotoStore(bucket);
  return t;
}

async function demoFamily(t: TestApp) {
  const f = await createFamily(t, true);
  const order = [...SEED_MEMBERS].sort((a, b) => (a.role === b.role ? 0 : a.role === "family" ? -1 : 1));
  const first = await addMember(t, f.cookie, { calledAs: order[0]!.calledAs, role: order[0]!.role, relation: "架空" });
  for (const m of order.slice(1)) await addMember(t, first.cookie, { calledAs: m.calledAs, role: m.role, relation: "架空" });
  return { familyId: f.familyId, cookie: first.cookie };
}

const reset = (t: TestApp, familyId: string) =>
  t.app.request(`/api/demo/families/${familyId}/reset`, { method: "POST", headers: { Authorization: `Bearer ${DEMO_RESET_TOKEN}` } });

/** 写真の説明と Batch だけ偽の API に通し、入り口などはキーなし（固定の入り口） */
function guessOnlyClaude(n: number, script: Parameters<typeof fakeClaude>[0] = {}) {
  const fake = fakeClaude({ replies: Array.from({ length: n }, () => guessJson), ...script });
  const claude: ClaudeClient = {
    call: (req) => (req.prompt.purpose === "photo_guess" ? fake.claude.call(req) : notConfiguredClaude.call(req)),
    createBatch: (req) => fake.claude.createBatch(req),
    getBatch: (id, traceId) => fake.claude.getBatch(id, traceId),
    getBatchResults: (req) => fake.claude.getBatchResults(req),
  };
  return { claude, requests: fake.requests };
}

async function requestRows(familyId: string) {
  return (
    await d1
      .prepare("SELECT state, batch_id, attempts FROM photo_guess_requests WHERE family_id = ?")
      .bind(familyId)
      .all<{ state: string; batch_id: string | null; attempts: number }>()
  ).results;
}
const guessCount = async (familyId: string) =>
  (await d1.prepare("SELECT COUNT(*) AS n FROM photo_guesses WHERE family_id = ?").bind(familyId).first<{ n: number }>())!.n;
const entranceCount = async (familyId: string) =>
  (await d1.prepare("SELECT COUNT(*) AS n FROM entrances WHERE family_id = ? AND for_date = '2026-11-02'").bind(familyId).first<{ n: number }>())!.n;

describe("runMorning に渡す引数", () => {
  it("初期化は photoGuess { noBatch: true, budgetMs: 90 秒 } と recordExtraction { budgetMs: 120 秒 } を渡す", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    expect((await reset(t, f.familyId)).status).toBe(200);
    expect(morningCalls).toHaveLength(1);
    expect(morningCalls[0]![2]).toEqual({
      familyId: f.familyId,
      photoGuess: { noBatch: true, budgetMs: PHOTO_GUESS_DEMO_RESET_BUDGET_MS },
      recordExtraction: { budgetMs: RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS },
    });
    expect(PHOTO_GUESS_DEMO_RESET_BUDGET_MS).toBe(90_000);
    expect(RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS).toBe(120_000);
  });

  it("時計のボタンは { familyId } のまま（photoGuess を渡さない）", async () => {
    const t = makeTestApp(d1, { now: NOW });
    const f = await createFamily(t, true);
    const m = await addMember(t, f.cookie);
    const res = await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: m.cookie } });
    expect(res.status).toBe(200);
    expect(morningCalls).toHaveLength(1);
    expect(morningCalls[0]![2]).toEqual({ familyId: f.familyId, forDate: expect.any(String) });
  });
});

describe("時計のボタンは従来どおり", () => {
  it("しきい値を超える写真があれば、翌朝に進めたときの写真の説明は Batch になる", async () => {
    const n = PHOTO_GUESS_CALL_THRESHOLD + 1;
    const t = makeTestApp(d1, { now: NOW });
    const f = await createFamily(t, true);
    const m = await addMember(t, f.cookie);
    for (let i = 0; i < n; i++) await addPhoto(t, m.cookie, 700 + i);
    await t.flush(); // キーなしの背景処理: 何も呼ばず、試した回数にも数えない
    for (const r of await requestRows(f.familyId)) expect(r).toEqual({ state: "failed", batch_id: null, attempts: 0 });
    const g = guessOnlyClaude(0, { batch: { status: "in_progress" } });
    t.deps.claude = g.claude;
    await t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: m.cookie } });
    expect(batchCreates(g.requests)).toHaveLength(1);
    expect(messageCalls(g.requests)).toHaveLength(0);
    const rows = await requestRows(f.familyId);
    expect(rows).toHaveLength(n);
    for (const r of rows) expect(r).toMatchObject({ state: "working", batch_id: "msgbatch_fake" });
  });
});

describe("初期化の時間の予算", () => {
  it("毎朝の予算（60 秒）を過ぎても、初期化の予算（90 秒）の内側なら全部の写真の説明を作る", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const g = guessOnlyClaude(SEED_PHOTOS.length);
    t.deps.claude = g.claude;
    const jump = PHOTO_GUESS_TIME_BUDGET_MS + 1;
    expect(jump).toBeLessThan(PHOTO_GUESS_DEMO_RESET_BUDGET_MS);
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (messageCalls(g.requests).length > 0 ? jump : 0));
    const res = await reset(t, f.familyId);
    vi.mocked(Date.now).mockRestore();
    expect(res.status).toBe(200);
    expect(messageCalls(g.requests)).toHaveLength(SEED_PHOTOS.length);
    expect(batchCreates(g.requests)).toHaveLength(0);
    expect(await guessCount(f.familyId)).toBe(SEED_PHOTOS.length);
    expect(await requestRows(f.familyId)).toEqual([]);
  });

  it("90 秒を過ぎたら残りの写真は呼ばずに release（回数 0・Batch なし）し、入り口づくりは続く", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    const g = guessOnlyClaude(SEED_PHOTOS.length);
    t.deps.claude = g.claude;
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(
      () => realNow() + (messageCalls(g.requests).length > 0 ? PHOTO_GUESS_DEMO_RESET_BUDGET_MS + 1 : 0),
    );
    const res = await reset(t, f.familyId);
    vi.mocked(Date.now).mockRestore();
    expect(res.status).toBe(200);
    // 最初に並んで走り出した分だけ呼ぶ
    expect(messageCalls(g.requests)).toHaveLength(PHOTO_GUESS_CALL_CONCURRENCY);
    expect(batchCreates(g.requests)).toHaveLength(0);
    expect(await guessCount(f.familyId)).toBe(PHOTO_GUESS_CALL_CONCURRENCY);
    const rows = await requestRows(f.familyId);
    expect(rows).toHaveLength(SEED_PHOTOS.length - PHOTO_GUESS_CALL_CONCURRENCY);
    for (const r of rows) expect(r).toEqual({ state: "failed", batch_id: null, attempts: 0 });
    // 入り口は 4 人とも作る
    expect(((await res.json()) as any).morning).toMatchObject({ created: SEED_MEMBERS.length, failed: [] });
    expect(await entranceCount(f.familyId)).toBe(SEED_MEMBERS.length);
  });
});

describe("キーなしの初期化", () => {
  it("写真の説明は呼ばず、試した回数に数えずに次の回へ回す（Batch なし）", async () => {
    const t = appWithR2();
    const f = await demoFamily(t);
    t.deps.claude = notConfiguredClaude;
    const res = await reset(t, f.familyId);
    expect(res.status).toBe(200);
    expect(await guessCount(f.familyId)).toBe(0);
    const rows = await requestRows(f.familyId);
    expect(rows).toHaveLength(SEED_PHOTOS.length);
    for (const r of rows) expect(r).toEqual({ state: "failed", batch_id: null, attempts: 0 });
    expect(((await res.json()) as any).morning).toMatchObject({ created: SEED_MEMBERS.length, failed: [] });
  });
});
