// 「返事」のタブの画面の側（0058）。部品は react-dom/server で文字列にして確かめる（DOM なし）。家族はすべて架空
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import type { FeedItem, FeedNarration, Photo } from "../../src/shared/api";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { Home } = await load("../../src/client/screens/Home");
const { TabBar } = await load("../../src/client/parts/TabBar");
const { Replies } = await load("../../src/client/parts/Replies");
const { ScreenContext } = await load("../../src/client/lib/screen");
const { words } = await load("../../src/client/words");
const { badgeText, keepOrderNewFirst, latestIncomingAt, mergeSeenAt, replyGroups, unseenCount } = await load("../../src/client/lib/replies");

const photo = (id: string, owner: string, takenAt: string | null = null): Photo => ({
  id,
  ownerMemberId: owner,
  width: 1600,
  height: 1200,
  takenAt,
  hasLocation: false,
  place: null,
  imageUrl: `/api/photos/${id}/image`,
});
const n = (id: string, photoId: string, speaker: string, createdAt: number, extra: Partial<FeedNarration> = {}): FeedNarration => ({
  id,
  speakerMemberId: speaker,
  photoId,
  entranceId: null,
  replyToId: null,
  kind: "text",
  audioUrl: null,
  durationMs: null,
  transcriptStatus: "done",
  text: `語り ${id}`,
  forDate: "2026-11-05",
  createdAt,
  quotedFrom: null,
  ...extra,
});
const item = (p: Photo, narrations: FeedNarration[]): FeedItem => ({ photo: p, narrations, addedPhotos: [] });

// me = お母さん。P1 はゆいの写真（お母さんが語り、じいちゃんが返事）、P2 はお母さんの写真（じいちゃんが語り、ゆいが返事）、
// P3 はゆいの写真（ゆいだけ。届いたものはない）、P4 はお母さんの写真（お母さんだけ）
const feed: FeedItem[] = [
  item(photo("P3", "yui"), [n("y3", "P3", "yui", 50)]),
  item(photo("P1", "yui", "2019-05-03T14:02:19"), [
    n("other-root", "P1", "masato", 5), // ほかの人どうしの糸（届いたものを含まないので出さない）
    n("m1", "P1", "mom", 10),
    n("g1", "P1", "jii", 40, { replyToId: "m1", kind: "voice", audioUrl: "/api/narrations/g1/audio", durationMs: 13_000 }),
    n("m1b", "P1", "mom", 45, { replyToId: "g1" }), // このタブでお母さんが返した返事（糸の中に残る）
  ]),
  item(photo("P2", "mom"), [n("g2", "P2", "jii", 20), n("y2", "P2", "yui", 30, { replyToId: "g2" })]),
  item(photo("P4", "mom"), [n("m4", "P4", "mom", 60)]),
];

