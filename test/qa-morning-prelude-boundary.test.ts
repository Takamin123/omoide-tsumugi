// 毎朝の処理の前段の締め切り（MORNING_PRELUDE_BUDGET_MS）の境界（qa-engineer）。
// - 締め切りまでの残りがちょうど 0 / 1ms 残る / 1ms 過ぎた
// - 前段が既定より短く終わる朝は、切り詰めずに各自の既定を渡す
// - Cron（選択肢なし）は写真の説明に既定の予算だけを渡し、noBatch を付けない
// - デモの初期化の予算も、締め切りまでの残りより大きければ切り詰める
// - 前段を飛ばしても、入り口づくりは飛ばさない。飛ばした数は morning_done の preludeSkipped に出る
// 前段の三つと入り口づくりは偽物に差し替え、時計を手で進める。家族はすべて架空。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps } from "../src/server/core/ports";

type Step = "photo" | "record" | "musubi";
let clock = 0;
/** 前段の偽物が使う時間（渡された予算 → 使う ms）。なければ渡された予算をまるごと使う */
let spend: Partial<Record<Step, (budget: number) => number>> = {};
const calls: { step: string; familyId: string; budgetMs?: number; at: number; useClaude?: boolean; opts?: unknown }[] = [];

function record(step: Step, familyId: string, opts: { budgetMs?: number }) {
  calls.push({ step, familyId, budgetMs: opts.budgetMs, at: clock, opts });
  const f = spend[step];
  clock += f ? f(opts.budgetMs ?? 0) : (opts.budgetMs ?? 0);
}

vi.mock("../src/server/core/photo-guess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/photo-guess")>()),
  runPhotoGuesses: vi.fn(async (_d: unknown, familyId: string, opts: { budgetMs?: number } = {}) => record("photo", familyId, opts)),
}));
vi.mock("../src/server/core/record-extraction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/record-extraction")>()),
  runRecordExtraction: vi.fn(async (_d: unknown, familyId: string, opts: { budgetMs?: number } = {}) => record("record", familyId, opts)),
}));
vi.mock("../src/server/core/musubi-guess", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/musubi-guess")>()),
  runMusubiGuess: vi.fn(async (_d: unknown, familyId: string, opts: { budgetMs?: number } = {}) => record("musubi", familyId, opts)),
}));
vi.mock("../src/server/core/entrance-claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/server/core/entrance-claude")>()),
  ensureMorningEntrance: vi.fn(async (_d: unknown, family: { id: string }, _m: unknown, _f: string, _n: number, o: { useClaude: boolean }) => {
    calls.push({ step: "entrance", familyId: family.id, at: clock, useClaude: o.useClaude });
    clock += 1_000;
    return { result: { created: true, entrance: null }, via: o.useClaude ? "claude" : "fixed", ...(o.useClaude ? {} : { fallback: "past_deadline" }) };
  }),
}));

const { MORNING_PRELUDE_BUDGET_MS, runMorning } = await import("../src/server/core/morning");
const { PHOTO_GUESS_TIME_BUDGET_MS } = await import("../src/server/core/photo-guess");
const { RECORD_EXTRACTION_BUDGET_MS, RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS } = await import("../src/server/core/record-extraction");
const { MUSUBI_GUESS_BUDGET_MS } = await import("../src/server/core/musubi-guess");

const START = 5_000_000;
const NOW = new Date("2026-11-02T18:00:00Z");
let logs: string[] = [];

function fakeDeps(familyIds: string[]): AppDeps {
  return {
    repos: {
      families: { listIdsWithoutClock: async () => familyIds, get: async (id: string) => ({ id, clock: null }) },
      members: { list: async (familyId: string) => [{ id: `${familyId}-m` }] },
    },
    speaker: null,
  } as unknown as AppDeps;
}

function preludeSkipped(): unknown {
  for (const l of logs) {
    try {
      const o = JSON.parse(l) as { event?: string; preludeSkipped?: number };
      if (o.event === "morning_done") return o.preludeSkipped;
    } catch {
      // JSON でない行は見ない
    }
  }
  return undefined;
}
const prelude = () => calls.filter((c) => c.step !== "entrance").map((c) => [c.familyId, c.step, c.budgetMs]);

