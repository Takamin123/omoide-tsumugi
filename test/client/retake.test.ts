// 「とりなおす」のクライアント（0050）。部品は react-dom/server で文字列にして確かめる（DOM なし）。
// 押した後の流れ（押したらすぐ録り直す。録り直した声が送れたときに前を消す／消せなければ一文。0050 の追記）は、
// React に頼らない lib/retake.ts の afterSent・deleteReplaced と、useRetakeSlot の各操作の形で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { ReplyBox } = await load("../../src/client/parts/ReplyBox");
const { Narrations } = await load("../../src/client/parts/Narrations");
const { ScreenContext, SentNoticeContext } = await load("../../src/client/lib/screen");
const { RetakeContext, retakeSlotFor, retakeRemainingMs, afterSent, deleteReplaced } = await load("../../src/client/lib/retake");
const { RETAKE_SHOW_MS, RETAKE_WINDOW_MS } = await load("../../src/shared/api");
const { words } = await load("../../src/client/words");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const target = { photoId: "p-1", entranceId: "e-1", replyToId: null };
const noop = () => {};
const ctx = (slot: any) => ({ slot, offer: async () => {}, start: noop, end: noop, clear: noop });
const slotAt = (at: string, over: Record<string, unknown> = {}) => ({ at, id: "n-9", sentAt: Date.now(), failed: false, retaking: false, replacing: false, ...over });
const BUTTON_ELDER = '<button type="button" class="retake"><svg aria-hidden="true" width="32" height="32"';
const button = (label: string) => new RegExp(`<button type="button" class="retake"><svg [^>]*>[\\s\\S]*?</svg>${label}</button>`);
const render = (el: any, { elder = false, slot = null as any, notice = null as any } = {}) =>
  renderToStaticMarkup(
    h(
      ScreenContext.Provider,
      { value: elder ? "elder" : "family" },
      h(SentNoticeContext.Provider, { value: notice }, h(RetakeContext.Provider, { value: slot ? ctx(slot) : null }, el)),
    ),
  ) as string;
const voice = (over: Record<string, unknown> = {}) => ({
  id: "n-1",
  speakerMemberId: "m-grandma",
  photoId: "p-1",
  entranceId: null,
  replyToId: null,
  kind: "voice",
  text: "海に行ったのよ",
  transcriptStatus: "done",
  audioUrl: "/api/narrations/n-1/audio",
  durationMs: 13_400,
  createdAt: 1,
  ...over,
});
const narrationsProps = { narrations: [voice()], nameOf: () => "ばあば", openReplyId: null, onOpenReply: noop, onSent: noop };

