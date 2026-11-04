// 「とりなおす」のクライアント（0050）。部品は react-dom/server で文字列にして確かめる（DOM なし）。
// 押した後の流れ（消す → 録り始める／一文）は、React に頼らない lib/retake.ts の runRetake で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { ReplyBox } = await load("../../src/client/parts/ReplyBox");
const { Narrations } = await load("../../src/client/parts/Narrations");
const { ScreenContext, SentNoticeContext } = await load("../../src/client/lib/screen");
const { RetakeContext, retakeSlotFor, retakeRemainingMs, runRetake } = await load("../../src/client/lib/retake");
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
const answerRetake = { at: "answer", onStart: noop, onEnd: noop };
const ctx = (slot: any) => ({ slot, offer: noop, fail: noop, clear: noop, isCurrent: () => true });
const slotAt = (at: string, over: Record<string, unknown> = {}) => ({ at, id: "n-9", sentAt: Date.now(), failed: false, ...over });
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
    expect(retakeSlotFor("answer", { id: "n-9", kind: "voice", at: 5 })).toEqual({ at: "answer", id: "n-9", sentAt: 5, failed: false });
    expect(retakeSlotFor("answer", { id: "n-9", kind: "text", at: 5 })).toBeNull();
  });
  it("今日の答え: 流れの欄の先頭（「送りました」のすぐ下、[はなす][かく] の上）に補助のボタン。青にしない", () => {
    const elder = render(h(ReplyBox, { target, who: "ばあば", retake: answerRetake }), { elder: true, slot: slotAt("answer") });
    expect(elder).toMatch(/^<div class="stack answer"><button type="button" class="aux retake">とりなおす<\/button><p class="who answer-who">ばあば<\/p><div class="grid2 answer-choice">/);
    const family = render(h(ReplyBox, { target, retake: answerRetake }), { slot: slotAt("answer") });
    expect(family).toMatch(/^<div class="stack answer"><button type="button" class="aux retake">取り直す<\/button><div class="grid2 phrase-break">/);
    expect(family).not.toMatch(/class="[^"]*primary[^"]*"[^>]*>取り直す/);
  });
  it("場所が違う・ない・段（retake を渡さない）には出さない", () => {
    expect(render(h(ReplyBox, { target, retake: answerRetake }), { slot: slotAt("n-1") })).not.toContain("retake");
    expect(render(h(ReplyBox, { target, retake: answerRetake }))).not.toContain("retake");
    expect(render(h(ReplyBox, { target }), { slot: slotAt("answer") })).not.toContain("retake");
  });
  it("返事: 語りの「送りました」のすぐ下に（返事の欄を開いている間は出さない）", () => {
    const elder = render(h(Narrations, narrationsProps), { elder: true, slot: slotAt("n-1"), notice: { at: "n-1", show: noop, clear: noop } });
    expect(elder).toContain('<div aria-live="polite"><p class="done">おくりました</p></div><button type="button" class="aux retake">とりなおす</button>');
    const open = render(h(Narrations, { ...narrationsProps, openReplyId: "n-1" }), { elder: true, slot: slotAt("n-1"), notice: { at: "n-1", show: noop, clear: noop } });
    expect(open).not.toContain("retake");
    expect(render(h(Narrations, narrationsProps), { slot: slotAt("n-2") })).not.toContain("retake");
  });
  it("祖父母の補助のボタンは .elder .aux（白い枠、48px 以上）。新しい色を足さない", () => {
    const css = read("src/client/styles.css");
    expect(css).not.toMatch(/\.retake\s*\{/);
    expect(css).toMatch(/--tap-min: 3\.25rem;/);
  });
});

