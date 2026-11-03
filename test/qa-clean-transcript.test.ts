// QA が足した、文字起こしの整形（0018）の確かめ。架空の語りだけを使う。Claude は偽物。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UNCERTAIN_PLACEHOLDER, checkMarked, cleanNarration, displayText, parseMarked, quoteText } from "../src/server/core/clean-transcript";
import { CLAUDE_HAIKU } from "../src/server/core/claude";
import type { NarrationRow } from "../src/server/core/ports";
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

const TRANSCRIPT = "えー、これは式の日じゃね。交番で式を挙げたんよ。あの、あの頃は、みなそうじゃった。";
const GOOD = "これは式の日じゃね。⟦交番⟧で式を挙げたんよ。\nあの頃は、みなそうじゃった。";
const CLEANED = "これは式の日じゃね。交番で式を挙げたんよ。\nあの頃は、みなそうじゃった。";

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
  cleanedText: CLEANED,
  cleanedModel: CLAUDE_HAIKU,
  cleanedPromptVersion: "clean_transcript/v2",
  uncertainSpans: [{ start: 10, end: 12 }],
  forDate: "2026-11-03",
  createdAt: 0,
  ...over,
});

describe("checkMarked の境目（QA）", () => {
  it("サロゲートペアの字を別の字に変えると外れる（𠮷 → 吉）", () => {
    expect(checkMarked("𠮷田のばあちゃん", "吉田のばあちゃん")).toBe("not_subsequence");
    expect(checkMarked("𠮷田のばあちゃん", "⟦𠮷田⟧の、ばあちゃん")).toBeNull();
  });

  it("カタカナとひらがなを入れ替えると外れる", () => {
    expect(checkMarked("あのテレビじゃ", "あのてれびじゃ")).toBe("not_subsequence");
  });

  it("全角の空白や記号だけを足す・取るのは通る", () => {
    expect(checkMarked("あれは　夏じゃった", "あれは、夏じゃった！")).toBeNull();
  });

  it("同じ字を重ねて足すと外れる（部分列でない）", () => {
    expect(checkMarked("そうじゃ", "そうじゃじゃ")).toBe("not_subsequence");
  });

  it("印の中で字を変えても外れる（印は直さず囲むだけ）", () => {
    expect(checkMarked(TRANSCRIPT, GOOD.replace("⟦交番⟧", "⟦公民館⟧"))).toBe("not_subsequence");
  });

  it("句読点をまたいで隣り合わない印はまとめない", () => {
    expect(parseMarked("⟦あ⟧、⟦い⟧")).toEqual({ ok: true, cleanedText: "あ、い", spans: [{ start: 0, end: 1 }, { start: 2, end: 3 }] });
  });
});

describe("quoteText の境目（QA）", () => {
  it("印と句読点だけが残る切り出しは引用しない", () => {
    // [9, 12) = 「。交番」 → 「。……」
    expect(CLEANED.slice(9, 12)).toBe("。交番");
    expect(quoteText(row(), 9, 12)).toBeNull();
  });

  it("二つの印をまたぐ切り出しは、両方を置き換える", () => {
    const r = row({ uncertainSpans: [{ start: 10, end: 12 }, { start: 13, end: 14 }] });
    expect(CLEANED.slice(13, 14)).toBe("式");
    expect(quoteText(r, 10, 21)).toBe(`${UNCERTAIN_PLACEHOLDER}で${UNCERTAIN_PLACEHOLDER}を挙げたんよ。`);
    expect(displayText(r)).toBe(`これは式の日じゃね。${UNCERTAIN_PLACEHOLDER}で${UNCERTAIN_PLACEHOLDER}を挙げたんよ。\nあの頃は、みなそうじゃった。`);
  });

  it("負の位置・小数の位置は引用しない", () => {
    expect(quoteText(row(), -1, 5)).toBeNull();
    expect(quoteText(row(), 0.5, 5)).toBeNull();
  });

  it("片方だけ null なら全文", () => {
    expect(quoteText(row(), 3, null)).toBe(displayText(row()));
  });

  it("cleanedText が空文字なら整形なしとして transcript に倒す", () => {
    expect(displayText(row({ cleanedText: "", uncertainSpans: [] }))).toBe(TRANSCRIPT);
  });

  it("整形があるのに uncertainSpans が null（読めなかった）なら、印の中の語を出さず transcript に倒す", () => {
    expect(displayText(row({ uncertainSpans: null }))).toBe(TRANSCRIPT);
    expect(quoteText(row({ uncertainSpans: null }), 12, 21)).toBeNull();
  });

  it("uncertainSpans が空の配列なら、整えた文字をそのまま出す", () => {
    expect(displayText(row({ uncertainSpans: [] }))).toBe(CLEANED);
  });

  it("サロゲートペアの後ろの印も、UTF-16 の位置で置き換える", () => {
    const parsed = parseMarked("𠮷野の⟦家⟧じゃ");
    if (!parsed.ok) throw new Error("parse");
    const r = row({ transcript: "𠮷野の家じゃ", cleanedText: parsed.cleanedText, uncertainSpans: parsed.spans });
    expect(displayText(r)).toBe(`𠮷野の${UNCERTAIN_PLACEHOLDER}じゃ`);
  });
});

describe("データベースの uncertain_spans が壊れていても、表示が落ちない（QA）", () => {
  it.each([
    ["配列でない", { start: 1, end: 2 }],
    ["中に null", [null]],
    ["文字の位置", [{ start: "1", end: "2" }]],
  ])("%s なら transcript に倒す", (_n, spans) => {
    const r = row({ uncertainSpans: spans as unknown as NarrationRow["uncertainSpans"] });
    expect(() => displayText(r)).not.toThrow();
    expect(displayText(r)).toBe(TRANSCRIPT);
  });
});

