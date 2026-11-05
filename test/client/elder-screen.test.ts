// 祖父母の画面を家族の画面と同じ形にする（0043）。部品は react-dom/server で文字列にして確かめる（DOM なし）。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { Elder } = await load("../../src/client/screens/Elder");
const { Home } = await load("../../src/client/screens/Home");
const { ReplyBox } = await load("../../src/client/parts/ReplyBox");
const { Narrations } = await load("../../src/client/parts/Narrations");
const { Album } = await load("../../src/client/parts/Album");
const { ScreenContext, SentNoticeContext } = await load("../../src/client/lib/screen");
const { words } = await load("../../src/client/words");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;

const grandma = { id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder", speechStyle: "dialect", dialectRegion: "山形", setUpByMemberId: null };
const mother = { id: "m-mother", calledAs: "お母さん", relation: "母", role: "family", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null };
const view = {
  family: { id: "f-1", isDemo: true, clock: { date: "2026-11-03", slot: "morning" }, canAdvanceClock: false },
  members: [grandma, mother],
};
const nameOf = (id: string) => view.members.find((m) => m.id === id)?.calledAs ?? "";
const target = { photoId: "p-1", entranceId: "e-1", replyToId: null };
const inElder = (el: any, notice: any = null) =>
  renderToStaticMarkup(h(ScreenContext.Provider, { value: "elder" }, h(SentNoticeContext.Provider, { value: notice }, el))) as string;
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

describe("祖父母の画面の形（家族の画面と同じ）", () => {
  it("Elder は Home を祖父母の variant で描くだけ（部品を二重に持たない）", () => {
    const src = read("src/client/screens/Elder.tsx");
    expect(src).toContain('<Home {...props} variant="elder" />');
    expect(src).not.toMatch(/useSender|useRecorder|EntranceView|ReplyBox/);
  });
  it("下のタブ「今日」「アルバム」があり、開いたときは「今日」。上にメニューは置かず、呼ばれ方だけ", () => {
    const html = renderToStaticMarkup(h(Elder, { view: { ...view, me: grandma }, me: grandma, demo: null })) as string;
    expect(html).toContain('class="home-shell elder"');
    expect(html).toContain(`<button type="button" class="tab" aria-current="page">${words.home.tabToday}</button>`);
    expect(html).toContain(`>${words.home.tabAlbum}</button>`);
    expect(html).toContain(`<p class="elder-name">${grandma.calledAs}</p>`);
    expect(html).not.toContain(words.home.menuFamily);
    expect(html).not.toContain(words.home.menuPhotos);
  });
  it("家族の画面は今までどおり（メニューがあり、elder の印を付けない）", () => {
    const html = renderToStaticMarkup(h(Home, { view: { ...view, me: mother }, me: mother, demo: null })) as string;
    expect(html).toContain('class="home-shell"');
    expect(html).toContain(words.home.menuFamily);
    expect(html).not.toContain("elder-name");
  });
});

describe("祖父母の答え方: 「話す」「書く」", () => {
  it("一語のボタン二つ。同じ重さ（どちらも青にしない）。今の話者の呼ばれ方をすぐ上に出す", () => {
    expect(words.screen.elder.byVoice).toBe("話す");
    expect(words.screen.elder.byText).toBe("書く");
    const html = inElder(h(ReplyBox, { target, who: "ばあば" }));
    expect(html).toContain('<p class="who answer-who">ばあば</p>');
    expect(html).toMatch(/<div class="grid2 answer-choice"><button type="button" aria-pressed="false">.*?話す<\/button><button type="button">.*?書く<\/button><\/div>/);
    expect(html).not.toContain('class="primary"');
  });
  it("返事の欄には呼ばれ方を出さない（語りの話者名に見えるため）。「やめる」がある", () => {
    const html = inElder(h(ReplyBox, { target: { ...target, entranceId: null, replyToId: "n-1" }, onSent: () => {}, onCancel: () => {} }));
    expect(html).not.toContain("answer-who");
    expect(html).toContain(`>${words.elder.cancel}</button>`);
  });
  it("家族の画面の言葉はそのまま（声で話す・文字で書く）", () => {
    const html = renderToStaticMarkup(h(ReplyBox, { target })) as string;
    expect(html).toContain(words.home.byVoice);
    expect(html).toContain(words.home.byText);
    expect(html).not.toMatch(new RegExp(`>${words.screen.elder.byText}</button>`));
  });
  it("祖父母の「話す」は押すとその場で録り始める（選ぶボタンと録るボタンを兼ねる。0008 の二度押しのまま）", () => {
    const src = read("src/client/parts/ReplyBox.tsx");
    expect(src).toMatch(/clearNotices\(\);\s*rec\.toggle\(\);/);
  });
  it("家族の「声で話す」も押すとその場で録り始める（選んだ後にもう一度「話す」を押させない。人間、2026-11-04）", () => {
    const src = read("src/client/parts/ReplyBox.tsx");
    expect(src).toMatch(/setMode\("voice"\);[\s\S]{0,120}if \(!failed\) rec\.toggle\(\);/);
    expect(src).not.toMatch(/onClick=\{\(\) => setMode\("voice"\)\}/);
  });
  it("送れなかった文は祖父母の文。家族は種類ごとの文", () => {
    expect(words.screen.elder.sendFailed).toBe(words.elder.errors.sendFailed);
    expect(words.screen.family.sendFailed).toBeNull();
    expect(words.screen.elder.send).toBe("送る");
    expect(words.screen.elder.sent).toBe("送りました");
  });
});

describe("祖父母の画面の語りの欄", () => {
  it("声の語りは、話者名の行が入り口と同じ注「{呼ばれ方}の声（13秒）」、その下に [聞く][返事] を一つの行に（0045）", () => {
    const html = inElder(h(Narrations, { narrations: [voice()], nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} }));
    expect(words.elder.listen).toBe("聞く");
    expect(html).toContain('<p class="speaker">ばあばの声（13秒）</p>');
    expect(html).toMatch(/<div class="row"><button[^>]*class="aux listen"[^>]*>.*?聞く<\/button><button type="button" class="aux">返事<\/button><\/div>/);
    expect(html).not.toContain('class="who"');
    expect(html).not.toContain("こえ");
  });
  it("文字起こしが pending / failed の声も、両画面で話者名の行の注と [聞く][返事]（本文と案内の文なし。0045）", () => {
    for (const transcriptStatus of ["pending", "failed"]) {
      const props = { narrations: [voice({ transcriptStatus, text: null })], nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} };
      for (const [html, listen, reply] of [
        [inElder(h(Narrations, props)), "聞く", "返事"],
        [renderToStaticMarkup(h(Narrations, props)) as string, "聞く", "返事"],
      ]) {
        expect(html).toContain('<p class="speaker">ばあばの声（13秒）</p>');
        expect(html).toMatch(new RegExp(`<div class="row"><button[^>]*class="aux listen"[^>]*>.*?${listen}</button><button type="button" class="aux">${reply}</button></div>`));
        expect(html).not.toContain('class="told"');
        expect(html).not.toContain('class="who"');
      }
    }
  });
  it("文字の語りの話者名は呼ばれ方だけ（注は声の語りだけ）", () => {
    const text = voice({ kind: "text", audioUrl: null, durationMs: null, text: "こんにちは" });
    const props = { narrations: [text], nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} };
    for (const html of [inElder(h(Narrations, props)), renderToStaticMarkup(h(Narrations, props)) as string]) {
      expect(html).toContain('<p class="speaker">ばあば</p>');
      expect(html).not.toContain("の声");
      expect(html).not.toContain('class="aux listen"');
    }
  });
  it("流している間の語は「とめる」「止める」のまま。祖父母の語りの行のボタンだけ横の余白を 0.75rem に（0045）", () => {
    expect(words.screen.elder.stopVoice).toBe("止める");
    expect(words.screen.family.stopVoice).toBe("止める");
    expect(words.screen.family.listen).toBe("聞く");
    expect(read("src/client/styles.css")).toMatch(/\.elder \.narration > \.paper > \.row > \.aux \{\s*padding-inline: 0\.75rem;\s*\}/);
  });
  it("「送りました」は場所が今の語りのときだけ（画面に一つだけ）", () => {
    const n = (at: string | null) =>
      inElder(h(Narrations, { narrations: [voice()], nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} }), {
        at,
        show: () => {},
        clear: () => {},
      });
    expect(n("n-1")).toContain(`<p class="done">${words.elder.sent}</p>`);
    expect(n("answer")).not.toContain(words.elder.sent);
    expect(n(null)).not.toContain(words.elder.sent);
  });
  it("家族の画面の語りの声も同じ組み立て: 話者名の行「ばあばの声（13秒）」と [聞く][返事]（0045）", () => {
    const html = renderToStaticMarkup(h(Narrations, { narrations: [voice()], nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {} })) as string;
    expect(html).toContain('<p class="speaker">ばあばの声（13秒）</p>');
    expect(html).toMatch(/<div class="row"><button[^>]*class="aux listen"[^>]*>.*?聞く<\/button><button type="button" class="aux">返事<\/button><\/div>/);
    expect(html).not.toContain("声で聞く");
  });
  it("アルバムの写真の拡大の閉じるは祖父母の言葉（ZoomablePhoto に画面を渡す）", () => {
    const html = inElder(
      h(Album, {
        items: [{ photo: { id: "p-1", ownerMemberId: "m-mother", width: 4, height: 3, takenAt: null, hasLocation: false, imageUrl: "/x" }, narrations: [voice()] }],
        nameOf,
        currentId: null,
        onCurrent: () => {},
        onSent: () => {},
        composing: false,
      }),
    );
    expect(html).toContain('class="album-band"');
    expect(html).toContain(`>${words.elder.reply}</button>`);
    expect(read("src/client/parts/Album.tsx")).toContain("variant={variant}");
  });
});