describe("返事のタブのまとまり", () => {
  it("届いたもののある写真だけを、届いた最新の新しい順に。糸はまるごと、ほかの糸と自分だけの写真は出さない", () => {
    const groups = replyGroups(feed, "mom");
    expect(groups.map((g: any) => g.item.photo.id)).toEqual(["P1", "P2"]);
    expect(groups[0]!.narrations.map((x: any) => x.id)).toEqual(["m1", "g1", "m1b"]);
    expect(groups[1]!.narrations.map((x: any) => x.id)).toEqual(["g2", "y2"]);
    expect(groups.map((g: any) => g.latestAt)).toEqual([40, 30]);
  });
  it("自分の言葉を引用した入り口への答えなら、引用元の自分の語りを上に出す（2026-11-05）", () => {
    const f = [
      item(photo("P8", "mom"), [
        n("m8", "P8", "mom", 10),
        n("other8", "P8", "yui", 15),
        n("j8", "P8", "jii", 20, { entranceId: "E1", quotedFrom: { narrationId: "m8", speakerMemberId: "mom", text: "架空の言葉" } }),
      ]),
    ];
    const g = replyGroups(f, "mom");
    expect(g[0]!.narrations.map((x: any) => x.id)).toEqual(["m8", "other8", "j8"]);
  });
  it("ほかの人の写真でも、自分の言葉を引用した入り口への答えなら、その写真と引用元の自分の語りを出す（(c) だけで入る）", () => {
    const f = [
      item(photo("P7", "yui"), [
        n("m7", "P7", "mom", 10),
        n("y7", "P7", "yui", 12),
        n("j7", "P7", "jii", 20, { entranceId: "E2", quotedFrom: { narrationId: "m7", speakerMemberId: "mom", text: "架空の言葉" } }),
      ]),
    ];
    const g = replyGroups(f, "mom");
    expect(g.map((x: any) => x.item.photo.id)).toEqual(["P7"]);
    expect(g[0]!.narrations.map((x: any) => x.id)).toEqual(["m7", "j7"]);
  });
  it("返した先が輪になっていても止まる", () => {
    const loop = [item(photo("P9", "mom"), [n("a", "P9", "jii", 1, { replyToId: "b" }), n("b", "P9", "yui", 2, { replyToId: "a" })])];
    expect(replyGroups(loop, "mom")[0]!.narrations.map((x: any) => x.id).sort()).toEqual(["a", "b"]);
  });
  it("まだ見ていない数: null はすべて、同じ時刻は見たことにする", () => {
    expect(unseenCount(feed, "mom", null)).toBe(3);
    expect(unseenCount(feed, "mom", 30)).toBe(1);
    expect(unseenCount(feed, "mom", 40)).toBe(0);
    expect(latestIncomingAt(feed, "mom")).toBe(40);
    expect(latestIncomingAt([], "mom")).toBeNull();
  });
  it("見た時刻はサーバーと手元の新しい方", () => {
    expect(mergeSeenAt(null, null)).toBeNull();
    expect(mergeSeenAt(5, null)).toBe(5);
    expect(mergeSeenAt(null, 7)).toBe(7);
    expect(mergeSeenAt(9, 7)).toBe(9);
  });
  it("開いている間の並び: 開いたときの並びを保ち、新しく増えた写真は上に足す。消えたものは除く", () => {
    expect(keepOrderNewFirst(["a", "b", "c"], ["d", "c", "a"], (x: string) => x)).toEqual(["d", "a", "c"]);
  });
  it("バッジの数字は 99 を超えたら 99+", () => {
    expect(badgeText(1)).toBe("1");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(120)).toBe("99+");
  });
});

