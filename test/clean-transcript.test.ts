// 文字起こしの整形（Haiku）と聞き間違いの印（docs/decisions/0018）。Claude は偽物（本物の実装に偽の API を差し込む）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CLEAN_MAX_UNCERTAIN_RATIO,
  CLEAN_MIN_KEPT_RATIO,
  UNCERTAIN_PLACEHOLDER,
  buildCleanInput,
  canClean,
  checkMarked,
  cleanNarration,
  displayText,
  parseMarked,
  quoteText,
} from "../src/server/core/clean-transcript";
import { CLAUDE_HAIKU } from "../src/server/core/claude";
import type { EntranceRow, NarrationRow, PhotoRow } from "../src/server/core/ports";
import { PROMPTS } from "../src/server/prompts";
import { entranceView } from "../src/server/routes/views";
import {
  addMember,
  addPhoto,
  createFamily,
  fakeClaude,
  fakeTranscriber,
  makeTestApp,
  onlyPurpose,
  postForm,
  startD1,
  type FakeClaudeReply,
} from "./helpers";

// ---- 架空の語り（実在の人のことではない） ----
const TRANSCRIPT = "えー、これは式の日じゃね。交番で式を挙げたんよ。あの、あの頃は、みなそうじゃった。";
const GOOD = "これは式の日じゃね。⟦交番⟧で式を挙げたんよ。\nあの頃は、みなそうじゃった。";
const GOOD_CLEANED = "これは式の日じゃね。交番で式を挙げたんよ。\nあの頃は、みなそうじゃった。";

describe("parseMarked: 記号を外して、cleanedText の位置を数える", () => {
  it("記号を外した文字と、その中の範囲を返す", () => {
    const r = parseMarked(GOOD);
    expect(r).toEqual({ ok: true, cleanedText: GOOD_CLEANED, spans: [{ start: 10, end: 12 }] });
    if (r.ok) expect(r.cleanedText.slice(10, 12)).toBe("交番");
  });

  it("印がいくつあっても、記号の分だけ位置を詰めて数える", () => {
    const r = parseMarked("あ⟦いう⟧え⟦お⟧か");
    expect(r).toEqual({ ok: true, cleanedText: "あいうえおか", spans: [{ start: 1, end: 3 }, { start: 4, end: 5 }] });
  });

  it("隣り合う印は一つにまとめる", () => {
    expect(parseMarked("あ⟦い⟧⟦う⟧え")).toEqual({ ok: true, cleanedText: "あいうえ", spans: [{ start: 1, end: 3 }] });
  });

  it("位置は UTF-16 の添字（表示と引用の slice と同じ単位）", () => {
    const r = parseMarked("𠮷野⟦家⟧");
    expect(r).toEqual({ ok: true, cleanedText: "𠮷野家", spans: [{ start: 3, end: 4 }] });
    if (r.ok) expect(r.cleanedText.slice(3, 4)).toBe("家");
  });

  it.each([
    ["入れ子", "あ⟦い⟦う⟧⟧", "marker_nested"],
    ["閉じ忘れ", "あ⟦いう", "marker_unbalanced"],
    ["開き忘れ", "あい⟧う", "marker_unbalanced"],
    ["空の印", "あ⟦⟧い", "marker_empty"],
  ])("%s は違反", (_n, marked, violation) => {
    expect(parseMarked(marked)).toEqual({ ok: false, violation });
  });
});

