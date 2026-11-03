// QA が足した、入り口づくり（Sonnet。0017、0020、0023、0024）の確かめ。架空の家族だけを使う。Claude は偽物。
// 実装側のテスト（entrance-claude.test.ts）で見ていない所: ログに本文・名前が出ないこと、デモの時計のボタンも同じ処理を通ること、
// 画面を先に開いたときの順番、ほかの家族のものを渡さないこと、家族向けの API 全体、保存の check 制約、検査の境目、
// 候補なし・画像なし・時間の予算切れのときに Claude を呼ばないこと。
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { UNCERTAIN_PLACEHOLDER } from "../src/server/core/clean-transcript";
import {
  ENTRANCE_QUOTE_MAX_CHARS,
  ENTRANCE_REASON_MAX_CHARS,
  buildEntranceInput,
  checkEntrance,
  checkEntranceQuestion,
  ensureMorningEntrance,
  type EntranceOutput,
  type NarrationForEntrance,
} from "../src/server/core/entrance-claude";
import { MORNING_CLAUDE_BUDGET_MS, runMorning } from "../src/server/core/morning";
import type { ClaudeClient, PhotoRow } from "../src/server/core/ports";
import { PROMPTS } from "../src/server/prompts";
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
  type FakeClaudeRequest,
  type TestApp,
} from "./helpers";

// ---- 検査の境目（データベースを使わない） ----

const photo = (id: string, owner: string): PhotoRow => ({
  id,
  familyId: "f",
  ownerMemberId: owner,
  storageKey: `k-${id}`,
  contentHash: id,
  width: 10,
  height: 10,
  takenAt: null,
  latitude: null,
  longitude: null,
  createdAt: 0,
});

const narration = (over: Partial<NarrationForEntrance> & Pick<NarrationForEntrance, "id" | "photoId">): NarrationForEntrance => ({
  speakerMemberId: "other",
  replyToId: null,
  kind: "text",
  transcript: "架空の語り",
  cleanedText: null,
  uncertainSpans: null,
  forDate: "2026-11-01",
  createdAt: 1,
  ...over,
});