describe("8 消えるとき", () => {
  it("送ってから RETAKE_SHOW_MS で消える（サーバーの期限より短い）", () => {
    expect(RETAKE_SHOW_MS).toBeLessThan(RETAKE_WINDOW_MS);
    const slot = slotAt("answer", { sentAt: 1_000 });
    expect(retakeRemainingMs(slot, 1_000)).toBe(RETAKE_SHOW_MS);
    expect(retakeRemainingMs(slot, 1_000 + RETAKE_SHOW_MS)).toBe(0);
    const src = code("src/client/lib/retake.ts");
    expect(src).toMatch(/setTimeout\(\(\) => setSlot\(\(s\) => \(s === slot \? null : s\)\), Math\.max\(0, retakeRemainingMs\(slot, Date\.now\(\)\)\)\)/);
  });
  it("次に「はなす」「かく」「へんじ」（家族は「声で話す」「文字で書く」「返事」）を押したら消える", () => {
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/const clearNotices = \(\) => \{\s*notice\?\.clear\(\);\s*retakeSlot\?\.clear\(\);\s*\};/);
    // 祖父母の「はなす」「かく」、家族の「声で話す」「文字で書く」の四つ
    expect(box.match(/clearNotices\(\);/g)).toHaveLength(4);
    expect(box).not.toMatch(/onClick=\{\(\) => setMode\("text"\)\}/);
    expect(code("src/client/parts/Narrations.tsx")).toMatch(/notice\?\.clear\(\);\s*retake\?\.clear\(\);\s*onReplying\(true\);/);
  });
  it("家族の画面: 声のときは「送りました」をボタンと一緒に残す（4 秒で消さない）。文字は 4 秒のまま", () => {
    const home = code("src/client/screens/Home.tsx");
    expect(home).toMatch(/else if \(sent\.kind === "text"\) \{\s*setSentNotice\(true\);\s*sentTimer\.current = setTimeout\(\(\) => setSentNotice\(false\), SENT_NOTICE_MS\);\s*\} else setSentNotice\(false\);/);
    expect(home).toContain('const showAnswerNotice = elder ? noticeAt === "answer" : sentNotice || retake.slot?.at === "answer";');
    const narr = code("src/client/parts/Narrations.tsx");
    expect(narr).toMatch(/else if \(s\.kind === "text"\) \{\s*setSent\(true\);\s*timer\.current = setTimeout\(\(\) => setSent\(false\), SENT_NOTICE_MS\);/);
    // 家族の画面の語り: 場所があれば「送りました」を出す
    const html = render(h(Narrations, narrationsProps), { slot: slotAt("n-1") });
    expect(html).toContain('<p class="done">送りました</p></div><button type="button" class="aux retake">取り直す</button>');
  });
  it("祖父母の画面の「おくりました」は次の操作まで残す（場所の時間で消さない。0043）", () => {
    const home = code("src/client/screens/Home.tsx");
    expect(home).toMatch(/if \(elder\) setNoticeAt\("answer"\);/);
  });
});