describe("下のタブ", () => {
  const tabs = (over: Record<string, unknown>) => renderToStaticMarkup(h(TabBar, { tab: "today", onChange: () => {}, composing: false, ...over })) as string;
  it("3 つ目は「返事」。まだ見ていなければ数のバッジ（見た目だけ）と、読み上げの隠した文", () => {
    expect(words.home.tabReplies).toBe("返事");
    const html = tabs({ unseen: 2 });
    expect(html).toContain(
      `<button type="button" class="tab">${words.home.tabReplies}<span class="tab-badge" aria-hidden="true">2</span><span class="visually-hidden">${words.home.tabUnseen(2)}</span></button>`,
    );
    expect(words.home.tabUnseen(2)).toBe("、新しく 2件");
    // 99+ でも読み上げは実際の数
    expect(tabs({ unseen: 150 })).toContain(`>99+</span><span class="visually-hidden">${words.home.tabUnseen(150)}</span>`);
  });
  it("0 件・返事のタブにいる間はバッジを出さない。返事のタブを開くと aria-current が移る", () => {
    expect(tabs({ unseen: 0 })).not.toContain("tab-badge");
    const html = tabs({ tab: "replies", unseen: 3 });
    expect(html).not.toContain("tab-badge");
    expect(html).toContain(`<button type="button" class="tab" aria-current="page">${words.home.tabReplies}</button>`);
  });
  it("家族の画面も祖父母の画面も 3 つのタブ（開いたときは「今日」）", () => {
    const view = {
      family: { id: "f", isDemo: true, clock: { date: "2026-11-05", slot: "morning" }, canAdvanceClock: false },
      members: [],
    };
    const me = { id: "mom", calledAs: "お母さん", relation: "母", role: "family", speechStyle: "standard", dialectRegion: null, setUpByMemberId: null };
    for (const variant of ["family", "elder"]) {
      const html = renderToStaticMarkup(h(Home, { view, me, demo: null, variant })) as string;
      expect(html).toContain(`<button type="button" class="tab" aria-current="page">${words.home.tabToday}</button>`);
      expect(html).toContain(`<button type="button" class="tab">${words.home.tabAlbum}</button>`);
      expect(html).toContain(`<button type="button" class="tab">${words.home.tabReplies}</button>`);
    }
  });
  it("3 つのタブは等分を基本に、語の長さより狭くしない（360px・文字 150% で「アルバム」を折らない）。バッジは青地に白", () => {
    const css = fs.readFileSync(path.join(repoRoot, "src/client/styles.css"), "utf8") as string;
    expect(css).toMatch(/\.tabs \{[^}]*grid-template-columns: repeat\(3, minmax\(max-content, 1fr\)\);/);
    expect(css).toMatch(/\.tabs \.tab \{[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.tab-badge \{[^}]*background: var\(--accent\);[^}]*color: var\(--accent-text\);[^}]*font-size: var\(--font-sub\);/);
  });
});

describe("返事のタブの中身", () => {
  const nameOf = (id: string) => ({ mom: "お母さん", jii: "じいちゃん", yui: "ゆい", masato: "まさとおじさん" })[id] ?? "";
  const render = (variant: "family" | "elder", over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      h(
        ScreenContext.Provider,
        { value: variant },
        h(Replies, { groups: replyGroups(feed, "mom"), nameOf, openReplyId: null, onOpenReply: () => {}, onSent: () => {}, loading: false, ...over }),
      ),
    ) as string;
  it("写真ごとに、押すと大きく見られる写真と撮影日、糸の語り（声は聞く）と返事のボタン。言葉の糸・見出し・何枚目かは出さない", () => {
    const html = render("family");
    expect(html.match(/class="replies-group"/g)).toHaveLength(2);
    expect(html.indexOf('data-photo="P1"')).toBeLessThan(html.indexOf('data-photo="P2"'));
    expect(html).toContain(`aria-label="${words.photoView.open}"`);
    expect(html).toContain('<p class="photo-facts"><span>2019年5月3日</span></p>');
    expect(html).toContain("語り m1");
    expect(html).toContain("じいちゃんの声（13秒）");
    expect(html).toContain(words.home.listen);
    expect(html).toContain(words.home.reply);
    expect(html).not.toContain("語り other-root");
    expect(html).not.toContain('class="thread"');
    expect(html).not.toContain("枚目");
  });
  it("祖父母の画面は祖父母のボタンの言葉", () => {
    const html = render("elder");
    expect(html).toContain(words.elder.reply);
    expect(html).toContain(words.elder.listen);
  });
  it("届いたものがないときは一行（画面ごとの文）。読み込み中は出さない", () => {
    expect(render("family", { groups: [] })).toContain(words.screen.family.noReplies);
    expect(render("elder", { groups: [] })).toContain(words.screen.elder.noReplies);
    expect(render("family", { groups: [], loading: true })).not.toContain(words.screen.family.noReplies);
    expect(words.screen.family.noReplies).toBe("まだ返事はありません。あなたの語りや写真に家族が話すと、ここに届きます");
    expect(words.screen.elder.noReplies).toBe("まだ返事は届いていません。あなたの話に家族が答えると、ここに出ます");
  });
});