describe("7 出る所と形", () => {
  it("場所を置くのは声のときだけ（文字には出さない）", () => {
    expect(retakeSlotFor("answer", { id: "n-9", kind: "voice", at: 5 })).toEqual({ at: "answer", id: "n-9", sentAt: 5, failed: false, retaking: false, replacing: false });
    expect(retakeSlotFor("answer", { id: "n-9", kind: "text", at: 5 })).toBeNull();
  });
  it("今日の答え: 流れの欄の先頭（「送りました」のすぐ下、[はなす][かく] の上）に、マイクの印つきのボタン。青（primary）にも補助（aux）にもしない", () => {
    const elder = render(h(ReplyBox, { target, who: "ばあば", retakeAt: "answer" }), { elder: true, slot: slotAt("answer") });
    expect(elder.startsWith(`<div class="stack answer">${BUTTON_ELDER}`)).toBe(true);
    expect(elder).toMatch(new RegExp(`^<div class="stack answer">${button("とりなおす").source}<p class="who answer-who">ばあば</p><div class="grid2 answer-choice">`));
    const family = render(h(ReplyBox, { target, retakeAt: "answer" }), { slot: slotAt("answer") });
    expect(family).toMatch(new RegExp(`^<div class="stack answer">${button("取り直す").source}<div class="grid2 phrase-break">`));
    // マイクの印は「はなす」と同じ形
    const mic = elder.match(/<svg[\s\S]*?<\/svg>/g)!;
    expect(mic[0]).toBe(mic[1]);
    for (const html of [elder, family]) expect(html).not.toMatch(/class="[^"]*(primary|aux)[^"]*"[^>]*><svg[^>]*>[\s\S]*?<\/svg>(とりなおす|取り直す)/);
  });
  it("場所が違う・ない・段（retakeAt を渡さない）・録り直している・前を消している間は出さない", () => {
    expect(render(h(ReplyBox, { target, retakeAt: "answer" }), { slot: slotAt("n-1") })).not.toContain("retake");
    expect(render(h(ReplyBox, { target, retakeAt: "answer" }))).not.toContain("retake");
    expect(render(h(ReplyBox, { target }), { slot: slotAt("answer") })).not.toContain("retake");
    expect(render(h(ReplyBox, { target, retakeAt: "answer" }), { slot: slotAt("answer", { retaking: true }) })).not.toContain("retake");
    expect(render(h(ReplyBox, { target, retakeAt: "answer" }), { slot: slotAt("answer", { replacing: true }) })).not.toContain("retake");
  });
  it("返事: 語りの「送りました」のすぐ下に（返事の欄を開いている間・録り直している間は出さない）", () => {
    const notice = { at: "n-1", show: noop, clear: noop };
    const elder = render(h(Narrations, narrationsProps), { elder: true, slot: slotAt("n-1"), notice });
    expect(elder).toMatch(new RegExp(`<div aria-live="polite"><p class="done">おくりました</p></div>${button("とりなおす").source}`));
    const open = render(h(Narrations, { ...narrationsProps, openReplyId: "n-1" }), { elder: true, slot: slotAt("n-1"), notice });
    expect(open).not.toContain("retake");
    expect(render(h(Narrations, narrationsProps), { slot: slotAt("n-2") })).not.toContain("retake");
    // 録り直している間は「おくりました」も出さない（やめたら、ボタンと一緒に戻る）
    const retaking = render(h(Narrations, { ...narrationsProps, openReplyId: "n-1" }), { elder: true, slot: slotAt("n-1", { retaking: true }), notice });
    expect(retaking).not.toContain("おくりました");
    const retakingFamily = render(h(Narrations, narrationsProps), { slot: slotAt("n-1", { retaking: true }) });
    expect(retakingFamily).not.toContain("送りました");
  });
  it("色: 白地にオレンジ（:root の --retake）の枠と文字。赤（--recording）・青（--accent）は使わず、塗りつぶさない。文字 4.5:1 以上・枠 3:1 以上", () => {
    const css = read("src/client/styles.css");
    const token = css.match(/--retake: (#[0-9a-f]{6});/)![1]!;
    const press = css.match(/--retake-press: (#[0-9a-f]{6});/)![1]!;
    const bg = css.match(/--bg: (#[0-9a-f]{6});/)![1]!;
    expect(contrast(token, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token, press)).toBeGreaterThanOrEqual(4.5);
    const rules = [...css.matchAll(/([^{}]*\.retake\b[^{}]*)\{([^}]*)\}/g)].filter(([, sel]) => !sel!.includes("retake-failed"));
    expect(rules.length).toBeGreaterThan(0);
    const body = rules.map(([, , b]) => b).join("\n");
    expect(body).not.toMatch(/--recording|--accent|--focus/);
    const base = css.match(/\n\.retake \{([^}]*)\}/)![1]!;
    expect(base).toMatch(/border: 3px solid var\(--retake\);/);
    expect(base).toMatch(/color: var\(--retake\);/);
    expect(base).toMatch(/background: var\(--surface\);/);
    expect(css).toMatch(/\.retake:focus-visible \{\s*outline-color: var\(--retake\);/);
  });
  it("大きさ: 家族は「声で話す」「文字で書く」と同じ（--primary-height・--font-main）、祖父母は主な動作（--elder-action-height・--font-elder-action）。横いっぱい", () => {
    const css = read("src/client/styles.css");
    const base = css.match(/\n\.retake \{([^}]*)\}/)![1]!;
    expect(base).toMatch(/min-height: var\(--primary-height\);/);
    expect(base).toMatch(/font-size: var\(--font-main\);/);
    expect(base).toMatch(/width: 100%;/);
    expect(css).toMatch(/\.grid2 > button \{\s*width: 100%;\s*min-height: var\(--primary-height\);/);
    const elder = css.match(/\n\.elder \.retake \{([^}]*)\}/)![1]!;
    expect(elder).toMatch(/min-height: var\(--elder-action-height\);/);
    expect(elder).toMatch(/font-size: var\(--font-elder-action\);/);
  });
});

describe("8 消えるとき", () => {
  it("送ってから RETAKE_SHOW_MS で消える（サーバーの期限より短い）。録り直している間は消さない", () => {
    expect(RETAKE_SHOW_MS).toBeLessThan(RETAKE_WINDOW_MS);
    const slot = slotAt("answer", { sentAt: 1_000 });
    expect(retakeRemainingMs(slot, 1_000)).toBe(RETAKE_SHOW_MS);
    expect(retakeRemainingMs(slot, 1_000 + RETAKE_SHOW_MS)).toBe(0);
    const src = code("src/client/lib/retake.ts");
    expect(src).toMatch(/if \(!slot \|\| slot\.retaking\) return;\s*const t = setTimeout\(\(\) => put\(\(s\) => \(s === slot \? null : s\)\), Math\.max\(0, retakeRemainingMs\(slot, Date\.now\(\)\)\)\)/);
  });
  it("次に「はなす」「かく」「へんじ」（家族は「声で話す」「文字で書く」「返事」）を押したら消える。録り直している間は消さない", () => {
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/const clearNotices = \(\) => \{\s*notice\?\.clear\(\);\s*retakeSlot\?\.clear\(\);\s*\};/);
    expect(box.match(/clearNotices\(\);/g)).toHaveLength(4);
    expect(box).not.toMatch(/onClick=\{\(\) => setMode\("text"\)\}/);
    expect(code("src/client/parts/Narrations.tsx")).toMatch(/notice\?\.clear\(\);\s*retake\?\.clear\(\);\s*onReplying\(true\);/);
    expect(code("src/client/lib/retake.ts")).toContain("const clear = useCallback(() => put((s) => (s?.retaking ? s : null)), [put]);");
  });
  it("家族の画面: 声のときは「送りました」をボタンと一緒に残す（4 秒で消さない）。文字は 4 秒のまま。録り直している間は出さない", () => {
    const home = code("src/client/screens/Home.tsx");
    expect(home).toMatch(/else if \(sent\.kind === "text"\) \{\s*setSentNotice\(true\);\s*sentTimer\.current = setTimeout\(\(\) => setSentNotice\(false\), SENT_NOTICE_MS\);\s*\} else setSentNotice\(false\);/);
    expect(home).toContain('const showAnswerNotice = !answerSlot?.retaking && (elder ? noticeAt === "answer" : sentNotice || !!answerSlot);');
    const narr = code("src/client/parts/Narrations.tsx");
    expect(narr).toMatch(/else if \(s\.kind === "text"\) \{\s*setSent\(true\);\s*timer\.current = setTimeout\(\(\) => setSent\(false\), SENT_NOTICE_MS\);/);
    const html = render(h(Narrations, narrationsProps), { slot: slotAt("n-1") });
    expect(html).toMatch(new RegExp(`<p class="done">送りました</p></div>${button("取り直す").source}`));
  });
  it("祖父母の画面の「おくりました」は次の操作まで残す（場所の時間で消さない。0043）", () => {
    expect(code("src/client/screens/Home.tsx")).toMatch(/if \(elder\) setNoticeAt\("answer"\);/);
  });
});

describe("9 押した後（押したらすぐ録り直し、送れたときに前を消す）", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number) => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ error: "not_found" }), { status });
    });
    return calls;
  };
  const voiceSent = { id: "n-new", kind: "voice", at: 7 };

  it("押しても DELETE しない（ボタンは録り直しを始めて、呼ぶ側が録り始めるだけ）", () => {
    const src = code("src/client/parts/Retake.tsx");
    expect(src).toMatch(/onClick=\{\(\) => \{\s*retake\.start\(at\);\s*onRetake\(\);\s*\}\}/);
    expect(src).not.toMatch(/deleteNarration|deleteReplaced|api\./);
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/onRetake=\{\(\) => \{\s*setMicError\(false\);\s*if \(!elder\) setMode\("voice"\);\s*rec\.toggle\(\);\s*\}\}/);
    expect(box).not.toMatch(/deleteNarration/);
  });
  it("録り直していた場所に声が送れたら、前の語りを消す（一つだけ。消している間はボタンを出さない）", () => {
    const prev = slotAt("answer", { id: "n-old", retaking: true });
    expect(afterSent(prev, "answer", voiceSent)).toEqual({
      next: { at: "answer", id: "n-new", sentAt: 7, failed: false, retaking: false, replacing: true },
      replaced: "n-old",
    });
  });
  it("録り直していない・場所が違う・文字が送れた・前がない → 消さない（新しく送った声には、またボタンを置く）", () => {
    const plain = afterSent(slotAt("answer", { id: "n-old" }), "answer", voiceSent);
    expect(plain).toEqual({ next: { at: "answer", id: "n-new", sentAt: 7, failed: false, retaking: false, replacing: false }, replaced: null });
    expect(afterSent(slotAt("n-1", { id: "n-old", retaking: true }), "answer", voiceSent).replaced).toBeNull();
    expect(afterSent(slotAt("answer", { id: "n-old", retaking: true }), "answer", { ...voiceSent, kind: "text" })).toEqual({ next: null, replaced: null });
    expect(afterSent(null, "answer", voiceSent).replaced).toBeNull();
  });
  it("前の前の声は消さない（一回ごとに直前の一つだけ）", () => {
    const first = afterSent(slotAt("answer", { id: "n-a", retaking: true }), "answer", { id: "n-b", kind: "voice", at: 1 });
    expect(first.replaced).toBe("n-a");
    const second = afterSent({ ...first.next!, replacing: false, retaking: true }, "answer", { id: "n-c", kind: "voice", at: 2 });
    expect(second.replaced).toBe("n-b");
  });
  it("204: DELETE /api/narrations/:id を一度だけ送り、done(true)", async () => {
    const calls = stub(204);
    const done = vi.fn();
    await deleteReplaced("n-old", done);
    expect(calls).toEqual([{ url: "/api/narrations/n-old", method: "DELETE" }]);
    expect(done).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("404: done(false)（新しい場所を一文に替え、二つとも残る）。自動で送り直さない", async () => {
    const calls = stub(404);
    const done = vi.fn();
    await deleteReplaced("n-old", done);
    expect(calls).toHaveLength(1);
    expect(done).toHaveBeenCalledExactlyOnceWith(false);
    const src = code("src/client/lib/retake.ts");
    expect(src).toMatch(/put\(\(s\) => \(s && s\.id === next\.id \? \{ \.\.\.s, replacing: false, failed: !deleted \} : s\)\)/);
  });
  it("やめる・短すぎて捨てた・マイクが使えない・欄が閉じた → 取り直しを終えるだけ（DELETE しない。ボタンは期限内なら戻る）", () => {
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/const endRetake = \(\) => \{\s*if \(at\) retakeSlot\?\.end\(at\);\s*\};/);
    expect(box).toMatch(/onMicError: \(\) => \{\s*setMicError\(true\);\s*endRetake\(\);\s*\},\s*onDiscarded: endRetake,/);
    expect(box).toMatch(/const close = \(\) => \{\s*setMicError\(false\);\s*rec\.cancel\(\);\s*endRetake\(\);/);
    expect(box).toMatch(/queueMicrotask\(\(\) => \{\s*if \(!mounted\.current\) endRef\.current\(\);\s*\}\);/);
    const lib = code("src/client/lib/retake.ts");
    expect(lib).toContain("const end = useCallback((at: string) => put((s) => (s && s.at === at && s.retaking ? { ...s, retaking: false } : s)), [put]);");
    // end は送らない（DELETE は offer の中だけ）
    expect(lib.match(/deleteNarration/g)).toHaveLength(1);
    expect(code("src/client/parts/VoiceRecorder.tsx")).toMatch(/if \(durationMs >= MIN_RECORDING_MS\) onBlob\(blob, durationMs\);\s*else onDiscarded\?\.\(\);/);
  });
  it("新しい声の送信に失敗 → 何も消さない（取り直しは続き、送り直せたら offer で消す）", () => {
    // 消すのは送れたときの offer だけ。送れなかったときの流れ（useSender の failed）は retake に触れない
    expect(code("src/client/lib/useSender.ts")).not.toMatch(/retake|deleteNarration/);
    expect(code("src/client/screens/Home.tsx")).toMatch(/const replaced = offerRetake\("answer", sent\);/);
  });
  it("今日の答え: 押したら同じ欄で録り始める（家族は声の段で）。前は残るので段は流れのまま（取り直し用の段の固定はない）", () => {
    const home = code("src/client/screens/Home.tsx");
    expect(home).not.toMatch(/setRetaking|\[retaking,|answeredHere \|\|\s*retaking/);
    // 答えた印を戻すのは、前に戻ったときの読み直しで入り口そのものが替わったときだけ（0051）。取り直しでは戻さない
    expect(home.match(/setAnsweredHere\(false\)/g)).toHaveLength(1);
    expect(home).toMatch(/if \(\(next\?\.id \?\? null\) !== \(shown\.current\?\.id \?\? null\)\) \{\s*setAnsweredHere\(false\);/);
    expect(home).toContain('retakeAt="answer"');
    // 段（dock）の ReplyBox には渡さない
    expect(home).toMatch(/<ReplyBox target=\{answerTarget\} sender=\{answer\} who=\{who\} onComposing=\{setDockComposing\} \/>/);
    // 消し終えてから一覧を読み直す
    expect(home).toMatch(/void replaced\.then\(\(\) => loadFeed\(\)\);/);
  });
  it("返事: 押したら返事の欄をすぐ録り始める形で開く。消し終えてから一覧を読み直す", () => {
    const narr = code("src/client/parts/Narrations.tsx");
    expect(narr).toMatch(/onRetake=\{\(\) => \{\s*setAutoStart\(true\);\s*onReplying\(true\);\s*\}\}/);
    expect(narr).toMatch(/const replaced = retake\?\.offer\(narration\.id, s\);[\s\S]{0,400}if \(replaced\) void replaced\.then\(onSent\);\s*else onSent\(\);/);
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/useEffect\(\(\) => \{\s*if \(autoStart\) rec\.toggle\(\);\s*\}, \[\]\);/);
    expect(box).toContain('useState<"choose" | "text" | "voice">(autoStart && !elder ? "voice" : "choose")');
  });
  it("消せなかったとき: 録り直した声の「おくりました」の下に一文。[はなす][かく] はそのまま", () => {
    const html = render(h(ReplyBox, { target, who: "ばあば", retakeAt: "answer" }), { elder: true, slot: slotAt("answer", { failed: true }) });
    expect(html).toContain(`<p role="alert" class="retake-failed">${words.screen.elder.retakeFailed}</p>`);
    expect(html).not.toContain('class="retake"');
    expect(html).toContain("answer-choice");
    const family = render(h(Narrations, narrationsProps), { slot: slotAt("n-1", { failed: true }) });
    expect(family).toMatch(new RegExp(`<p class="done">送りました</p></div><p role="alert" class="sub retake-failed">${words.screen.family.retakeFailed}</p>`));
  });
});

describe("10 言葉", () => {
  it("ボタンは祖父母「とりなおす」、家族「取り直す」。消せなかったときは両画面で同じ文", () => {
    expect(words.screen.elder.retake).toBe("とりなおす");
    expect(words.screen.family.retake).toBe("取り直す");
    expect(words.screen.elder.retakeFailed).toBe("取り直せませんでした。前の声は残っています");
    expect(words.screen.family.retakeFailed).toBe(words.screen.elder.retakeFailed);
  });
  it("出さない言葉（消しました・もう一度話せます・！・お礼・削除・エラー）", () => {
    for (const s of [words.screen.elder.retake, words.screen.family.retake, words.screen.elder.retakeFailed]) {
      expect(s).not.toMatch(/消しました|もう一度話せます|！|!|ありがとう|削除|エラー/);
    }
  });
});

describe("11 0043 の高さ（送る前の段・語り一つ）を変えない", () => {
  it("場所がなければ、欄と語りの組み立ては今までと同じ（ボタンも一文も出ない）", () => {
    const boxWith = render(h(ReplyBox, { target, who: "ばあば", retakeAt: "answer" }), { elder: true });
    const boxWithout = render(h(ReplyBox, { target, who: "ばあば" }), { elder: true });
    expect(boxWith).toBe(boxWithout);
    const narrWith = render(h(Narrations, narrationsProps), { elder: true, slot: slotAt("n-other") });
    const narrWithout = render(h(Narrations, narrationsProps), { elder: true });
    expect(narrWith).toBe(narrWithout);
  });
  it("段・語り・補助のボタンの CSS に手を入れていない（足したのは .retake と一文の余白だけ）", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.aux \{\s*font-size: var\(--font-aux\);\s*min-height: var\(--tap-min\);\s*gap: 0\.5rem;\s*align-self: flex-start;\s*\}/);
    expect(css).toMatch(/\.retake-failed \{\s*margin: 0;\s*min-height: var\(--tap-min\);\s*\}/);
  });
});

/** WCAG のコントラスト比 */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}
