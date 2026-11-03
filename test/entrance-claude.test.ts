// 入り口づくり（Sonnet。0017）: 候補の絞り込み、渡すもの、受け取った後の検査、毎朝の処理へのつなぎ、
// 家族向けの API に reason・model・写真の説明が出ないこと。Claude は偽物（本物の実装に偽の API を差し込む）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notConfiguredClaude } from "../src/server/core/claude";
import { UNCERTAIN_PLACEHOLDER, quoteText } from "../src/server/core/clean-transcript";
import {
  ENTRANCE_NARRATION_MAX_CHARS,
  MAX_ENTRANCE_CANDIDATES,
  buildEntranceInput,
  checkEntrance,
  checkEntranceQuestion,
  ensureMorningEntrance,
  pickEntranceCandidates,
  type EntranceMaterial,
  type EntranceOutput,
  type NarrationForEntrance,
} from "../src/server/core/entrance-claude";
import { runMorning } from "../src/server/core/morning";
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

// ---- 架空のデータ（実在の人のことではない） ----

const photo = (id: string, owner: string, takenAt: string | null = null, createdAt = 0): PhotoRow => ({
  id,
  familyId: "f",
  ownerMemberId: owner,
  storageKey: `k-${id}`,
  contentHash: id,
  width: 10,
  height: 10,
  takenAt,
  latitude: 34.39,
  longitude: 132.46,
  createdAt,
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

describe("pickEntranceCandidates: 0017 の順と、前の 7 日の除外", () => {
  const me = "me";
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

  it("ほかの家族の新しい語り → ほかの家族の未提示 → 自分の未提示 → 最後に出したのが古いもの", () => {
    const photos = [
      photo("own-new", me, "2000-01-01T00:00:00"),
      photo("other-new-b", "x", "1995-01-01T00:00:00"),
      photo("other-new-a", "x", "1990-01-01T00:00:00"),
      photo("told", me),
      photo("old-shown", "x"),
    ];
    const narrations = [{ photoId: "told", speakerMemberId: "x", createdAt: day("2026-11-01") }];
    const past = [{ photoId: "old-shown", forDate: "2026-10-01", createdAt: day("2026-10-01") }];
    const r = pickEntranceCandidates(photos, narrations, past, me, "2026-11-03");
    expect(r.map((c) => c.photo.id)).toEqual(["told", "other-new-a", "other-new-b", "own-new", "old-shown"]);
    expect(r.at(-1)).toMatchObject({ shownCount: 1, lastShownDate: "2026-10-01" });
  });

  it("前の 7 日に出した写真は外す。ただし、出した後にほかの家族が語ったものは外さない", () => {
    const photos = [photo("recent", "x"), photo("recent-told", "x"), photo("eight-days", "x")];
    const past = [
      { photoId: "recent", forDate: "2026-10-27", createdAt: day("2026-10-27") },
      { photoId: "recent-told", forDate: "2026-11-02", createdAt: day("2026-11-02") },
      { photoId: "eight-days", forDate: "2026-10-26", createdAt: day("2026-10-26") },
    ];
    const narrations = [
      { photoId: "recent-told", speakerMemberId: "x", createdAt: day("2026-11-02") + 1000 },
      // 自分の語りは数えない
      { photoId: "recent", speakerMemberId: me, createdAt: day("2026-11-02") },
    ];
    const r = pickEntranceCandidates(photos, narrations, past, me, "2026-11-03");
    expect(r.map((c) => c.photo.id)).toEqual(["recent-told", "eight-days"]);
  });

  it("語りが出した前のものなら、1 には入らない", () => {
    const photos = [photo("p", "x")];
    const past = [{ photoId: "p", forDate: "2026-11-01", createdAt: day("2026-11-01") }];
    const narrations = [{ photoId: "p", speakerMemberId: "x", createdAt: day("2026-10-30") }];
    expect(pickEntranceCandidates(photos, narrations, past, me, "2026-11-03")).toEqual([]);
  });

  it(`${MAX_ENTRANCE_CANDIDATES} 枚まで`, () => {
    const photos = Array.from({ length: 10 }, (_, i) => photo(`p${i}`, "x", null, i));
    expect(pickEntranceCandidates(photos, [], [], me, "2026-11-03")).toHaveLength(MAX_ENTRANCE_CANDIDATES);
  });
});

describe("buildEntranceInput: 渡すものと渡さないもの", () => {
  const material = (over: Partial<EntranceMaterial> = {}): EntranceMaterial => ({
    receiverId: "me",
    members: [
      { id: "me", role: "elder", relation: "祖母", calledAs: "架空のばあば" },
      { id: "other", role: "family", relation: "孫", calledAs: "架空のまご" },
    ],
    candidates: [
      {
        photo: photo("p1", "other", "1990-05-05T10:11:12"),
        image: { type: "image", mediaType: "image/jpeg", base64: "QUJD" },
        guess: "架空の説明",
        shownCount: 0,
        lastShownDate: null,
      },
    ],
    narrations: [
      narration({ id: "n-text", photoId: "p1", transcript: "架空の文字の語り", createdAt: 3 }),
      narration({ id: "n-raw", photoId: "p1", kind: "voice", transcript: "架空の未整形の声", createdAt: 2 }),
      narration({ id: "n-other-photo", photoId: "p9", transcript: "候補でない写真の語り", createdAt: 4 }),
    ],
    ...over,
  });

  it("緯度経度・保存先は渡さない。撮影日は年月日まで。説明は推測の枠に入れ、画像は写真の文字のすぐ後", () => {
    const r = buildEntranceInput(material());
    const text = r.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    expect(text).not.toContain("34.39");
    expect(text).not.toContain("132.46");
    expect(text).not.toContain("k-p1");
    expect(text).not.toMatch(/緯度|経度|位置/);
    expect(text).toContain("撮影日: 1990-05-05\n");
    expect(text).not.toContain("10:11:12");
    expect(text).toContain("<guess>\n架空の説明\n</guess>");
    const photoIdx = r.content.findIndex((p) => p.type === "text" && p.text.includes('photo_id="p1"'));
    expect(r.content[photoIdx + 1]).toMatchObject({ type: "image" });
  });

  it("未整形の声の語りは引用不可として渡す。候補でない写真の語りは渡さない", () => {
    const r = buildEntranceInput(material());
    expect(r.inputNarrationIds.sort()).toEqual(["n-raw", "n-text"]);
    expect(r.context.narrations.get("n-raw")!.quotable).toBe(false);
    expect(r.context.narrations.get("n-text")!.quotable).toBe(true);
    const text = r.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    expect(text).toContain('narration_id="n-raw" speaker="架空のまご" date="2026-11-01" quotable="no"');
    expect(text).not.toContain("候補でない写真の語り");
  });

  it("印の範囲は「……」にして渡す（聞き間違いかもしれない語を渡さない）", () => {
    const r = buildEntranceInput(
      material({
        narrations: [
          narration({ id: "n-v", photoId: "p1", kind: "voice", transcript: "交番で式", cleanedText: "交番で式", uncertainSpans: [{ start: 0, end: 2 }] }),
        ],
      }),
    );
    const text = r.content.map((p) => (p.type === "text" ? p.text : "")).join("\n");
    expect(text).toContain(`${UNCERTAIN_PLACEHOLDER}で式`);
    expect(text).not.toContain("交番");
  });

  it(`語りは新しいものから ${ENTRANCE_NARRATION_MAX_CHARS} 字まで`, () => {
    const long = "あ".repeat(ENTRANCE_NARRATION_MAX_CHARS / 2);
    const r = buildEntranceInput(
      material({
        narrations: [
          narration({ id: "old", photoId: "p1", transcript: long, createdAt: 1 }),
          narration({ id: "mid", photoId: "p1", transcript: long, createdAt: 2 }),
          narration({ id: "new", photoId: "p1", transcript: long, createdAt: 3 }),
        ],
      }),
    );
    expect(r.inputNarrationIds).toEqual(["new", "mid"]);
  });
});

describe("checkEntranceQuestion", () => {
  it.each([
    "この日のことを、聞かせてください",
    "このとき、どんな音が聞こえていましたか",
    "誰と一緒に出かけた日でしたか？",
    // 末尾の句点一つは落としてから見る（0023）
    "この日のことを聞かせてください。",
  ])("通す: %s", (q) => {
    expect(checkEntranceQuestion(q)).toBeNull();
  });

  it.each([
    ["", "question_empty"],
    ["あ".repeat(60) + "か", "question_too_long"],
    ["この日はどんな日でしたね", "question_ending"],
    ["この日のことを聞かせてください。。", "question_ending"],
    ["いい日ですね。どんな日でしたか", "question_not_one_sentence"],
    ["この日？どんな日でしたか", "question_not_one_sentence"],
    ["この日のことを覚えていますか", "question_forbidden"],
    ["この人は誰ですか", "question_forbidden"],
    ["何年ごろの日でしたか", "question_forbidden"],
    ["この日の写真を送ってください", "question_forbidden"],
    ["私も聞きたいのですが、どんな日でしたか", "question_forbidden"],
    ["ＡＩにも教えてください", "question_forbidden"],
    ["素敵な日ですが、どんな日でしたか", "question_forbidden"],
    ["どんな日でしたか🌸", "question_ending"],
    ["🌸どんな日でしたか", "question_forbidden"],
    ["どんな日でした！教えてください", "question_not_one_sentence"],
    ["この子はどなたでしょうか", "question_testing"],
  ])("止める: %s → %s", (q, kind) => {
    expect(checkEntranceQuestion(q)).toBe(kind);
  });
});

describe("checkEntrance: 受け取った後の機械的な検査", () => {
  const input = buildEntranceInput({
    receiverId: "me",
    members: [
      { id: "me", role: "elder", relation: "祖母", calledAs: "架空のばあば" },
      { id: "other", role: "family", relation: "孫", calledAs: "架空のまご" },
    ],
    candidates: [
      { photo: photo("p1", "other"), image: { type: "image", mediaType: "image/jpeg", base64: "QUJD" }, guess: null, shownCount: 0, lastShownDate: null },
      { photo: photo("p2", "other"), image: null, guess: null, shownCount: 0, lastShownDate: null },
    ],
    narrations: [
      narration({ id: "n-text", photoId: "p1", transcript: "畑で大根を抜いた。畑は広かった。" }),
      narration({ id: "n-raw", photoId: "p1", kind: "voice", transcript: "未整形の声" }),
      narration({ id: "n-v", photoId: "p1", kind: "voice", transcript: "交番で式", cleanedText: "交番で式。交番", uncertainSpans: [{ start: 0, end: 2 }] }),
      narration({ id: "n-p2", photoId: "p2", transcript: "別の写真の語り" }),
    ],
  });
  const ok: EntranceOutput = {
    reason: "架空の理由",
    photo_id: "p1",
    focus: { x: 0.3, y: 0, w: 0.7, h: 0.5 },
    quote: { narration_id: "n-text", text: "畑は広かった。" },
    question: "この日のことを、聞かせてください",
  };
  const check = (over: Partial<EntranceOutput>) => checkEntrance({ ...ok, ...over }, input.context);

  it("合うものは通す（0.3 + 0.7 の誤差も通す）", () => {
    expect(check({})).toBeNull();
    expect(check({ focus: null, quote: null })).toBeNull();
  });

  it.each<[string, Partial<EntranceOutput>, string]>([
    ["候補にない写真", { photo_id: "p9" }, "photo_not_candidate"],
    ["範囲の外", { focus: { x: 0.5, y: 0, w: 0.6, h: 0.5 } }, "focus_range"],
    ["負の位置", { focus: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }, "focus_range"],
    ["小さすぎる枠", { focus: { x: 0, y: 0, w: 0.2, h: 0.5 } }, "focus_too_small"],
    ["画像を渡していない写真の focus", { photo_id: "p2", quote: null }, "focus_without_image"],
    ["実在しない語り", { quote: { narration_id: "n-x", text: "畑" } }, "quote_unknown_narration"],
    ["別の写真の語り", { quote: { narration_id: "n-p2", text: "別の写真" } }, "quote_other_photo"],
    ["未整形の声の語り", { quote: { narration_id: "n-raw", text: "未整形" } }, "quote_not_citable"],
    ["語りにない文字列", { quote: { narration_id: "n-text", text: "畑で大根を抜きました" } }, "quote_not_found"],
    ["印と重なる", { quote: { narration_id: "n-v", text: "交番で" } }, "quote_uncertain_overlap"],
    ["「……」を含む", { quote: { narration_id: "n-v", text: `${UNCERTAIN_PLACEHOLDER}で式` } }, "quote_not_found"],
    ["長すぎる引用", { quote: { narration_id: "n-text", text: "畑".repeat(81) } }, "quote_too_long"],
    ["空の引用", { quote: { narration_id: "n-text", text: " " } }, "quote_empty"],
    ["試す問いかけ", { question: "この日のことを覚えていますか" }, "question_forbidden"],
    ["空の理由", { reason: "" }, "reason_empty"],
    ["長すぎる理由", { reason: "理".repeat(201) }, "reason_too_long"],
  ])("止める: %s", (_name, over, kind) => {
    expect(check(over)).toBe(kind);
  });

  it("印と重ならない出現があれば、それを使う", () => {
    // 「交番」は [0,2)（印）と [5,7)（印なし）にある
    expect(check({ quote: { narration_id: "n-v", text: "交番" } })).toBeNull();
  });
});

describe("quoteText: 文字の語りは transcript の位置で切る（0017）", () => {
  const text = { kind: "text" as const, transcript: "畑で大根を抜いた。畑は広かった。", cleanedText: null, uncertainSpans: null };
  it("範囲つきでも引用する", () => {
    expect(quoteText(text, 9, 16)).toBe("畑は広かった。");
  });
  it("範囲が外れていたら引用しない", () => {
    expect(quoteText(text, 9, 99)).toBeNull();
  });
  it("声の語りで整形がなければ、範囲つきでは今のまま引用しない", () => {
    expect(quoteText({ ...text, kind: "voice" }, 9, 16)).toBeNull();
  });
});

// ---- 毎朝の処理につないだとき（D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

/** 家族向けの API に出てはいけない目印 */
const SECRET_REASON = "架空の理由ZQX";
const SECRET_GUESS = "架空の説明WVY";
const messageCalls = (reqs: FakeClaudeRequest[]) => reqs.filter((r) => r.method === "POST" && r.path === "/v1/messages");

type Setup = { t: TestApp; requests: FakeClaudeRequest[]; familyId: string; cookie: string; elder: string; elderCookie: string; grandchild: string; photoId: string };

/** 祖母と孫、孫の写真一枚と孫の文字の語り、写真の説明（推測）を持つ家族 */
async function setup(replies: (photoId: string, narrationId: string) => FakeClaudeReply[]): Promise<Setup> {
  // 写真の ID が決まってから台本を作るので、中身を後から差し替える Claude を渡す
  let inner: ClaudeClient = notConfiguredClaude;
  const late: ClaudeClient = {
    call: (req) => inner.call(req),
    createBatch: (req) => inner.createBatch(req),
    getBatch: (id) => inner.getBatch(id),
    getBatchResults: (req) => inner.getBatchResults(req),
  };
  const t = makeTestApp(d1, { claude: late });
  const f = await createFamily(t);
  // 最初の一人（家族の画面の人）は孫。孫が祖母を足す（0036）
  const gc = await addMember(t, f.cookie, { relation: "孫", calledAs: "架空のまご" });
  const grandchild = gc.id;
  const e = await addMember(t, gc.cookie, { role: "elder", relation: "祖母", calledAs: "架空のばあば" });
  const elder = e.id;
  const p = await addPhoto(t, gc.cookie, 1, { latitude: 34.39, longitude: 132.46, takenAt: "2018-11-24T13:45:02" });
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({ kind: "text", photoId: p.id, entranceId: null, replyToId: null, text: "畑で大根を抜いた。全然抜けなかった。" }),
  );
  const nr = await postForm(t, "/api/narrations", form, gc.cookie);
  const narrationId = ((await nr.json()) as { narration: { id: string } }).narration.id;
  await t.flush();
  await d1
    .prepare("INSERT INTO photo_guesses (id, photo_id, family_id, description, model, prompt_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), p.id, f.familyId, SECRET_GUESS, "claude-haiku-5-5", "photo_guess/v1", 1)
    .run();
  const fake = fakeClaude({ replies: replies(p.id, narrationId) });
  inner = onlyPurpose(fake.claude, "entrance");
  return { t, requests: fake.requests, familyId: f.familyId, cookie: gc.cookie, elder, elderCookie: e.cookie, grandchild, photoId: p.id };
}

const good = (photoId: string, narrationId: string, question = "この日のことを、聞かせてください"): FakeClaudeReply => ({
  kind: "json",
  value: {
    reason: SECRET_REASON,
    photo_id: photoId,
    focus: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
    quote: { narration_id: narrationId, text: "全然抜けなかった。" },
    question,
  },
  model: "claude-sonnet-5-5",
  inputTokens: 1200,
  outputTokens: 150,
});

const NOW = new Date("2026-11-02T21:00:00Z"); // 日本時間 11/3 6:00

describe("毎朝の処理: Claude の入り口を試し、だめなら固定の入り口", () => {
  it("通った応答を kind='claude' で保存し、引用の位置はアプリが決める。家族向けの API に reason・model・説明を出さない", async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)]);
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary).toMatchObject({ created: 2, byClaude: 2, fallbacks: [], failed: [] });

    const row = await d1
      .prepare("SELECT * FROM entrances WHERE family_id = ? AND member_id = ?")
      .bind(s.familyId, s.elder)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({
      kind: "claude",
      for_date: "2026-11-03",
      photo_id: s.photoId,
      question: "この日のことを、聞かせてください",
      reason: SECRET_REASON,
      model: "claude-sonnet-5-5",
      prompt_version: PROMPTS.entrance.version,
      quote_start: 9,
      quote_end: 18,
      input_tokens: 1200,
      output_tokens: 150,
    });
    expect(JSON.parse(row!.focus as string)).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(JSON.parse(row!.input_narration_ids as string)).toHaveLength(1);

    // 渡したもの: 画像あり、緯度経度なし、説明は推測の枠
    const sent = JSON.stringify(messageCalls(s.requests)[0]!.body);
    expect(sent).toContain('"type":"image"');
    expect(sent).toContain(SECRET_GUESS);
    expect(sent).not.toContain("34.39");
    expect(sent).not.toContain("132.46");

    const before = s.requests.length;
    s.t.setNow(NOW);
    const res = await s.t.app.request("/api/entrances/today", { headers: { Cookie: s.elderCookie } });
    const body = await res.text();
    // 画面を開いたときは Claude を呼ばない
    expect(s.requests.length).toBe(before);
    const e = (JSON.parse(body) as { entrance: Record<string, unknown> }).entrance;
    expect(e).toMatchObject({ question: "この日のことを、聞かせてください", focus: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 } });
    expect(e.quote).toMatchObject({ speakerMemberId: s.grandchild, text: "全然抜けなかった。" });
    expect(Object.keys(e).sort()).toEqual(["focus", "forDate", "id", "memberId", "photo", "question", "questionAudioUrl", "quote"]);
    // 読み上げのキーがない（speaker が null）ので音声は作らない
    expect(e.questionAudioUrl).toBeNull();
    for (const secret of [SECRET_REASON, SECRET_GUESS, "claude-sonnet", PROMPTS.entrance.version, "inputNarrationIds", "reason", "model"]) {
      expect(body).not.toContain(secret);
    }
  });

  it("同じ日にもう一度呼んでも、Claude を呼ばずに今ある入り口を返す", async () => {
    const s = await setup((pid, nid) => [good(pid, nid), good(pid, nid)]);
    await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    const calls = messageCalls(s.requests).length;
    const again = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(again).toMatchObject({ created: 0, existing: 2, byClaude: 0 });
    expect(messageCalls(s.requests).length).toBe(calls);
  });

  it("検査に二度外れたら固定の入り口。違反の種類だけを残す", async () => {
    const bad = (pid: string, nid: string) => good(pid, nid, "この日のことを覚えていますか");
    const s = await setup((pid, nid) => [bad(pid, nid), bad(pid, nid), good(pid, nid), good(pid, nid)]);
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    // 一人目は二度外れて固定、二人目は通る
    expect(summary.byClaude).toBe(1);
    expect(summary.fallbacks).toHaveLength(1);
    expect(summary.fallbacks[0]).toMatchObject({ reason: "check_failed", violation: "question_forbidden" });
    const rows = (
      await d1.prepare("SELECT kind, question, reason, model FROM entrances WHERE family_id = ? ORDER BY kind").bind(s.familyId).all()
    ).results;
    expect(rows).toEqual([
      expect.objectContaining({ kind: "claude" }),
      { kind: "fixed", question: null, reason: null, model: null },
    ]);
  });

  it("一度目が外れ、二度目が通れば Claude の入り口", async () => {
    const s = await setup((pid, nid) => [
      { kind: "json", value: { ...((good(pid, nid) as { value: object }).value), photo_id: "not-a-candidate" } },
      good(pid, nid),
      good(pid, nid),
    ]);
    const summary = await runMorning(s.t.deps, NOW, { familyId: s.familyId });
    expect(summary.byClaude).toBe(2);
    expect(messageCalls(s.requests)).toHaveLength(3);
  });

  it("キーがなければ Claude を呼ばずに固定の入り口", async () => {
    const t = makeTestApp(d1, { claude: notConfiguredClaude });
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    await addPhoto(t, m.cookie, 1);
    const summary = await runMorning(t.deps, NOW, { familyId: f.familyId });
    expect(summary).toMatchObject({ created: 1, byClaude: 0, fallbacks: [{ memberId: m.id, reason: "not_configured" }] });
  });

  it("時間の予算を過ぎたら（useClaude = false）Claude を呼ばずに固定の入り口", async () => {
    const s = await setup((pid, nid) => [good(pid, nid)]);
    const family = { id: s.familyId };
    const r = await ensureMorningEntrance(s.t.deps, family, { id: s.elder }, "2026-11-03", NOW.getTime(), { useClaude: false });
    expect(r).toMatchObject({ via: "fixed", fallback: "past_deadline" });
    expect(messageCalls(s.requests)).toHaveLength(0);
  });

  it("Claude の失敗（時間切れや 5xx）でも、その人には固定の入り口を作る", async () => {
    const s = await setup(() => [{ kind: "status", status: 500 }, { kind: "status", status: 500 }]);
    const r = await ensureMorningEntrance(s.t.deps, { id: s.familyId }, { id: s.elder }, "2026-11-03", NOW.getTime(), { useClaude: true });
    expect(r).toMatchObject({ via: "fixed", fallback: "upstream" });
    expect(r.result?.entrance.kind).toBe("fixed");
  });
});