describe("checkMarked: 削るだけで作れたか（全か無か）", () => {
  it("句読点・改行を入れ、フィラーと言い直しを削っただけなら通る", () => {
    expect(checkMarked(TRANSCRIPT, GOOD)).toBeNull();
  });

  it("印のないそのままの文字起こしも通る", () => {
    expect(checkMarked(TRANSCRIPT, TRANSCRIPT)).toBeNull();
  });

  it.each([
    ["言葉を足す", TRANSCRIPT.replace("挙げたんよ", "挙げたんですよ")],
    ["方言を標準語に直す", TRANSCRIPT.replace("じゃね", "だね")],
    ["かなを漢字に書き換える", TRANSCRIPT.replace("みな", "皆")],
    ["聞き間違いを直す", TRANSCRIPT.replace("交番", "公民館")],
    ["語順を変える", TRANSCRIPT.replace("これは式の日じゃね", "式の日じゃね、これは")],
  ])("%s と部分列でなくなる", (_n, marked) => {
    expect(checkMarked(TRANSCRIPT, marked)).toBe("not_subsequence");
  });

  it("数字の表記を変えると外れる（漢数字 → 算用数字、全角 → 半角）", () => {
    expect(checkMarked("昭和の五十三年じゃった", "昭和の53年じゃった")).toBe("not_subsequence");
    expect(checkMarked("１９７８年の夏", "1978年の夏")).toBe("not_subsequence");
  });

  it(`残った文字が transcript の ${CLEAN_MIN_KEPT_RATIO * 100}% に満たなければ外れる（境目はちょうどで通る）`, () => {
    const t = "あいうえおかきくけこ"; // 10 字
    expect(checkMarked(t, "あいうえおかき")).toBeNull(); // 7 字 = 70%
    expect(checkMarked(t, "あいうえおか")).toBe("too_short"); // 6 字
  });

  it(`印の合計が cleaned の ${CLEAN_MAX_UNCERTAIN_RATIO * 100}% を超えると外れる（境目はちょうどで通る）`, () => {
    const t = "あいうえおかきくけこ";
    expect(checkMarked(t, "⟦あいう⟧えおかきくけこ")).toBeNull(); // 3/10
    expect(checkMarked(t, "⟦あいうえ⟧おかきくけこ")).toBe("too_uncertain"); // 4/10
  });

  it("空になったら外れる", () => {
    expect(checkMarked(TRANSCRIPT, "。")).toBe("empty");
  });

  it("印が壊れていたら、その種類を返す", () => {
    expect(checkMarked(TRANSCRIPT, "⟦これは式の日じゃね。")).toBe("marker_unbalanced");
  });

  it("canClean: 意味のある文字がない、印の記号を含む文字起こしは整形しない", () => {
    expect(canClean("これは")).toBe(true);
    expect(canClean("。、 ")).toBe(false);
    expect(canClean("")).toBe(false);
    expect(canClean(null)).toBe(false);
    expect(canClean("あ⟦い")).toBe(false);
  });
});

// ---- 表示 ----

const row = (over: Partial<NarrationRow> = {}): NarrationRow => ({
  id: "n1",
  familyId: "f1",
  speakerMemberId: "m1",
  photoId: "p1",
  entranceId: null,
  replyToId: null,
  requestId: null,
  kind: "voice",
  audioKey: "k",
  audioContentType: "audio/webm",
  durationMs: null,
  transcript: TRANSCRIPT,
  transcriptStatus: "done",
  cleanedText: GOOD_CLEANED,
  cleanedModel: CLAUDE_HAIKU,
  cleanedPromptVersion: "clean_transcript/v2",
  uncertainSpans: [{ start: 10, end: 12 }],
  forDate: "2026-11-03",
  createdAt: 0,
  ...over,
});

describe("displayText: 印の範囲を「……」に置き換える", () => {
  it("整えた文字の、印の範囲だけを置き換える", () => {
    expect(displayText(row())).toBe(`これは式の日じゃね。${UNCERTAIN_PLACEHOLDER}で式を挙げたんよ。\nあの頃は、みなそうじゃった。`);
  });

  it("整形がなければ、文字起こしをそのまま（印なし）出す", () => {
    expect(displayText(row({ cleanedText: null, cleanedModel: null, cleanedPromptVersion: null, uncertainSpans: null }))).toBe(TRANSCRIPT);
  });

  it("範囲が壊れていたら、整形を使わず文字起こしに倒す", () => {
    expect(displayText(row({ uncertainSpans: [{ start: 5, end: 999 }] }))).toBe(TRANSCRIPT);
    expect(displayText(row({ uncertainSpans: [{ start: 5, end: 8 }, { start: 7, end: 9 }] }))).toBe(TRANSCRIPT);
    // 整形があるのに範囲が読めなかった（null）ときも、印を守れないので使わない
    expect(displayText(row({ uncertainSpans: null }))).toBe(TRANSCRIPT);
    expect(displayText(row({ uncertainSpans: [] }))).toBe(GOOD_CLEANED);
  });

  it("文字がなければ null", () => {
    expect(displayText(row({ cleanedText: null, transcript: null, uncertainSpans: null }))).toBeNull();
  });
});

