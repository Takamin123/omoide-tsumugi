// 家族の画面のタブ（今日・アルバム）。部品は react-dom/server で文字列にして確かめる（DOM なし）。
// 帯と語りの連動は、DOM に頼らない決まり（src/client/lib/album.ts）を確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { Home } = await load("../../src/client/screens/Home");
const { Album } = await load("../../src/client/parts/Album");
const { TabBar } = await load("../../src/client/parts/TabBar");
const { Narrations } = await load("../../src/client/parts/Narrations");
const { words } = await load("../../src/client/words");
const album = await load("../../src/client/lib/album");
const { ComposingSet } = await load("../../src/client/lib/composing");

const grandma = { id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder", speechStyle: "dialect", dialectRegion: "広島", setUpByMemberId: null };
const mother = { id: "m-mother", calledAs: "お母さん", relation: "母", role: "family", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null };
const view = {
  family: { id: "f-1", isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: false },
  members: [grandma, mother],
};
const nameOf = (id: string) => view.members.find((m) => m.id === id)?.calledAs ?? "";

const photo = (id: string, takenAt: string | null) => ({ id, ownerMemberId: "m-mother", width: 1600, height: 1200, takenAt, hasLocation: false, imageUrl: `/api/photos/${id}/image` });
const narration = (id: string, photoId: string, over: Record<string, unknown> = {}) => ({
  id,
  speakerMemberId: "m-grandma",
  photoId,
  entranceId: null,
  replyToId: null,
  kind: "text",
  audioUrl: null,
  durationMs: null,
  transcriptStatus: "done",
  text: `語り ${id}`,
  forDate: "2026-11-02",
  createdAt: 1,
  ...over,
});
const items = [
  { photo: photo("p-1", "1994-10-09T10:00:00"), narrations: [narration("n-1", "p-1"), narration("n-2", "p-1", { speakerMemberId: "m-mother", replyToId: "n-1", text: "返事の文" })] },
  { photo: photo("p-2", null), narrations: [narration("n-3", "p-2")] },
  { photo: photo("p-3", "1979-04-01T09:00:00"), narrations: [narration("n-4", "p-3")] },
  { photo: photo("p-4", "1987-08-01T09:00:00"), narrations: [narration("n-5", "p-4")] },
];

const renderAlbum = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    h(Album, { items, me: mother, nameOf, currentId: null, onCurrent: () => {}, onSent: () => {}, composing: false, ...over }),
  ) as string;

describe("家族の画面のタブ", () => {
  it("開いたときは「今日」。今のタブは aria-current で示し、上にメニューがある", () => {
    const html = renderToStaticMarkup(h(Home, { view, me: mother, onSwitchUser: () => {}, demo: null })) as string;
    expect(html).toContain(`<button type="button" class="tab" aria-current="page">${words.home.tabToday}</button>`);
    expect(html).toContain(`<button type="button" class="tab">${words.home.tabAlbum}</button>`);
    expect(html).toContain(words.home.menuPhotos);
    expect(html).toContain(words.home.menuFamily);
    expect(html).toContain(words.home.switchUser);
    expect(html).toContain(`<nav class="top" aria-label="${words.home.menuLabel}">`);
    expect(html).toContain(`<nav class="tabs" aria-label="${words.home.tabsLabel}">`);
  });
  it("最後に見たタブを端末に覚えない（家族の画面とタブの部品に localStorage がない）", () => {
    for (const f of ["src/client/screens/Home.tsx", "src/client/parts/TabBar.tsx", "src/client/parts/Album.tsx"]) {
      expect(fs.readFileSync(path.join(repoRoot, f), "utf8")).not.toMatch(/localStorage|sessionStorage/);
    }
  });
  it("言葉: 「今日」「アルバム」", () => {
    expect(words.home.tabToday).toBe("今日");
    expect(words.home.tabAlbum).toBe("アルバム");
  });
  it("アルバムのタブを選ぶと、そちらに aria-current が移る", () => {
    const html = renderToStaticMarkup(h(TabBar, { tab: "album", onChange: () => {}, composing: false })) as string;
    expect(html).toContain(`<button type="button" class="tab">${words.home.tabToday}</button>`);
    expect(html).toContain(`<button type="button" class="tab" aria-current="page">${words.home.tabAlbum}</button>`);
  });
  it("文字や声で答えている間は、タブを描かない（押せない）", () => {
    expect(renderToStaticMarkup(h(TabBar, { tab: "today", onChange: () => {}, composing: true }))).toBe("");
  });
  it("今のタブは色だけでなく、太さと上の線でも示す。文字は補助のボタンの大きさ、高さは 64px 以上", () => {
    const css = fs.readFileSync(path.join(repoRoot, "src/client/styles.css"), "utf8") as string;
    expect(css).toMatch(/\.tabs \.tab\[aria-current="page"\] \{[^}]*font-weight: bold;[^}]*box-shadow: inset 0 4px 0 var\(--accent\);/);
    expect(css).toMatch(/--tab-height: max\(64px, [\d.]+rem\);/);
    expect(css).toMatch(/\.tabs \.tab \{[^}]*min-height: var\(--tab-height\);[^}]*font-size: var\(--font-aux\);/);
  });
});