describe("QA checkEntrance の境目", () => {
  const long = "あ".repeat(ENTRANCE_QUOTE_MAX_CHARS + 5);
  const input = buildEntranceInput({
    receiverId: "me",
    members: [
      { id: "me", role: "elder", relation: "祖父", calledAs: "架空のじいじ" },
      { id: "other", role: "family", relation: "母", calledAs: "架空のはは" },
    ],
    candidates: [{ photo: photo("p1", "other"), image: { type: "image", mediaType: "image/jpeg", base64: "QUJD" }, guess: null, shownCount: 0, lastShownDate: null }],
    narrations: [
      narration({ id: "n-long", photoId: "p1", transcript: long }),
      // 印は [0,2)。「で式」は印のすぐ後から始まる
      narration({ id: "n-v", photoId: "p1", kind: "voice", transcript: "x", cleanedText: "交番で式を挙げた", uncertainSpans: [{ start: 0, end: 2 }] }),
      // 受け取る人自身の語り（引用できるかは検査では止めない）
      narration({ id: "n-me", photoId: "p1", speakerMemberId: "me", transcript: "架空の自分の語り" }),
    ],
  });
  const base: EntranceOutput = { reason: "架空", photo_id: "p1", focus: null, quote: null, question: "この日のことを、聞かせてください" };
  const check = (over: Partial<EntranceOutput>) => checkEntrance({ ...base, ...over }, input.context);

  it.each<[string, EntranceOutput["focus"], string | null]>([
    ["ちょうど端まで", { x: 0.75, y: 0.75, w: 0.25, h: 0.25 }, null],
    ["誤差の内側", { x: 0.5, y: 0, w: 0.5 + 5e-7, h: 1 }, null],
    ["誤差の外側", { x: 0.5, y: 0, w: 0.5 + 1e-5, h: 1 }, "focus_range"],
    ["縦にはみ出す", { x: 0, y: 0.6, w: 0.5, h: 0.5 }, "focus_range"],
    ["幅 0.25 ちょうど", { x: 0, y: 0, w: 0.25, h: 0.3 }, null],
    ["高さが 0.25 より小さい", { x: 0, y: 0, w: 0.3, h: 0.2499 }, "focus_too_small"],
    ["全体（1×1）", { x: 0, y: 0, w: 1, h: 1 }, null],
    ["1 を超える幅", { x: 0, y: 0, w: 1.2, h: 0.5 }, "focus_range"],
  ])("focus: %s", (_n, focus, kind) => {
    expect(check({ focus })).toBe(kind);
  });

  it(`引用は ${ENTRANCE_QUOTE_MAX_CHARS} 字ちょうどまで通す`, () => {
    expect(check({ quote: { narration_id: "n-long", text: "あ".repeat(ENTRANCE_QUOTE_MAX_CHARS) } })).toBeNull();
    expect(check({ quote: { narration_id: "n-long", text: "あ".repeat(ENTRANCE_QUOTE_MAX_CHARS + 1) } })).toBe("quote_too_long");
  });

  it("印のすぐ後から始まる引用は通す。印にかかる引用は止める", () => {
    expect(check({ quote: { narration_id: "n-v", text: "で式を挙げた" } })).toBeNull();
    expect(check({ quote: { narration_id: "n-v", text: "番で式" } })).toBe("quote_uncertain_overlap");
    expect(check({ quote: { narration_id: "n-v", text: UNCERTAIN_PLACEHOLDER } })).toBe("quote_not_found");
  });

  it(`reason は ${ENTRANCE_REASON_MAX_CHARS} 字ちょうどまで通す`, () => {
    expect(check({ reason: "理".repeat(ENTRANCE_REASON_MAX_CHARS) })).toBeNull();
    expect(check({ reason: "   " })).toBe("reason_empty");
  });

  it("問いかけは 60 字ちょうどまで通す（絵文字のない書記素で数える）", () => {
    expect(checkEntranceQuestion("あ".repeat(59) + "か")).toBeNull();
    expect(checkEntranceQuestion("あ".repeat(60) + "か")).toBe("question_too_long");
  });

  it.each<[string, string | null]>([
    ["どんな日でしたか？", null],
    ["　この日のことを、聞かせてください。　", null],
    ["どんな日でしたか。", null],
    ["どんな日でしたか！", "question_ending"],
    ["どんな日でしたか?", "question_ending"],
    ["わぁ、どんな日でしたか", "question_forbidden"],
    ["すてきな日ですが、どんな日でしたか", "question_forbidden"],
    ["なるほど、どんな日でしたか", "question_forbidden"],
    ["どんな🌸日でしたか", "question_forbidden"],
    ["このとき、ａｉはありましたか", "question_forbidden"],
    ["この日のことを、覚えてらっしゃいますか", "question_forbidden"],
    ["この場所は、どこですか", "question_forbidden"],
    ["この日のこと、聞かせて。どんな日でしたか", "question_not_one_sentence"],
    ["この日のこと\nどんな日でしたか", "question_not_one_sentence"],
  ])("問いかけ: %s → %s", (q, kind) => {
    expect(checkEntranceQuestion(q)).toBe(kind);
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

const NAME_ELDER = "架空のおばあQ";
const NAME_CHILD = "架空のまごQ";
const NARRATION_TEXT = "畑で大根を抜いた。全然抜けなかったのを覚えとる。";
const SECRET_REASON = "架空の理由QAREASON";
const SECRET_GUESS = "架空の説明QAGUESS";
const QUESTION = "この日の畑のことを、聞かせてください";
const MODEL = "claude-sonnet-qa-fake";

const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");

type Setup = {
  t: TestApp;
  requests: FakeClaudeRequest[];
  familyId: string;
  /** 孫（家族の画面の人）の cookie */
  cookie: string;
  /** 祖母の cookie（祖母のリンクで開いた端末） */
  elderCookie: string;
  elder: string;
  child: string;
  photoId: string;
  narrationId: string;
};

const good = (photoId: string, narrationId: string): FakeClaudeReply => ({
  kind: "json",
  value: { reason: SECRET_REASON, photo_id: photoId, focus: null, quote: { narration_id: narrationId, text: "全然抜けなかった" }, question: QUESTION },
  model: MODEL,
  inputTokens: 900,
  outputTokens: 90,
});

/** 祖母と孫、孫の写真と文字の語り、写真の説明（推測）。marker は家族ごとに変えて、ほかの家族に漏れないかを見る */
async function setup(
  replies: (photoId: string, narrationId: string) => FakeClaudeReply[],
  opts: { isDemo?: boolean; marker?: string; claude?: "fake" | "none" } = {},
): Promise<Setup> {
  const marker = opts.marker ?? "";
  let inner: ClaudeClient = notConfiguredClaude;
  const late: ClaudeClient = {
    call: (req) => inner.call(req),
    createBatch: (req) => inner.createBatch(req),
    getBatch: (id) => inner.getBatch(id),
    getBatchResults: (req) => inner.getBatchResults(req),
  };
  const t = makeTestApp(d1, { claude: opts.claude === "none" ? notConfiguredClaude : late });
  const f = await createFamily(t, opts.isDemo ?? false);
  // 最初の一人は家族の画面の人（0036）。孫が家族を作り、祖母を足す
  const c = await addMember(t, f.cookie, { relation: "孫", calledAs: NAME_CHILD + marker });
  const e = await addMember(t, c.cookie, { role: "elder", relation: "祖母", calledAs: NAME_ELDER + marker, speechStyle: "dialect", dialectRegion: "架空の地方" });
  const elder = e.id;
  const child = c.id;
  const p = await addPhoto(t, c.cookie, 1, { latitude: 35.0, longitude: 135.0, takenAt: "2019-10-20T08:00:00" });
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId: p.id, entranceId: null, replyToId: null, text: NARRATION_TEXT + marker }));
  const nr = await postForm(t, "/api/narrations", form, c.cookie);
  const narrationId = ((await nr.json()) as { narration: { id: string } }).narration.id;
  await t.flush();
  await d1
    .prepare("INSERT INTO photo_guesses (id, photo_id, family_id, description, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), p.id, f.familyId, SECRET_GUESS + marker, "claude-haiku-fake", "photo_guess/v1", 1)
    .run();
  const fake = fakeClaude({ replies: replies(p.id, narrationId) });
  inner = onlyPurpose(fake.claude, "entrance");
  return { t, requests: fake.requests, familyId: f.familyId, cookie: c.cookie, elderCookie: e.cookie, elder, child, photoId: p.id, narrationId };
}

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00

/** console.log の JSON の行を集める */
function captureLogs(): { lines: string[]; events: Record<string, unknown>[] } {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  return {
    lines,
    get events() {
      return lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
    },
  };
}

describe("QA ログに本文・名前を出さない", () => {
  it("通ったときも、検査で外れたときも、entrance_claude と morning_done は ID と種類と数だけ", async () => {
    // 一人目は二度とも外れ（問いかけに「覚えて」）、二人目は通る
    const bad = (pid: string, nid: string): FakeClaudeReply => ({
      kind: "json",
      value: { ...(good(pid, nid) as { value: object }).value, question: "この畑のことを覚えていますか" },
    });
    const s = await setup((pid, nid) => [bad(pid, nid), bad(pid, nid), good(pid, nid), good(pid, nid)]);
    const logs = captureLogs();
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary.byClaude).toBe(1);
    expect(summary.fallbacks).toHaveLength(1);

    const all = logs.lines.join("\n");
    for (const secret of [NAME_ELDER, NAME_CHILD, "大根", "抜けなかった", SECRET_REASON, SECRET_GUESS, "覚えていますか", QUESTION, "35.0", "135.0"]) {
      expect(all).not.toContain(secret);
    }
    const ec = logs.events.filter((e) => e.event === "entrance_claude");
    expect(ec).toHaveLength(2);
    const allowed = new Set([
      "event",
      "traceId",
      "familyId",
      "memberId",
      "forDate",
      "ok",
      "promptVersion",
      "entranceId",
      "photoId",
      "model",
      "inputTokens",
      "outputTokens",
      "reason",
      "violation",
    ]);
    for (const e of ec) for (const k of Object.keys(e)) expect(allowed).toContain(k);
    // 失敗の reason は種類（Claude の reason の本文ではない）
    expect(ec.find((e) => e.ok === false)).toMatchObject({ reason: "check_failed", violation: "question_forbidden" });
    const done = logs.events.find((e) => e.event === "morning_done")!;
    expect(done).toMatchObject({ created: 2, byClaude: 1 });
    expect(done.fallbacks).toEqual([{ memberId: expect.any(String), reason: "check_failed", violation: "question_forbidden" }]);
  });
});

describe("QA デモの時計のボタンも、Cron と同じ処理（runMorning）で Claude の入り口を作る", () => {
  it("「次の時間帯へ」を 3 回で翌朝になり、Claude の入り口ができる。開いたときは Claude を呼ばない", async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)], { isDemo: true });
    for (let i = 0; i < 3; i++) {
      const res = await s.t.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: s.cookie } });
      expect(res.status).toBe(200);
    }
    expect(messageCalls(s.requests)).toHaveLength(2);
    const rows = (await d1.prepare("SELECT kind, for_date, prompt_version FROM entrances WHERE family_id = ?").bind(s.familyId).all()).results;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ kind: "claude", for_date: "2026-11-03", prompt_version: PROMPTS.entrance.version });

    const before = s.requests.length;
    const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elderCookie } });
    const body = (await res.json()) as { entrance: { question: string; forDate: string; quote: { text: string } | null } };
    expect(body.entrance).toMatchObject({ forDate: "2026-11-03", question: QUESTION, quote: { text: "全然抜けなかった" } });
    expect(s.requests.length).toBe(before);
  });
});