describe("quoteText: 切り出してから置き換える", () => {
  it("範囲は cleanedText の位置。切り出した中の印を「……」にする", () => {
    // 「交番で式を挙げたんよ。」= [10, 21)
    expect(GOOD_CLEANED.slice(10, 21)).toBe("交番で式を挙げたんよ。");
    expect(quoteText(row(), 10, 21)).toBe(`${UNCERTAIN_PLACEHOLDER}で式を挙げたんよ。`);
  });

  it("置き換えてから切ると位置がずれる（順番の確かめ）", () => {
    // 印が一字（「……」は二字）だと、置き換えた後の位置は一字ずつ後ろにずれる
    const r = row({ uncertainSpans: [{ start: 10, end: 11 }] });
    expect(quoteText(r, 12, 21)).toBe("で式を挙げたんよ。");
    expect(displayText(r)!.slice(12, 21)).toBe("番で式を挙げたんよ");
  });

  it("印にかかる切り出しは、かかった所だけを置き換える", () => {
    expect(quoteText(row(), 11, 15)).toBe(`${UNCERTAIN_PLACEHOLDER}で式を`);
  });

  it("印の後ろの切り出しは、そのまま", () => {
    expect(quoteText(row(), 12, 21)).toBe("で式を挙げたんよ。");
  });

  it("切り出しがまるごと印の中なら、引用しない", () => {
    expect(quoteText(row(), 10, 12)).toBeNull();
  });

  it("範囲がなければ全文（置き換え済み）", () => {
    expect(quoteText(row(), null, null)).toBe(displayText(row()));
  });

  it("範囲があるのに整形がなければ、引用しない（transcript の位置ではないため）", () => {
    expect(quoteText(row({ cleanedText: null, cleanedModel: null, cleanedPromptVersion: null, uncertainSpans: null }), 0, 5)).toBeNull();
  });

  it("範囲が外れていたら、引用しない", () => {
    expect(quoteText(row(), 5, 999)).toBeNull();
    expect(quoteText(row(), 8, 8)).toBeNull();
  });

  it("entranceView は quoteText で引く", () => {
    const photo: PhotoRow = {
      id: "p1",
      familyId: "f1",
      ownerMemberId: "m1",
      storageKey: "s",
      contentHash: "h",
      width: 1,
      height: 1,
      takenAt: null,
      latitude: null,
      longitude: null,
      createdAt: 0,
    };
    const e: EntranceRow = {
      id: "e1",
      familyId: "f1",
      memberId: "m1",
      forDate: "2026-11-03",
      photoId: "p1",
      focus: null,
      quoteNarrationId: "n1",
      quoteStart: 10,
      quoteEnd: 21,
      question: "q",
      kind: "claude",
      reason: null,
      model: null,
      promptVersion: null,
      inputNarrationIds: null,
      inputTokens: null,
      outputTokens: null,
      shownAt: null,
      createdAt: 0,
    };
    const v = entranceView(e, photo, row());
    expect(v.quote).toEqual({ narrationId: "n1", speakerMemberId: "m1", text: `${UNCERTAIN_PLACEHOLDER}で式を挙げたんよ。` });
    expect(JSON.stringify(v)).not.toContain("交番");
    expect(entranceView({ ...e, quoteStart: 10, quoteEnd: 12 }, photo, row()).quote).toBeNull();
  });
});

describe("buildCleanInput: 話し手の話し方と、家族の呼ばれ方", () => {
  it("方言と地域、呼ばれ方、文字起こしを入れる", () => {
    const s = buildCleanInput({
      speaker: { calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "広島" },
      familyCalledAs: ["ばあば", "お母さん"],
      transcript: TRANSCRIPT,
    });
    expect(s).toContain("呼ばれ方: ばあば");
    expect(s).toContain("広島の言葉");
    expect(s).toContain("ばあば、お母さん");
    expect(s).toContain(`<transcript>\n${TRANSCRIPT}\n</transcript>`);
  });

  it("標準語なら地域を入れない", () => {
    const s = buildCleanInput({ speaker: { calledAs: "ゆい", speechStyle: "standard", dialectRegion: null }, familyCalledAs: [], transcript: "x" });
    expect(s).toContain("話し方: 標準語");
  });
});