// ---- 背景の流れ（手元の D1） ----

let d1: D1Database;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
}, 60_000);
afterAll(() => dispose());

const ok = (marked: string): FakeClaudeReply => ({ kind: "json", value: { marked }, model: CLAUDE_HAIKU });

async function setup(replies: FakeClaudeReply[], transcriptText = TRANSCRIPT) {
  const fc = fakeClaude({ replies });
  const t = makeTestApp(d1, { claude: onlyPurpose(fc.claude, "clean_transcript"), transcriber: fakeTranscriber(() => ({ ok: true, text: transcriptText })) });
  const f = await createFamily(t);
  // 家族を作った人が、話し手のばあばを足す。語りはばあばの端末（cookie）から送る
  const creator = await addMember(t, f.cookie);
  const m = await addMember(t, creator.cookie, { calledAs: "ばあば", role: "elder", relation: "祖母", speechStyle: "dialect", dialectRegion: "広島" });
  const p = await addPhoto(t, m.cookie, 1);
  return { t, f, m, p, fc };
}

async function postVoice(s: Awaited<ReturnType<typeof setup>>): Promise<string> {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "voice", photoId: s.p.id, entranceId: null, replyToId: null, text: null }));
  form.append("audio", new File([new Uint8Array([1, 2, 3, 4])], "a", { type: "audio/webm;codecs=opus" }));
  const res = await postForm(s.t, "/api/narrations", form, s.m.cookie);
  expect(res.status).toBe(202);
  const id = ((await res.json()) as { narration: { id: string } }).narration.id;
  await s.t.flush();
  return id;
}

const messages = (s: { fc: { requests: { path: string }[] } }) => s.fc.requests.filter((r) => r.path === "/v1/messages");

describe("整形の背景の流れ（QA）", () => {
  it("検査に外れ続けても、再試行は 1 回だけ（合計 2 回）", async () => {
    const bad = ok(GOOD.replace("じゃね", "だね"));
    const s = await setup([bad, bad, bad, bad]);
    const id = await postVoice(s);
    expect(messages(s)).toHaveLength(2);
    const row = await d1.prepare("SELECT cleaned_text FROM narrations WHERE id = ?").bind(id).first<{ cleaned_text: string | null }>();
    expect(row!.cleaned_text).toBeNull();
  });

  it("文字起こしに印の記号があれば、Claude を呼ばずに transcript をそのまま出す", async () => {
    const t = "これは⟦交番⟧じゃね";
    const s = await setup([ok(t)], t);
    const id = await postVoice(s);
    expect(messages(s)).toHaveLength(0);
    const res = await s.t.app.request(`/api/narrations?photoId=${s.p.id}`, { headers: { Cookie: s.m.cookie } });
    const body = (await res.json()) as { narrations: { id: string; text: string | null }[] };
    expect(body.narrations.find((n) => n.id === id)!.text).toBe(t);
  });

  it("意味のある文字がない文字起こしは整形しない", async () => {
    const s = await setup([ok("。")], "。、 ");
    await postVoice(s);
    expect(messages(s)).toHaveLength(0);
  });

  it("2 回とも外れたときのログにも、本文が出ない", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const s = await setup([ok("交番の式の日だね"), ok("交番の式の日だね")]);
      await postVoice(s);
      const lines = [...spy.mock.calls, ...warn.mock.calls, ...err.mock.calls].map((c) => c.map(String).join(" "));
      const done = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.event === "clean_transcript_done");
      expect(done).toMatchObject({ status: "failed" });
      for (const l of lines) {
        expect(l).not.toContain("交番");
        expect(l).not.toContain("式の日");
      }
    } finally {
      spy.mockRestore();
      warn.mockRestore();
      err.mockRestore();
    }
  });

  it.each([
    ["JSON でない", "abc"],
    ["配列でない JSON", '{"start":1,"end":2}'],
  ])("uncertain_spans が %s でも、語りの一覧は 200 で、transcript に倒す", async (_n, raw) => {
    const s = await setup([ok(GOOD)]);
    const id = await postVoice(s);
    await d1.prepare("UPDATE narrations SET uncertain_spans = ? WHERE id = ?").bind(raw, id).run();
    const res = await s.t.app.request(`/api/narrations?photoId=${s.p.id}`, { headers: { Cookie: s.m.cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { narrations: { id: string; text: string | null }[] };
    expect(body.narrations.find((n) => n.id === id)!.text).toBe(TRANSCRIPT);
  });

  it("ほかの家族の ID では、整形を書き込めない", async () => {
    const s = await setup([ok(GOOD)]);
    const id = await postVoice(s);
    await d1
      .prepare("UPDATE narrations SET cleaned_text = NULL, cleaned_model = NULL, cleaned_prompt_version = NULL, uncertain_spans = NULL WHERE id = ?")
      .bind(id)
      .run();
    const other = await createFamily(s.t);
    const changed = await s.t.deps.repos.narrations.setCleaned(other.familyId, id, {
      cleanedText: "これは",
      cleanedModel: CLAUDE_HAIKU,
      cleanedPromptVersion: "clean_transcript/v2",
      uncertainSpans: [],
    });
    expect(changed).toBe(false);
    await cleanNarration(s.t.deps, other.familyId, id);
    expect(messages(s)).toHaveLength(1);
    const r = await d1.prepare("SELECT cleaned_text FROM narrations WHERE id = ?").bind(id).first<{ cleaned_text: string | null }>();
    expect(r!.cleaned_text).toBeNull();
  });
});