describe("入力中を数える", () => {
  it("どれか一つでも開いていれば入力中。全部閉じたら外れる。変わったときだけ知らせる", () => {
    const seen: boolean[] = [];
    const set = new ComposingSet((on: boolean) => seen.push(on));
    set.set("a", true);
    set.set("b", true);
    set.set("a", false);
    expect(set.composing).toBe(true);
    set.set("b", false);
    set.set("b", false);
    expect(set.composing).toBe(false);
    expect(seen).toEqual([true, false]);
  });
});

describe("アルバム", () => {
  it("語りのある写真がなければ何も出さない（催促や状態の文を出さない）", () => {
    expect(renderAlbum({ items: [] })).toBe("");
  });
  it("空でも、デモの帯は出す", () => {
    expect(renderAlbum({ items: [], footer: h("div", { className: "foot" }, "デモ") })).toBe('<div class="album-text album-empty"><div class="foot">デモ</div></div>');
  });
  it("何枚目かを「4枚のうち 1枚」で出す。一枚目では左の矢印が押せない", () => {
    const html = renderAlbum();
    expect(words.home.albumPosition(1, 4)).toBe("4枚のうち 1枚");
    expect(words.home.albumPositionParts(1, 4)).toEqual(["4枚のうち", "1枚"]);
    expect(html).toContain('<p class="album-count" aria-live="polite"><span>4枚のうち</span><span> 1枚</span></p>');
    expect(html).toMatch(new RegExp(`<button type="button" class="album-arrow" aria-label="${words.home.albumPrev}" disabled="">`));
    expect(html).toMatch(new RegExp(`<button type="button" class="album-arrow" aria-label="${words.home.albumNext}">`));
  });
  it("最後の写真では右の矢印が押せない", () => {
    const html = renderAlbum({ currentId: "p-4" });
    expect(html).toContain("<span>4枚のうち</span><span> 4枚</span>");
    expect(html).toMatch(new RegExp(`aria-label="${words.home.albumPrev}">`));
    expect(html).toMatch(new RegExp(`aria-label="${words.home.albumNext}" disabled="">`));
  });
  it("一枚だけなら、どちらの矢印も押せない", () => {
    const html = renderAlbum({ items: items.slice(0, 1) });
    expect(html).toContain("<span>1枚のうち</span><span> 1枚</span>");
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });
  it("矢印は見た目が矢印だけ。読み上げの名前は「左の写真へ」「右の写真へ」", () => {
    expect(words.home.albumPrev).toBe("左の写真へ");
    expect(words.home.albumNext).toBe("右の写真へ");
    const html = renderAlbum({ currentId: "p-2" });
    expect(html).toMatch(/aria-label="左の写真へ"><svg aria-hidden="true"[^>]*><path[^>]*><\/path><\/svg><\/button>/);
  });
  it("写真ごとに撮影日と細い線を頭に置き、語りは全文・話者の呼ばれ方つき、返事は元の語りの下", () => {
    const html = renderAlbum();
    expect(html).toContain('<p class="album-date"><span>1994年10月9日</span><span class="album-rule" aria-hidden="true"></span></p>');
    expect(html).toContain("語り n-1");
    expect(html).toMatch(/<div class="narration" data-narration="n-1"><p class="speaker">ばあば<\/p><p class="told">語り n-1<\/p>.*<div class="narration reply" data-narration="n-2"><p class="speaker">お母さん<\/p><p class="told">返事の文<\/p>/);
    // 撮影日がない写真は、線だけ
    expect(html).toContain('<section data-photo="p-2" class="album-section" aria-label="4枚のうち 2枚"><p class="album-date"><span class="album-rule" aria-hidden="true"></span></p>');
    expect(html).not.toContain("撮影日なし");
  });
  it("語りごとに「返事」ボタン。開いた入力欄は一度に一つ", () => {
    const html = renderAlbum();
    expect(html.match(new RegExp(`>${words.home.reply}</button>`, "g"))?.length).toBe(5);
    expect(html).not.toContain("reply-box");
  });
  it("出すのは家族の語り・返事・撮影日だけ（問いかけ、推測、見出しの言葉を出さない）", () => {
    const html = renderAlbum();
    const visible = html.replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean);
    const allowed = new Set([
      ...items.flatMap((it) => it.narrations.map((n) => n.text)),
      "ばあば",
      "お母さん",
      "1994年10月9日",
      "1979年4月1日",
      "1987年8月1日",
      words.home.reply,
      ...words.home.albumPositionParts(1, 4),
    ]);
    expect(visible.filter((t) => !allowed.has(t))).toEqual([]);
  });
  it("文字起こしが済んでいない声は、再生のボタンだけ（案内の文は出さない）", () => {
    const pending = [
      { photo: photo("p-9", null), narrations: [narration("n-9", "p-9", { kind: "voice", audioUrl: "/api/narrations/n-9/audio", durationMs: 13_000, transcriptStatus: "pending", text: null })] },
    ];
    const html = renderAlbum({ items: pending });
    expect(html).toContain("声で聞く（13秒）");
    expect(html).not.toContain('class="told"');
  });
  it("返事の入力欄が開いている間は、写真の帯をたたむ", () => {
    expect(renderAlbum({ composing: true })).toMatch(/<section class="album-band" aria-label="写真" hidden="">/);
    expect(renderAlbum({ composing: false })).toMatch(/<section class="album-band" aria-label="写真">/);
  });
  it("デモの帯は、語りの欄の一番下の余白に置く", () => {
    const html = renderAlbum({ footer: h("div", { className: "foot" }, "デモ") });
    expect(html).toMatch(/<div class="album-tail"[^>]*><div class="foot">デモ<\/div><\/div><\/div><\/div>$/);
  });
});

