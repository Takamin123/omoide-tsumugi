// 「次の日へ」の待ちの間（毎朝の処理を翌朝の日付で先に走らせ、終わってから時計を動かす。0062）を、Claude と音声が遅い形で確かめる。
// 実装側の test/morning.test.ts にないもの: 別の人が待ちの間に開く、待ちの間に押す（負けた押しが早く戻らない）、音声が壊れない、
// 途中で切れた後に足りない分だけ作る、遅れて終わった押しが時計を戻さない、Cron の経路が変わらない。
// Claude と音声は偽物。架空の値だけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { ensureMorningEntrance } from "../src/server/core/entrance-claude";
import { runMorning } from "../src/server/core/morning";
import type { ClaudeCallRequest, ClaudeCallResult, ClaudeClient, SpeakResult, Speaker } from "../src/server/core/ports";
import { addMember, addPhoto, createFamily, makeTestApp, onlyPurpose, startD1 } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const DAY1 = "2026-11-02";
const DAY2 = "2026-11-03";
const DAY3 = "2026-11-04";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
}

/** 入り口の呼び出しを gate が開くまで止める偽物の Claude */
function slowClaude(g: { opened: Promise<void> }) {
  const calls: string[] = [];
  let entered!: () => void;
  const firstCall = new Promise<void>((r) => (entered = r));
  const claude: ClaudeClient = {
    async call<T>(req: ClaudeCallRequest<T>): Promise<ClaudeCallResult<T>> {
      calls.push(req.prompt.purpose);
      entered();
      await g.opened;
      const text = req.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
      const photo = [...text.matchAll(/<photo photo_id="([^"]+)">/g)].map((m) => m[1]!)[0]!;
      const meta = { purpose: req.prompt.purpose, model: "claude-fake", promptVersion: req.prompt.version, inputTokens: 1, outputTokens: 1, attempts: 1 };
      const value = { reason: "架空の理由", photo_id: photo, focus: null, quote: null, question: "この日のことを、聞かせてください" } as T;
      const violation = req.check?.(value) ?? null;
      if (violation) return { ok: false, reason: "check_failed", violation, meta };
      return { ok: true, value, meta };
    },
    createBatch: (req) => notConfiguredClaude.createBatch(req),
    getBatch: (id) => notConfiguredClaude.getBatch(id),
    getBatchResults: (req) => notConfiguredClaude.getBatchResults(req),
  };
  return { claude, calls, firstCall };
}

const fakeSpeaker = (): Speaker => ({
  async speak(): Promise<SpeakResult> {
    return { ok: true, audio: new Uint8Array([0x49, 0x44, 0x33, 4, 0, 1]), contentType: "audio/mpeg", attempts: 1 };
  },
});

async function setup(opts: { speaker?: Speaker } = {}) {
  const g = gate();
  const fake = slowClaude(g);
  const t = makeTestApp(d1, { claude: onlyPurpose(fake.claude, "entrance"), ...(opts.speaker ? { speaker: opts.speaker } : {}) });
  const f = await createFamily(t, true);
  const mother = await addMember(t, f.cookie, { relation: "母", calledAs: "架空のはは" });
  const elder = await addMember(t, mother.cookie, { role: "elder", relation: "祖母", calledAs: "架空のそぼ" });
  await addPhoto(t, mother.cookie, 410);
  await addPhoto(t, mother.cookie, 411);
  await addPhoto(t, mother.cookie, 412);
  const send = (cookie: string, from: string) =>
    t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ from }) });
  const today = async (cookie: string) =>
    (await (await t.app.request("/api/entrances/today", { headers: { Cookie: cookie } })).json()) as { entrance: { id: string; forDate: string; question: string | null } | null };
  const clock = async () =>
    (await d1.prepare("SELECT clock_date AS d, clock_slot AS s FROM families WHERE id = ?").bind(f.familyId).first<{ d: string; s: string }>())!;
  const rows = async (forDate: string) =>
    (
      await d1
        .prepare("SELECT id, member_id, kind, question_audio_key, shown_at FROM entrances WHERE family_id = ? AND for_date = ?")
        .bind(f.familyId, forDate)
        .all<{ id: string; member_id: string; kind: string; question_audio_key: string | null; shown_at: number | null }>()
    ).results;
  return { g, fake, t, f, mother, elder, send, today, clock, rows };
}