// ---- 背景の流れ（手元の D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const fakeAudio = { bytes: new Uint8Array([1, 2, 3, 4]), type: "audio/webm;codecs=opus" };
function voiceForm(speakerMemberId: string, photoId: string, kind: "voice" | "text" = "voice"): FormData {
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({ kind, speakerMemberId, photoId, entranceId: null, replyToId: null, text: kind === "text" ? TRANSCRIPT : null }),
  );
  if (kind === "voice") form.append("audio", new File([fakeAudio.bytes], "a", { type: fakeAudio.type }));
  return form;
}

const ok = (marked: string): FakeClaudeReply => ({ kind: "json", value: { marked }, model: CLAUDE_HAIKU });

async function setup(replies: FakeClaudeReply[], transcript: { ok: true; text: string } | { ok: false; reason: "upstream" } = { ok: true, text: TRANSCRIPT }) {
  const fc = fakeClaude({ replies });
  const t = makeTestApp(d1, { claude: onlyPurpose(fc.claude, "clean_transcript"), transcriber: fakeTranscriber(() => transcript) });
  const f = await createFamily(t);
  const m = await addMember(t, f.cookie, { calledAs: "ばあば", role: "elder", relation: "祖母", speechStyle: "dialect", dialectRegion: "広島" });
  const p = await addPhoto(t, f.cookie, m.id, 1);
  return { t, f, m, p, fc };
}

async function post(s: Awaited<ReturnType<typeof setup>>, kind: "voice" | "text" = "voice"): Promise<string> {
  const res = await postForm(s.t, "/api/narrations", voiceForm(s.m.id, s.p.id, kind), s.f.cookie);
  expect(res.status).toBe(202);
  const id = ((await res.json()) as { narration: { id: string } }).narration.id;
  await s.t.flush();
  return id;
}