describe("9 押した後", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number) => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method });
      return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify({ error: "not_found" }), { status });
    });
    return calls;
  };
  const spy = (current = true) => ({ isCurrent: vi.fn(() => current), clear: vi.fn(), fail: vi.fn() });

  it("204: DELETE /api/narrations/:id を一度だけ送り、場所を消して onRetaken(true)", async () => {
    const calls = stub(204);
    const r = spy();
    const onRetaken = vi.fn();
    await runRetake(r, "n-9", onRetaken);
    expect(calls).toEqual([{ url: "/api/narrations/n-9", method: "DELETE" }]);
    expect(r.clear).toHaveBeenCalledTimes(1);
    expect(r.fail).not.toHaveBeenCalled();
    expect(onRetaken).toHaveBeenCalledWith(true);
  });
  it("404: 一文に替え（fail）、録り始めない。自動で送り直さない", async () => {
    const calls = stub(404);
    const r = spy();
    const onRetaken = vi.fn();
    await runRetake(r, "n-9", onRetaken);
    expect(calls).toHaveLength(1);
    expect(r.fail).toHaveBeenCalledWith("n-9");
    expect(onRetaken).not.toHaveBeenCalled();
  });
  it("消す間にほかの操作をしていたら、録り始めない（onRetaken(false)。一覧の読み直しだけ）", async () => {
    stub(204);
    const r = spy(false);
    const onRetaken = vi.fn();
    await runRetake(r, "n-9", onRetaken);
    expect(r.clear).not.toHaveBeenCalled();
    expect(onRetaken).toHaveBeenCalledWith(false);
  });
  it("押したら押せない形（aria-disabled）で待ち、二度押しは無視する", () => {
    const src = code("src/client/parts/Retake.tsx");
    expect(src).toContain('aria-disabled={deleting ? "true" : undefined}');
    expect(src).toMatch(/if \(busy\.current\) return;/);
  });
  it("今日の答え: 消えたら同じ欄で録り始める（家族は声の段で）。取り直しの間は段を流れに置いたまま", () => {
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/retake\.onStart\(current\);\s*if \(!current\) return;\s*setMicError\(false\);\s*if \(!elder\) setMode\("voice"\);\s*rec\.toggle\(\);/);
    // 短すぎて捨てた・やめたら、取り直しを外す（feed どおりに戻す）
    expect(box).toContain("onDiscarded: () => retake?.onEnd(),");
    expect(box).toMatch(/const close = \(\) => \{\s*setMicError\(false\);\s*rec\.cancel\(\);\s*retake\?\.onEnd\(\);/);
    const home = code("src/client/screens/Home.tsx");
    expect(home).toMatch(/answeredHere \|\|\s*retaking \|\|/);
    expect(home).toMatch(/setAnsweredHere\(false\);\s*setRetaking\(true\);/);
    expect(home).toContain("retake={answerRetake}");
    // 段（dock）の ReplyBox には渡さない
    expect(home).toMatch(/<ReplyBox target=\{answerTarget\} sender=\{answer\} who=\{who\} onComposing=\{setDockComposing\} \/>/);
    expect(code("src/client/parts/VoiceRecorder.tsx")).toMatch(/if \(durationMs >= MIN_RECORDING_MS\) onBlob\(blob, durationMs\);\s*else onDiscarded\?\.\(\);/);
  });
  it("返事: 消えたら一覧を読み直し、返事の欄をすぐ録り始める形で開く", () => {
    const narr = code("src/client/parts/Narrations.tsx");
    expect(narr).toMatch(/onRetaken=\{\(current\) => \{\s*onSent\(\);\s*if \(!current\) return;[\s\S]{0,80}setAutoStart\(true\);\s*onReplying\(true\);/);
    const box = code("src/client/parts/ReplyBox.tsx");
    expect(box).toMatch(/useEffect\(\(\) => \{\s*if \(autoStart\) rec\.toggle\(\);\s*\}, \[\]\);/);
    expect(box).toContain('useState<"choose" | "text" | "voice">(autoStart && !elder ? "voice" : "choose")');
  });
  it("消せなかったとき: 一文を出し、[はなす][かく] はそのまま（録り始めない）", () => {
    const html = render(h(ReplyBox, { target, who: "ばあば", retake: answerRetake }), { elder: true, slot: slotAt("answer", { failed: true }) });
    expect(html).toContain(`<p role="alert" class="retake-failed">${words.screen.elder.retakeFailed}</p>`);
    expect(html).not.toContain("class=\"aux retake\"");
    expect(html).toContain("answer-choice");
    const family = render(h(Narrations, narrationsProps), { slot: slotAt("n-1", { failed: true }) });
    expect(family).toContain(`<p role="alert" class="sub retake-failed">${words.screen.family.retakeFailed}</p>`);
  });
  it("フォーカス: ボタンが消えたら、録音の主ボタン（focusFollows）か、消せなかったら「はなす」「返事」へ", () => {
    expect(code("src/client/parts/ReplyBox.tsx")).toMatch(/<Retake\s+at=\{retake\.at\}\s+focusAfter=\{primaryRef\}/);
    expect(code("src/client/parts/Narrations.tsx")).toMatch(/<Retake\s+at=\{narration\.id\}\s+focusAfter=\{replyRef\}/);
    expect(code("src/client/parts/Retake.tsx")).toMatch(/document\.activeElement === null \|\| document\.activeElement === document\.body\) focusAfter\.current\?\.focus\(\)/);
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
    const boxWith = render(h(ReplyBox, { target, who: "ばあば", retake: answerRetake }), { elder: true });
    const boxWithout = render(h(ReplyBox, { target, who: "ばあば" }), { elder: true });
    expect(boxWith).toBe(boxWithout);
    const narrWith = render(h(Narrations, narrationsProps), { elder: true, slot: slotAt("n-other") });
    const narrWithout = render(h(Narrations, narrationsProps), { elder: true });
    expect(narrWith).toBe(narrWithout);
  });
  it("段・語り・補助のボタンの CSS に手を入れていない（足したのは一文の余白だけ）", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.aux \{\s*font-size: var\(--font-aux\);\s*min-height: var\(--tap-min\);\s*gap: 0\.5rem;\s*align-self: flex-start;\s*\}/);
    expect(css).toMatch(/\.retake-failed \{\s*margin: 0;\s*min-height: var\(--tap-min\);\s*\}/);
  });
});