describe("QA 画面を先に開いたとき", () => {
  it("朝の処理より先に開くと固定の入り口をその場で作り（Claude は呼ばない）、後の朝の処理はそれを残す", async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)]);
    s.t.setNow(NOW);
    const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elderCookie } });
    expect(res.status).toBe(200);
    expect(messageCalls(s.requests)).toHaveLength(0);

    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    // 祖母はすでにある（固定のまま）、孫だけ Claude を呼ぶ
    expect(summary).toMatchObject({ existing: 1, created: 1, byClaude: 1 });
    expect(messageCalls(s.requests)).toHaveLength(1);
    const elderRow = await d1.prepare("SELECT kind FROM entrances WHERE member_id = ?").bind(s.elder).first<{ kind: string }>();
    expect(elderRow?.kind).toBe("fixed");
  });
});

describe("QA ほかの家族のものを渡さない・見せない", () => {
  it("二つの家族の朝を回しても、Claude に渡す中身は自分の家族のものだけ", async () => {
    const a = await setup((pid, nid) => [good(pid, nid), good(pid, nid)], { marker: "AAA" });
    const b = await setup((pid, nid) => [good(pid, nid), good(pid, nid)], { marker: "BBB" });
    await runMorning(a.t.deps, NOW, { familyId: a.familyId });
    await runMorning(b.t.deps, NOW, { familyId: b.familyId });
    const sentA = JSON.stringify(messageCalls(a.requests).map((r) => r.body));
    const sentB = JSON.stringify(messageCalls(b.requests).map((r) => r.body));
    expect(sentA).toContain("AAA");
    expect(sentA).not.toContain("BBB");
    expect(sentA).not.toContain(b.photoId);
    expect(sentB).toContain("BBB");
    expect(sentB).not.toContain("AAA");
    expect(sentB).not.toContain(a.photoId);
  });

  it("家族向けの API のどこにも reason・model・プロンプトの版・渡した語りの ID・写真の説明が出ない", async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)]);
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    s.t.setNow(NOW);
    const urls: [url: string, cookie: string][] = [
      ["/api/entrances/today", s.elderCookie],
      ["/api/entrances/today", s.cookie],
      ["/api/family", s.cookie],
      ["/api/photos", s.cookie],
      [`/api/narrations?photoId=${s.photoId}`, s.cookie],
      ["/api/feed", s.cookie],
    ];
    for (const [url, cookie] of urls) {
      const res = await s.t.app.request(url, { headers: { Cookie: cookie } });
      expect(res.status, url).toBe(200);
      const body = await res.text();
      for (const secret of [SECRET_REASON, SECRET_GUESS, MODEL, PROMPTS.entrance.version, "inputNarrationIds", "input_narration_ids", "promptVersion", "inputTokens"]) {
        expect(body, `${url} に ${secret}`).not.toContain(secret);
      }
    }
  });
});