beforeEach(() => {
  clock = START;
  spend = {};
  logs = [];
  calls.length = 0;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("前段の締め切りの境界", () => {
  it("写真の説明が締め切りちょうどで終わる（残り 0）と、記録とむすびは呼ばず、入り口は作る", async () => {
    spend.photo = () => MORNING_PRELUDE_BUDGET_MS;
    const s = await runMorning(fakeDeps(["f1"]), NOW);
    expect(prelude()).toEqual([["f1", "photo", PHOTO_GUESS_TIME_BUDGET_MS]]);
    expect(preludeSkipped()).toBe(2);
    expect(calls.filter((c) => c.step === "entrance").map((c) => c.useClaude)).toEqual([true]);
    expect(s).toMatchObject({ created: 1, byClaude: 1 });
  });

  it("締め切りまで 1ms 残っていれば、1ms の予算で呼ぶ（0 でないかぎり呼ぶ）", async () => {
    spend.photo = () => MORNING_PRELUDE_BUDGET_MS - 1;
    await runMorning(fakeDeps(["f1"]), NOW);
    expect(prelude()).toEqual([
      ["f1", "photo", PHOTO_GUESS_TIME_BUDGET_MS],
      ["f1", "record", 1],
    ]);
    expect(preludeSkipped()).toBe(1);
  });

  it("締め切りを 1ms 過ぎていれば、負の予算を渡さず呼ばない。次の家族も前段を飛ばし、入り口だけ作る", async () => {
    spend.photo = () => MORNING_PRELUDE_BUDGET_MS + 1;
    await runMorning(fakeDeps(["f1", "f2"]), NOW);
    expect(prelude()).toEqual([["f1", "photo", PHOTO_GUESS_TIME_BUDGET_MS]]);
    for (const c of calls) if (c.budgetMs !== undefined) expect(c.budgetMs).toBeGreaterThan(0);
    expect(preludeSkipped()).toBe(2 + 3);
    expect(calls.filter((c) => c.step === "entrance").map((c) => [c.familyId, c.useClaude])).toEqual([
      ["f1", true],
      ["f2", true],
    ]);
  });

  it("前段が既定より短く終わる朝は、どの家族にも各自の既定の予算をそのまま渡し、飛ばさない", async () => {
    spend = { photo: () => 2_000, record: () => 3_000, musubi: () => 1_000 };
    const s = await runMorning(fakeDeps(["f1", "f2", "f3", "f4"]), NOW);
    expect(prelude()).toEqual(
      ["f1", "f2", "f3", "f4"].flatMap((f) => [
        [f, "photo", PHOTO_GUESS_TIME_BUDGET_MS],
        [f, "record", RECORD_EXTRACTION_BUDGET_MS],
        [f, "musubi", MUSUBI_GUESS_BUDGET_MS],
      ]),
    );
    expect(preludeSkipped()).toBe(0);
    expect(s).toMatchObject({ created: 4, byClaude: 4 });
  });

  it("残りが既定より小さくなったところから切り詰める（各自の既定との小さい方）", async () => {
    // 写真で締め切りの 30 秒前まで使うと、記録は 30 秒、むすびは 0 で呼ばない
    spend.photo = () => MORNING_PRELUDE_BUDGET_MS - 30_000;
    await runMorning(fakeDeps(["f1"]), NOW);
    expect(prelude()).toEqual([
      ["f1", "photo", PHOTO_GUESS_TIME_BUDGET_MS],
      ["f1", "record", 30_000],
    ]);
    expect(preludeSkipped()).toBe(1);
  });

  it("Cron（選択肢なし）は写真の説明に既定の予算だけを渡し、noBatch を付けない", async () => {
    spend = { photo: () => 0, record: () => 0, musubi: () => 0 };
    await runMorning(fakeDeps(["f1"]), NOW);
    expect(calls[0]!.opts).toEqual({ budgetMs: PHOTO_GUESS_TIME_BUDGET_MS });
  });

  it("デモの初期化の記録 120 秒も、締め切りまでの残りがそれより小さければ切り詰める", async () => {
    spend.photo = () => MORNING_PRELUDE_BUDGET_MS - 45_000;
    await runMorning(fakeDeps(["demo"]), NOW, {
      familyId: "demo",
      photoGuess: { noBatch: true, budgetMs: 90_000 },
      recordExtraction: { budgetMs: RECORD_EXTRACTION_DEMO_RESET_BUDGET_MS },
    });
    expect(prelude()).toEqual([
      ["demo", "photo", 90_000],
      ["demo", "record", 45_000],
    ]);
  });

  it("締め切りは処理の始まりから数える（家族ごとに数え直さない）。締め切りの後に始まる前段はない", async () => {
    await runMorning(fakeDeps(["f1", "f2", "f3"]), NOW);
    for (const c of calls) {
      if (c.step === "entrance") continue;
      expect(c.at).toBeLessThan(START + MORNING_PRELUDE_BUDGET_MS);
      expect(c.at + (c.budgetMs ?? 0)).toBeLessThanOrEqual(START + MORNING_PRELUDE_BUDGET_MS);
    }
  });
});