describe("祖父母の画面の決まり（ソース）", () => {
  const home = read("src/client/screens/Home.tsx");
  it("「送りました」は祖父母の画面では時間で消さず、場所を一つだけ持つ", () => {
    expect(home).toMatch(/if \(elder\) setNoticeAt\("answer"\);/);
    expect(home).toContain("<SentNoticeContext.Provider value={elder ? notice : null}>");
  });
  it("入り口が開けていて一覧だけ読めなかったときは、祖父母の今日のタブに出さない", () => {
    expect(home).toContain("const todayError = errorView(elder ? entranceError : (entranceError ?? feedError));");
    expect(home).toContain("const albumError = errorView(elder ? feedError : (entranceError ?? feedError));");
  });
  it("読み込めなかったときの祖父母の文と「もう一度」", () => {
    expect(home).toContain("words.elder.errors");
    expect(home).toContain("{words.elder.again}");
  });
  it("大きさは .home-shell.elder の下で祖父母の定数に替える（答えのボタン、家族の言葉、問いかけ）", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.elder \.answer \.primary,[\s\S]*?min-height: var\(--elder-action-height\);\s*font-size: var\(--font-elder-action\);/);
    expect(css).toMatch(/\n\.elder \{[^}]*--font-told: var\(--font-elder-told\);[^}]*--font-question: var\(--font-elder-question\);/);
  });
  it("家族の設定の画面の名前は声に限らない言い方", () => {
    expect(words.member.roleElder).toBe("文字の大きな画面（祖父母向け）");
  });
});