describe("QA 保存の check 制約", () => {
  it("kind='claude' は question・model・prompt_version が必須。kind='fixed' は question・model を持たない", async () => {
    const s = await setup(() => [], { claude: "none" });
    const insert = (kind: string, question: string | null, model: string | null, pv: string | null, date: string) =>
      d1
        .prepare("INSERT INTO entrances (id, family_id, member_id, for_date, photo_id, question, kind, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)")
        .bind(crypto.randomUUID(), s.familyId, s.elder, date, s.photoId, question, kind, model, pv)
        .run();
    await expect(insert("claude", "問いか", "m", null, "2030-01-01")).rejects.toThrow(/CHECK/i);
    await expect(insert("claude", "問いか", null, "entrance/v2", "2030-01-02")).rejects.toThrow(/CHECK/i);
    await expect(insert("claude", null, "m", "entrance/v2", "2030-01-03")).rejects.toThrow(/CHECK/i);
    await expect(insert("fixed", null, "m", null, "2030-01-04")).rejects.toThrow(/CHECK/i);
    await expect(insert("claude", "問いか", "m", "entrance/v2", "2030-01-05")).resolves.toBeTruthy();
  });
});

describe("QA Claude を呼ばずに固定の入り口に倒す", () => {
  it("候補が 0 枚（前の 7 日に出していて、その後の語りもない）なら呼ばない", async () => {
    const s = await setup((pid, nid) => [good(pid, nid)]);
    // 語りの後に、前日に出している
    await s.t.deps.repos.entrances.insertFixedIfAbsent({
      id: crypto.randomUUID(),
      familyId: s.familyId,
      memberId: s.elder,
      forDate: "2026-11-02",
      photoId: s.photoId,
      quoteNarrationId: null,
      createdAt: NOW.getTime(),
    });
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, "2026-11-03", NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ via: "fixed", fallback: "no_candidates" });
    expect(r.result?.entrance.kind).toBe("fixed");
    expect(messageCalls(s.requests)).toHaveLength(0);
  });

  it("画像が保存先にない写真は候補から外す。全部なければ呼ばない", async () => {
    const s = await setup((pid, nid) => [good(pid, nid)]);
    const [p] = await s.t.deps.repos.photos.list(s.familyId);
    await s.t.store.delete(p!.storageKey);
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, "2026-11-03", NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ fallback: "no_images" });
    expect(messageCalls(s.requests)).toHaveLength(0);
  });

  it(`処理の始まりから ${MORNING_CLAUDE_BUDGET_MS / 60_000} 分を過ぎたら、残りの人は Claude を呼ばない`, async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)]);
    const realNow = Date.now.bind(Date);
    // 一度 Claude を呼んだ後は、時計が予算を越えて進んだことにする
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + (messageCalls(s.requests).length > 0 ? MORNING_CLAUDE_BUDGET_MS + 1000 : 0));
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ created: 2, byClaude: 1 });
    expect(summary.fallbacks).toEqual([{ memberId: expect.any(String), reason: "past_deadline" }]);
    expect(messageCalls(s.requests)).toHaveLength(1);
  });

  it("キーがなければ、画像も読まずに固定の入り口（Cron の全家族の回し方でも）", async () => {
    const s = await setup(() => [], { claude: "none" });
    const get = vi.spyOn(s.t.store, "get");
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ created: 2, byClaude: 0 });
    expect(summary.fallbacks.map((f) => f.reason)).toEqual(["not_configured", "not_configured"]);
    expect(get).not.toHaveBeenCalled();
  });
});
