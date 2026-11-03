// 毎朝の処理の前段（写真の説明・記録の取り出し・むすびの推測）が、処理全体の予算を見ること。
// 前段が遅い朝に、後ろの家族の入り口が MORNING_CLAUDE_BUDGET_MS の内側で（Claude を試して）作られることを、時計を進める偽物で確かめる。
// 前段の三つと入り口づくりは偽物に差し替える（中身はそれぞれのテストで確かめている）。家族はすべて架空。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../src/server/core/ports";

let clock = 0;
const calls: { step: string; familyId: string; budgetMs?: number; at: number; useClaude?: boolean; opts?: unknown }[] = [];

vi.mock("../src/server/core/photo-guess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/photo-guess")>()),
  // 遅い前段: 渡された予算をまるごと使い切る
  runPhotoGuesses: vi.fn(async (_deps: unknown, familyId: string, opts: { budgetMs?: number } = {}) => {
    calls.push({ step: "photo", familyId, budgetMs: opts.budgetMs, at: clock, opts });
    clock += opts.budgetMs ?? 0;
  }),
}));
vi.mock("../src/server/core/record-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/record-extraction")>()),
  runRecordExtraction: vi.fn(async (_deps: unknown, familyId: string, opts: { budgetMs?: number } = {}) => {
    calls.push({ step: "record", familyId, budgetMs: opts.budgetMs, at: clock });
    clock += opts.budgetMs ?? 0;
  }),
}));
vi.mock("../src/server/core/musubi-guess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/musubi-guess")>()),
  runMusubiGuess: vi.fn(async (_deps: unknown, familyId: string, opts: { budgetMs?: number } = {}) => {
    calls.push({ step: "musubi", familyId, budgetMs: opts.budgetMs, at: clock });
    clock += opts.budgetMs ?? 0;
  }),
}));
vi.mock("../src/server/core/entrance-claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/entrance-claude")>()),
  ensureMorningEntrance: vi.fn(async (_deps: unknown, family: { id: string }, _member: unknown, _forDate: string, _now: number, o: { useClaude: boolean }) => {
    calls.push({ step: "entrance", familyId: family.id, at: clock, useClaude: o.useClaude });
    clock += 10_000;
    return { result: { created: true, entrance: null }, via: o.useClaude ? "claude" : "fixed", ...(o.useClaude ? {} : { fallback: "past_deadline" }) };
  }),
}));

const { MORNING_CLAUDE_BUDGET_MS, MORNING_PRELUDE_BUDGET_MS, runMorning } = await import("../src/server/core/morning");
const { PHOTO_GUESS_DEMO_RESET_BUDGET_MS, PHOTO_GUESS_TIME_BUDGET_MS } = await import("../src/server/core/photo-guess");
const { RECORD_EXTRACTION_BUDGET_MS, RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS } = await import("../src/server/core/record-extraction");
const { MUSUBI_GUESS_BUDGET_MS } = await import("../src/server/core/musubi-guess");

const START = 1_000_000;
const NOW = new Date("2026-11-02T18:00:00Z");

function fakeDeps(familyIds: string[]): AppDeps {
  return {
    repos: {
      families: {
        listIdsWithoutClock: async () => familyIds,
        get: async (id: string) => ({ id, clock: null }),
      },
      members: { list: async (familyId: string) => [{ id: `${familyId}-m` }] },
    },
    speaker: null,
  } as unknown as AppDeps;
}

beforeEach(() => {
  clock = START;
  calls.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("毎朝の処理の前段の予算", () => {
  it("家族 3 つで前段が遅いとき、前段は前段の締め切りで止まり、後ろの家族の入り口が予算の内側で（Claude を試して）作られる", async () => {
    // 前段の締め切りがなければ、一家族 3 分 × 3 で、3 つ目の家族の入り口は 9 分後（固定に倒れる）
    expect(PHOTO_GUESS_TIME_BUDGET_MS + RECORD_EXTRACTION_BUDGET_MS + MUSUBI_GUESS_BUDGET_MS).toBe(3 * 60_000);
    const summary = await runMorning(fakeDeps(["f1", "f2", "f3"]), NOW);

    const entrances = calls.filter((c) => c.step === "entrance");
    expect(entrances.map((c) => c.familyId)).toEqual(["f1", "f2", "f3"]);
    for (const e of entrances) {
      expect(e.useClaude).toBe(true);
      expect(e.at - START).toBeLessThan(MORNING_CLAUDE_BUDGET_MS);
    }
    expect(summary).toMatchObject({ created: 3, byClaude: 3, fallbacks: [] });

    // 前段: 渡した予算は各自の既定と締め切りまでの残りの小さい方。締め切りを過ぎた分は呼ばない
    const prelude = calls.filter((c) => c.step !== "entrance");
    expect(prelude.map((c) => [c.familyId, c.step, c.budgetMs])).toEqual([
      ["f1", "photo", 60_000],
      ["f1", "record", 60_000],
      ["f1", "musubi", 60_000],
      ["f2", "photo", 60_000],
      ["f2", "record", MORNING_PRELUDE_BUDGET_MS - 4 * 60_000 - 10_000],
    ]);
    for (const c of prelude) expect(c.at + (c.budgetMs ?? 0)).toBeLessThanOrEqual(START + MORNING_PRELUDE_BUDGET_MS);
  });

  it("前段の締め切りは、入り口の予算に一人分の余白を残す", () => {
    expect(MORNING_PRELUDE_BUDGET_MS).toBeLessThan(MORNING_CLAUDE_BUDGET_MS);
    expect(MORNING_CLAUDE_BUDGET_MS - MORNING_PRELUDE_BUDGET_MS).toBeGreaterThanOrEqual(2 * 60_000);
  });

  it("デモの初期化（一家族）の写真の説明 90 秒と記録の取り出し 120 秒は、切り詰めずにそのまま渡る（0038）", async () => {
    await runMorning(fakeDeps(["demo"]), NOW, {
      familyId: "demo",
      photoGuess: { noBatch: true, budgetMs: PHOTO_GUESS_DEMO_RESET_BUDGET_MS },
      recordExtraction: { budgetMs: RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS },
    });
    const prelude = calls.filter((c) => c.step !== "entrance");
    expect(prelude.map((c) => [c.step, c.budgetMs])).toEqual([
      ["photo", 90_000],
      ["record", 120_000],
      ["musubi", 60_000],
    ]);
    // noBatch はそのまま写真の説明づくりに渡る
    expect(prelude[0]!.opts).toEqual({ noBatch: true, budgetMs: 90_000 });
    expect(calls.find((c) => c.step === "entrance")!.useClaude).toBe(true);
  });
});