async function dbRow(id: string) {
  return d1
    .prepare("SELECT transcript, cleaned_text, cleaned_model, cleaned_prompt_version, uncertain_spans FROM narrations WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
}

async function listed(s: Awaited<ReturnType<typeof setup>>) {
  const res = await s.t.app.request(`/api/narrations?photoId=${s.p.id}`, { headers: { Cookie: s.f.cookie } });
  return { raw: await res.clone().text(), body: (await res.json()) as { narrations: { id: string; text: string | null }[] } };
}

describe("文字起こしの後に一度だけ整形する", () => {
  it("整えた文字・モデル・版・印を保存し、表示は「……」に置き換えて返す（生の範囲は出さない）", async () => {
    const s = await setup([ok(GOOD)]);
    const id = await post(s);
    expect(await dbRow(id)).toEqual({
      transcript: TRANSCRIPT,
      cleaned_text: GOOD_CLEANED,
      cleaned_model: CLAUDE_HAIKU,
      cleaned_prompt_version: "clean_transcript/v2",
      uncertain_spans: JSON.stringify([{ start: 10, end: 12 }]),
    });
    const { raw, body } = await listed(s);
    expect(body.narrations[0]!.text).toBe(`これは式の日じゃね。${UNCERTAIN_PLACEHOLDER}で式を挙げたんよ。\nあの頃は、みなそうじゃった。`);
    expect(raw).not.toContain("交番");
    expect(raw).not.toMatch(/uncertain|cleaned|"start"|"end"/i);
    expect(raw).not.toContain("⟦");
  });

  it("ログに本文を出さない（ID・種類・数だけ）", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const s = await setup([ok(GOOD.replace("じゃね", "だね")), ok(GOOD)]);
      const id = await post(s);
      const lines = spy.mock.calls.map((c) => String(c[0]));
      const done = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "clean_transcript_done");
      expect(done).toMatchObject({ narrationId: id, status: "done", uncertainSpans: 1, attempts: 2, promptVersion: "clean_transcript/v2" });
      for (const l of lines) {
        expect(l).not.toContain("交番");
        expect(l).not.toContain("式の日");
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("Haiku に、今の版のプロンプトと、話し手の話し方・文字起こしを送る", async () => {
    const s = await setup([ok(GOOD)]);
    await post(s);
    const req = s.fc.requests.find((r) => r.path === "/v1/messages")!;
    const body = req.body as { model: string; system: string; messages: { content: { type: string; text?: string }[] }[] };
    expect(body.model).toBe(CLAUDE_HAIKU);
    expect(body.system).toBe(PROMPTS.clean_transcript.text);
    expect(PROMPTS.clean_transcript.version).toBe("clean_transcript/v2");
    const text = body.messages[0]!.content[0]!.text!;
    expect(text).toContain("呼ばれ方: ばあば");
    expect(text).toContain("広島の言葉");
    expect(text).toContain(TRANSCRIPT);
  });

  it("検査に外れたら 1 回だけ再試行し、通ったものを使う", async () => {
    const s = await setup([ok(GOOD.replace("挙げたんよ", "挙げたんですよ")), ok(GOOD)]);
    const id = await post(s);
    expect(s.fc.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(2);
    expect((await dbRow(id))!.cleaned_text).toBe(GOOD_CLEANED);
  });

  it("2 回とも外れたら cleaned_text は null のまま。transcript がそのまま（印なしで）表示される", async () => {
    const s = await setup([ok("全然ちがう文"), ok(GOOD.replace("じゃね", "だね"))]);
    const id = await post(s);
    expect(s.fc.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(2);
    expect(await dbRow(id)).toMatchObject({ transcript: TRANSCRIPT, cleaned_text: null, cleaned_model: null, uncertain_spans: null });
    const { body } = await listed(s);
    expect(body.narrations[0]!.text).toBe(TRANSCRIPT);
  });

  it("Claude が失敗しても（5xx が続く）、transcript が表示される", async () => {
    const s = await setup([{ kind: "status", status: 500 }, { kind: "status", status: 500 }]);
    const id = await post(s);
    expect((await dbRow(id))!.cleaned_text).toBeNull();
    expect((await listed(s)).body.narrations[0]!.text).toBe(TRANSCRIPT);
  });

  it("一度整形した語りは整形し直さない（冪等）", async () => {
    const s = await setup([ok(GOOD), ok("これは式の日じゃね。")]);
    const id = await post(s);
    const before = await dbRow(id);
    await cleanNarration(s.t.deps, s.f.familyId, id);
    expect(s.fc.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(1);
    // データベースの側でも、整形済みなら書き換えない
    const changed = await s.t.deps.repos.narrations.setCleaned(s.f.familyId, id, {
      cleanedText: "これは",
      cleanedModel: CLAUDE_HAIKU,
      cleanedPromptVersion: "clean_transcript/v2",
      uncertainSpans: [],
    });
    expect(changed).toBe(false);
    expect(await dbRow(id)).toEqual(before);
  });

  it("文字の語りは整形しない（Claude を呼ばない）", async () => {
    const s = await setup([ok(GOOD)]);
    const id = await post(s, "text");
    await cleanNarration(s.t.deps, s.f.familyId, id);
    expect(s.fc.requests).toHaveLength(0);
    expect((await dbRow(id))!.cleaned_text).toBeNull();
    const changed = await s.t.deps.repos.narrations.setCleaned(s.f.familyId, id, {
      cleanedText: "x",
      cleanedModel: CLAUDE_HAIKU,
      cleanedPromptVersion: "clean_transcript/v2",
      uncertainSpans: [],
    });
    expect(changed).toBe(false);
  });

  it("文字起こしが失敗したら整形しない", async () => {
    const s = await setup([ok(GOOD)], { ok: false, reason: "upstream" });
    const id = await post(s);
    expect(s.fc.requests).toHaveLength(0);
    expect(await dbRow(id)).toMatchObject({ transcript: null, cleaned_text: null });
  });

  it("ほかの家族の語りは整形しない", async () => {
    const s = await setup([ok(GOOD), ok(GOOD)]);
    const id = await post(s);
    const other = await createFamily(s.t);
    await d1.prepare("UPDATE narrations SET cleaned_text = NULL, cleaned_model = NULL, cleaned_prompt_version = NULL WHERE id = ?").bind(id).run();
    await cleanNarration(s.t.deps, other.familyId, id);
    expect(s.fc.requests.filter((r) => r.path === "/v1/messages")).toHaveLength(1);
  });
});