/** 少し待つ（まだ戻っていないことを見るため） */
const settled = async (p: unknown) => {
  let done = false;
  void Promise.resolve(p).then(() => (done = true));
  await new Promise((r) => setTimeout(r, 150));
  return done;
};

describe("QA 待ちの間に開く", () => {
  it("押した人と別の人が開いても、前の日のまま。翌日の入り口は全員 Claude のまま", async () => {
    const s = await setup();
    const press = s.send(s.mother.cookie, DAY1);
    await s.fake.firstCall;

    expect((await s.today(s.elder.cookie)).entrance!.forDate).toBe(DAY1);
    expect((await s.today(s.mother.cookie)).entrance!.forDate).toBe(DAY1);
    expect((await s.clock()).d).toBe(DAY1);
    expect(await s.rows(DAY2)).toEqual([]);

    s.g.open();
    await press;
    expect(await s.clock()).toEqual({ d: DAY2, s: "morning" });
    const day2 = await s.rows(DAY2);
    expect(day2.map((e) => e.kind).sort()).toEqual(["claude", "claude"]);
    // 待ちの間に開いたのは前の日の入り口で、翌日の入り口は見せたことになっていない
    expect(day2.every((e) => e.shown_at === null)).toBe(true);
    expect((await s.rows(DAY1)).every((e) => e.kind === "fixed" && e.shown_at !== null)).toBe(true);
    expect((await s.today(s.elder.cookie)).entrance).toMatchObject({ forDate: DAY2, question: "この日のことを、聞かせてください" });
  });

  it("途中の入り口は、時計を動かすまで今日の入り口として出ない（前の人の分ができていても）", async () => {
    const s = await setup();
    // 母の翌日の入り口だけ先にある（処理の途中）
    const family = (await s.t.deps.repos.families.get(s.f.familyId))!;
    s.g.open();
    await ensureMorningEntrance(s.t.deps, family, { id: s.mother.id }, DAY2, s.t.deps.now().getTime(), { useClaude: true });
    expect((await s.rows(DAY2)).length).toBe(1);
    expect((await s.today(s.mother.cookie)).entrance!.forDate).toBe(DAY1);
    expect((await s.rows(DAY2))[0]!.shown_at).toBeNull();
  });
});

describe("QA 待ちの間に押す", () => {
  it("負けた押しは、翌日ができるまで戻らない。一日だけ進み、一人一日に入り口は一つ", async () => {
    const s = await setup();
    const first = s.send(s.mother.cookie, DAY1);
    await s.fake.firstCall;
    const second = s.send(s.elder.cookie, DAY1);
    const third = s.send(s.mother.cookie, DAY1);
    expect(await settled(second)).toBe(false);
    expect(await settled(third)).toBe(false);
    expect((await s.clock()).d).toBe(DAY1);

    s.g.open();
    const res = await Promise.all([first, second, third]);
    for (const r of res) {
      expect(r.status).toBe(200);
      expect(((await r.json()) as { clock: unknown }).clock).toEqual({ date: DAY2, slot: "morning" });
    }
    expect((await s.clock()).d).toBe(DAY2);
    const day2 = await s.rows(DAY2);
    expect(day2).toHaveLength(2);
    expect(day2.every((e) => e.kind === "claude")).toBe(true);
    expect((await s.rows(DAY3)).length).toBe(0);
    // 負けた押しの後でも、その日付の押しは動かさない
    expect(((await (await s.send(s.elder.cookie, DAY1)).json()) as { clock: { date: string } }).clock.date).toBe(DAY2);
  });

  it("遅れて終わった押しは、先に進んだ時計を戻さない", async () => {
    const s = await setup();
    const late = s.send(s.elder.cookie, DAY1); // 止めたまま
    await s.fake.firstCall;

    // 別の押しが翌日まで終え、さらに次の日へ進める。遅い方の Claude が止まっている間に、入り口を先に作ってしまう
    const quick = makeTestApp(d1, { claude: notConfiguredClaude, now: new Date("2026-11-02T00:00:00Z") });
    const press = (from: string) =>
      quick.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: s.mother.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ from }) });
    expect(((await (await press(DAY1)).json()) as { clock: { date: string } }).clock.date).toBe(DAY2);
    expect(((await (await press(DAY2)).json()) as { clock: { date: string } }).clock.date).toBe(DAY3);

    s.g.open();
    const r = await late;
    expect(r.status).toBe(200);
    expect((await s.clock()).d).toBe(DAY3);
    expect(await s.rows(DAY2)).toHaveLength(2);
  });
});