describe("今日のタブの語り（アルバムと同じ部品）", () => {
  it("開いている語りにだけ返事の入力欄を出す", () => {
    const html = renderToStaticMarkup(
      h(Narrations, { narrations: items[0]!.narrations, me: mother, nameOf, openReplyId: "n-2", onOpenReply: () => {}, onSent: () => {} }),
    ) as string;
    expect(html.match(/reply-box/g)?.length).toBe(1);
    // 開いている語り（n-2）には「返事」のボタンを出さず、ほか（n-1）には出す
    expect(html.match(new RegExp(`>${words.home.reply}</button>`, "g"))?.length).toBe(1);
  });
});

describe("帯と語りの連動の決まり", () => {
  it("帯の横の位置から何枚目か（丸めて、端に収める）", () => {
    expect(album.bandIndex(0, 390, 4)).toBe(0);
    expect(album.bandIndex(194, 390, 4)).toBe(0);
    expect(album.bandIndex(196, 390, 4)).toBe(1);
    expect(album.bandIndex(390 * 9, 390, 4)).toBe(3);
    expect(album.bandIndex(100, 0, 4)).toBe(0);
  });
  it("語りの欄で上に来た写真: 節の頭が上から threshold 以内に来た最後の節", () => {
    const offsets = [0, 500, 900, 1400];
    expect(album.sectionAtTop(offsets, 0, 96)).toBe(0);
    expect(album.sectionAtTop(offsets, 403, 96)).toBe(0);
    expect(album.sectionAtTop(offsets, 404, 96)).toBe(1);
    expect(album.sectionAtTop(offsets, 1400, 96)).toBe(3);
  });
  it("矢印は端で押せない", () => {
    expect(album.arrows(0, 4)).toEqual({ prev: false, next: true });
    expect(album.arrows(3, 4)).toEqual({ prev: true, next: false });
    expect(album.arrows(1, 4)).toEqual({ prev: true, next: true });
    expect(album.arrows(0, 0)).toEqual({ prev: false, next: false });
  });
  it("並びは開いたときのまま。増えた写真は末尾に足し、消えた写真は除く", () => {
    const id = (t: { id: string }) => t.id;
    const now = [{ id: "c" }, { id: "a" }, { id: "x" }, { id: "b" }];
    expect(album.keepOrder(["a", "b", "c", "gone"], now, id).map(id)).toEqual(["a", "b", "c", "x"]);
  });

  /** 手で進める時計 */
  function fakeTimers() {
    let now = 0;
    const queue: { at: number; fn: () => void; id: number }[] = [];
    let seq = 0;
    return {
      timers: {
        set: (fn: () => void, ms: number) => {
          const id = ++seq;
          queue.push({ at: now + ms, fn, id });
          return id;
        },
        clear: (h: unknown) => {
          const i = queue.findIndex((q) => q.id === h);
          if (i >= 0) queue.splice(i, 1);
        },
      },
      advance(ms: number) {
        now += ms;
        for (;;) {
          queue.sort((a, b) => a.at - b.at);
          const next = queue[0];
          if (!next || next.at > now) break;
          queue.shift();
          next.fn();
        }
      },
    };
  }

  it("縦→横: 語りを動かしている間、こちらから動かした帯のスクロールは連動の元にしない（往復しない）", () => {
    const t = fakeTimers();
    const gate = new album.SyncGate(t.timers, 150, 400);
    expect(gate.scrolled("text")).toBe(true);
    gate.moving("band");
    expect(gate.scrolled("band")).toBe(false);
    t.advance(100);
    expect(gate.scrolled("band")).toBe(false);
    expect(gate.scrolled("text")).toBe(true);
    // 両方止まれば、また帯から連動できる
    t.advance(400);
    expect(gate.scrolled("band")).toBe(true);
  });
  it("横→縦: 帯をめくっている間は、語りの欄のスクロールを連動の元にしない", () => {
    const t = fakeTimers();
    const gate = new album.SyncGate(t.timers, 150, 400);
    expect(gate.scrolled("band")).toBe(true);
    gate.moving("text");
    expect(gate.scrolled("text")).toBe(false);
    t.advance(500);
    expect(gate.scrolled("text")).toBe(true);
  });
  it("帯に触れている間は、指が止まっていても縦からの連動を止める", () => {
    const t = fakeTimers();
    const gate = new album.SyncGate(t.timers, 150, 400);
    gate.touched("band");
    t.advance(2000);
    expect(gate.scrolled("text")).toBe(false);
    gate.released();
    t.advance(149);
    expect(gate.scrolled("text")).toBe(false);
    t.advance(1);
    expect(gate.scrolled("text")).toBe(true);
  });
  it("矢印: 両方をこちらから動かす。その間はどちらのスクロールも連動の元にしない", () => {
    const t = fakeTimers();
    const gate = new album.SyncGate(t.timers, 150, 400);
    gate.moving("band");
    gate.moving("text");
    expect(gate.scrolled("band")).toBe(false);
    expect(gate.scrolled("text")).toBe(false);
    // 動いている間（スクロールが来続ける間）は止まるまで待つ
    t.advance(100);
    expect(gate.scrolled("band")).toBe(false);
    t.advance(200);
    expect(gate.isAuto("band")).toBe(false);
    expect(gate.isAuto("text")).toBe(false);
  });
  it("こちらから動かしている語りの欄に利用者が触れたら、利用者に渡す", () => {
    const t = fakeTimers();
    const gate = new album.SyncGate(t.timers, 150, 400);
    gate.moving("text");
    gate.touched("text");
    expect(gate.scrolled("text")).toBe(true);
    expect(gate.scrolled("band")).toBe(false);
  });
});

