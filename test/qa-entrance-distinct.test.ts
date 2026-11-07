// QA が足した、同じ日に家族の中で入り口の写真をなるべく重ねないこと（0042）の確かめ。架空の家族だけ。Claude は偽物。
// 実装側のテスト（entrance-claude.test.ts）で見ていない所:
// - Claude が一枚を好む（プレビューで 3 人とも同じ写真になった形）ときに、後の人へその写真が渡らないこと
// - デモの時計のボタン（Cron と同じ runMorning）でも分かれること
// - 先の人が固定の入り口に倒れたときも、その写真を後の人の候補から外すこと
// - 候補が足りない家族で、外さずに全員へ Claude の入り口ができること（固定に倒れる数が増えない）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeCallRequest, ClaudeCallResult, ClaudeClient } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, makeTestApp, onlyPurpose, startD1 } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00

type Call = { candidates: string[]; chosen: string | null };

/**
 * 偽物の Claude。好きな写真（preferred）が候補にあればそれを、なければ先頭を選ぶ。
 * failFirst の回数だけ、最初の呼び出しを失敗にする（固定の入り口に倒す）
 */
function preferringClaude(state: { preferred: string | null; failFirst: number }) {
  const calls: Call[] = [];
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const candidates = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!);
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      if (state.failFirst > 0) {
        state.failFirst--;
        calls.push({ candidates, chosen: null });
        return { ok: false, reason: "upstream", meta };
      }
      const chosen = state.preferred && candidates.includes(state.preferred) ? state.preferred : candidates[0]!;
      const value = { reason: "架空の理由", photo_id: chosen, focus: null, quote: null, question: "この日のことを、聞かせてください" } as T;
      const violation = req.check?.(value) ?? null;
      if (violation) return { ok: false, reason: "check_failed", violation, meta };
      calls.push({ candidates, chosen });
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude, calls };
}

/** 架空の四人（母、祖父、叔父、孫）と、母の写真 photoCount 枚 */
async function family(photoCount: number, opts: { isDemo?: boolean; failFirst?: number } = {}) {
  const state = { preferred: null as string | null, failFirst: opts.failFirst ?? 0 };
  const fake = preferringClaude(state);
  const t = makeTestApp(d1, { claude: onlyPurpose(fake.claude, "entrance") });
  const f = await createFamily(t, opts.isDemo ?? false);
  const mother = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のはは" });
  const elder = await addMember(t, mother.cookie, { role: "elder", relation: "祖父", calledAs: "架空のじいじ" });
  const uncle = await addMember(t, mother.cookie, { relation: "叔父", calledAs: "架空のおじ" });
  const gc = await addMember(t, mother.cookie, { relation: "孫", calledAs: "架空のまご" });
  const photoIds: string[] = [];
  for (let i = 0; i < photoCount; i++) photoIds.push((await addPhoto(t, mother.cookie, 300 + i)).id);
  return { t, f, state, calls: fake.calls, cookie: mother.cookie, memberIds: [mother.id, elder.id, uncle.id, gc.id], photoIds };
}

async function entrancesOf(familyId: string, forDate: string) {
  return (
    await d1
      .prepare("SELECT member_id, photo_id, kind FROM entrances WHERE family_id = ? AND for_date = ?")
      .bind(familyId, forDate)
      .all<{ member_id: string; photo_id: string; kind: string }>()
  ).results;
}

describe("QA 同じ日の入り口の写真をなるべく重ねない（0042）", () => {
  it("Claude が一枚を好んでも、その写真は最初の人だけに出て、後の人の候補に渡らない", async () => {
    const d = await family(5);
    // 好む写真は、並びの先頭ではない一枚（プレビューの P8 のように、Claude が選びたがる写真のつもり）
    d.state.preferred = d.photoIds[3]!;
    const summary = await runMorning(d.t.deps, NOW, { familyId: d.f.familyId });
    expect(summary).toMatchObject({ created: 4, byClaude: 4, fallbacks: [] });
    expect(d.calls).toHaveLength(4);
    expect(d.calls[0]!.chosen).toBe(d.photoIds[3]);
    for (const c of d.calls.slice(1)) expect(c.candidates).not.toContain(d.photoIds[3]);
    const rows = await entrancesOf(d.f.familyId, "2026-11-03");
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.photo_id)).size).toBe(4);
  });

  it("デモの時計のボタン（次の日へ）の翌朝も、同じ処理で写真が分かれる", async () => {
    const d = await family(5, { isDemo: true });
    d.state.preferred = d.photoIds[2]!;
    const res = await d.t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: d.cookie } });
    expect(res.status).toBe(200);
    const rows = (await d1.prepare("SELECT member_id, photo_id, kind, for_date FROM entrances WHERE family_id = ?").bind(d.f.familyId).all<{
      member_id: string;
      photo_id: string;
      kind: string;
      for_date: string;
    }>()).results;
    const forDate = rows[0]!.for_date;
    expect(rows.every((r) => r.for_date === forDate && r.kind === "claude")).toBe(true);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.photo_id)).size).toBe(4);
    for (const c of d.calls.slice(1)) expect(c.candidates).not.toContain(d.photoIds[2]);
  });

  it("先の人が固定の入り口に倒れたときも、その写真を後の人の候補から外す", async () => {
    const d = await family(5, { failFirst: 1 }); // 一人目の呼び出しを失敗にする
    const summary = await runMorning(d.t.deps, NOW, { familyId: d.f.familyId });
    expect(summary).toMatchObject({ created: 4, byClaude: 3 });
    expect(summary.fallbacks).toHaveLength(1);
    const rows = await entrancesOf(d.f.familyId, "2026-11-03");
    const fixed = rows.find((r) => r.kind === "fixed")!;
    // 一人目（members.list の順。作った時刻が同じなら ID の順）が倒れた
    expect(fixed.member_id).toBe(summary.fallbacks[0]!.memberId);
    expect(d.calls[0]!.chosen).toBeNull();
    for (const c of d.calls.slice(1)) expect(c.candidates).not.toContain(fixed.photo_id);
    expect(new Set(rows.map((r) => r.photo_id)).size).toBe(4);
  });

  it("写真が人より少ない家族: 重なってよいが、全員に Claude の入り口ができる（固定に倒れない）", async () => {
    const d = await family(2);
    d.state.preferred = d.photoIds[1]!;
    const summary = await runMorning(d.t.deps, NOW, { familyId: d.f.familyId });
    expect(summary).toMatchObject({ created: 4, byClaude: 4, fallbacks: [] });
    // 一人目は好きな写真、二人目は残りの一枚、三人目からは外すと 0 枚なので外さない（元の並び）
    expect(d.calls.map((c) => c.chosen)).toEqual([d.photoIds[1], d.photoIds[0], d.photoIds[1], d.photoIds[1]]);
    expect(d.calls[1]!.candidates).toEqual([d.photoIds[0]]);
    expect(new Set(d.calls[2]!.candidates)).toEqual(new Set(d.photoIds));
    expect(new Set((await entrancesOf(d.f.familyId, "2026-11-03")).map((r) => r.photo_id)).size).toBe(2);
  });
});