describe("QA 読み上げの音声", () => {
  it("押しが重なっても、Claude の入り口ごとに音声は一つで、ほかの音声を残さない。待ちの間に開いても作られる", async () => {
    const s = await setup({ speaker: fakeSpeaker() });
    const first = s.send(s.mother.cookie, DAY1);
    await s.fake.firstCall;
    await s.today(s.elder.cookie); // 前の日を開く
    const second = s.send(s.elder.cookie, DAY1);
    await new Promise((r) => setTimeout(r, 50));
    s.g.open();
    await Promise.all([first, second]);

    const day2 = await s.rows(DAY2);
    expect(day2.every((e) => e.kind === "claude" && e.question_audio_key !== null)).toBe(true);
    const store = s.t.store;
    const speech = store.keys().filter((k) => k.includes(`families/${s.f.familyId}/speech/`));
    expect(speech.sort()).toEqual(day2.map((e) => e.question_audio_key!).sort());
    for (const e of day2) {
      const res = await s.t.app.request(`/api/entrances/${e.id}/question-audio`, { headers: { Cookie: s.mother.cookie } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    }
  });
});

describe("QA 途中で切れた後", () => {
  it("時計は前の日のまま。次に押すと足りない人の分だけ作り、できている入り口はそのまま", async () => {
    const s = await setup();
    const family = (await s.t.deps.repos.families.get(s.f.familyId))!;
    s.g.open();
    await ensureMorningEntrance(s.t.deps, family, { id: s.mother.id }, DAY2, s.t.deps.now().getTime(), { useClaude: true });
    const before = await s.rows(DAY2);
    expect(before).toHaveLength(1);
    const callsBefore = s.fake.calls.length;
    expect((await s.clock()).d).toBe(DAY1);

    expect(((await (await s.send(s.elder.cookie, DAY1)).json()) as { clock: { date: string } }).clock.date).toBe(DAY2);
    const after = await s.rows(DAY2);
    expect(after).toHaveLength(2);
    expect(after.find((e) => e.member_id === s.mother.id)!.id).toBe(before[0]!.id);
    expect(s.fake.calls.length - callsBefore).toBe(1);
  });
});

describe("QA Cron の経路", () => {
  it("forDate なしは今までどおり: 時計のない家族は今日の日付、時計のある家族は対象外で時計も動かない", async () => {
    const s = await setup();
    s.g.open();
    const plain = await createFamily(s.t);
    const pm = await addMember(s.t, plain.cookie);
    await addPhoto(s.t, pm.cookie, 420);
    const now = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00
    await runMorning(s.t.deps, now);
    const row = await d1.prepare("SELECT for_date AS d FROM entrances WHERE family_id = ?").bind(plain.familyId).first<{ d: string }>();
    expect(row).toEqual({ d: DAY2 });
    expect(await s.rows(DAY2)).toEqual([]);
    expect(await s.clock()).toEqual({ d: DAY1, s: "morning" });
    const clockless = await d1.prepare("SELECT clock_date AS d FROM families WHERE id = ?").bind(plain.familyId).first<{ d: string | null }>();
    expect(clockless).toEqual({ d: null });
  });

  it("forDate なしで家族を指定（デモの初期化の形）は、その家族の時計の日付で作り、時計を動かさない", async () => {
    const s = await setup();
    s.g.open();
    await runMorning(s.t.deps, s.t.deps.now(), { familyId: s.f.familyId });
    expect(await s.rows(DAY1)).toHaveLength(2);
    expect(await s.rows(DAY2)).toEqual([]);
    expect((await s.clock()).d).toBe(DAY1);
  });
});