describe("言葉の糸（アルバムの答えの語りの「元の言葉」。0035）", () => {
  const answer = (over: Record<string, unknown>) =>
    narration("n-ans", "p-1", { speakerMemberId: "m-mother", entranceId: "e-1", quotedFrom: { narrationId: "n-1", speakerMemberId: "m-grandma", text: "浮き輪を膨らましてくれてね" }, ...over });
  const withAnswer = (a: Record<string, unknown>) => [{ ...items[0]!, narrations: [items[0]!.narrations[0]!, a] }, ...items.slice(1)];

  it("文: 「{呼ばれ方}の『{引用そのまま}』から」。長すぎて text が null なら「{呼ばれ方}の言葉から」", () => {
    expect(words.home.thread("ばあば", "浮き輪を膨らましてくれてね")).toBe("ばあばの『浮き輪を膨らましてくれてね』から");
    expect(words.home.thread("ばあば", null)).toBe("ばあばの言葉から");
  });
  it("アルバムでは、答えの語りの本文の下・ボタンの行の上に、行全体が一つのボタンで出す", () => {
    const html = renderAlbum({ items: withAnswer(answer({})) });
    expect(html).toMatch(
      /<div class="narration" data-narration="n-ans"><p class="speaker">お母さん<\/p><p class="told">語り n-ans<\/p><button type="button" class="thread"><svg aria-hidden="true"[^>]*>.*?<\/svg><span>ばあばの『浮き輪を膨らましてくれてね』から<\/span><\/button><div class="row">/,
    );
    // 糸は一つだけ（元の語りや、答えでない語りには出さない）
    expect(html.match(/class="thread"/g)?.length).toBe(1);
  });
  it("本文がない（文字起こしが済んでいない）声の答えでも、話者名 → 糸 → ボタンの順", () => {
    const html = renderAlbum({ items: withAnswer(answer({ kind: "voice", audioUrl: "/api/narrations/n-ans/audio", transcriptStatus: "pending", text: null })) });
    expect(html).toMatch(/<p class="speaker">お母さん<\/p><button type="button" class="thread">.*?<\/button><div class="row"><button[^>]*class="aux listen"/);
  });
  it("長すぎる引用は切らずに、呼ばれ方だけ", () => {
    const html = renderAlbum({ items: withAnswer(answer({ quotedFrom: { narrationId: "n-1", speakerMemberId: "m-grandma", text: null } })) });
    expect(html).toContain("<span>ばあばの言葉から</span>");
    expect(html).not.toContain("…");
  });
  it("今日のタブ（onJump を渡さない）には出さない", () => {
    const html = renderToStaticMarkup(
      h(Narrations, { narrations: [answer({})], me: mother, nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} }),
    ) as string;
    expect(html).not.toContain("thread");
    expect(html).not.toContain("から");
    expect(fs.readFileSync(path.join(repoRoot, "src/client/screens/Home.tsx"), "utf8")).not.toContain("onJump");
  });
  it("押すと元の語りへ ID で移り、そこにフォーカスを置く。こちらから動かす欄は連動の門に知らせる", () => {
    const src = fs.readFileSync(path.join(repoRoot, "src/client/parts/Album.tsx"), "utf8") as string;
    const jump = src.slice(src.indexOf("const jumpTo"), src.indexOf("// 開いたとき"));
    expect(jump).toContain('[data-narration="${CSS.escape(narrationId)}"]');
    expect(jump).toContain('gate.moving("text")');
    expect(jump).toContain("target.focus({ preventScroll: true })");
    expect(src).toContain("onJump={jumpTo}");
  });
  it("押せる大きさと文字: 高さは押せる場所の最低、文字は補助の文字、横いっぱい。押せることは下線でも示す", () => {
    const css = fs.readFileSync(path.join(repoRoot, "src/client/styles.css"), "utf8") as string;
    expect(css).toMatch(/\.thread \{[^}]*width: 100%;[^}]*min-height: var\(--tap-min\);[^}]*font-size: var\(--font-sub\);/);
    expect(css).toMatch(/\.thread span \{[^}]*text-decoration: underline;/);
  });
});
