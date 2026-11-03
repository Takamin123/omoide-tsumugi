// 写真に付いている記録（撮影日・場所）を、入り口とアルバムの見出しに出す（0047）。
// 部品は react-dom/server で文字列にして確かめる（DOM なし）。場所は架空の写真のための市の名前。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { EntranceView } = await load("../../src/client/parts/EntranceView");
const { Album } = await load("../../src/client/parts/Album");
const { ScreenContext } = await load("../../src/client/lib/screen");
const { words } = await load("../../src/client/words");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;

const members = [
  { id: "m-grandma", calledAs: "ばあば", relation: "祖母", role: "elder" },
  { id: "m-mother", calledAs: "おかあさん", relation: "母", role: "family" },
];
const photo = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  ownerMemberId: "m-grandma",
  width: 1600,
  height: 1200,
  takenAt: "2019-05-03T10:00:00",
  hasLocation: true,
  place: "三重県伊勢市",
  imageUrl: "/api/photos/p-1/image",
  ...over,
});
const entrance = (p: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ id: "e-1", photo: p, quote: null, question: null, focus: null, ...over });
const inScreen = (variant: "elder" | "family", el: any) => renderToStaticMarkup(h(ScreenContext.Provider, { value: variant }, el)) as string;
const renderEntrance = (p: Record<string, unknown>, variant: "elder" | "family", over: Record<string, unknown> = {}) =>
  inScreen(variant, h(EntranceView, { entrance: entrance(p, over), members, variant }));

describe("言葉", () => {
  it("場所は「〇〇あたり」。撮影日は見出しと同じ「2019年5月3日」", () => {
    expect(words.placeLabel("三重県伊勢市")).toBe("三重県伊勢市あたり");
    expect(words.dateLabel(2019, 5, 3)).toBe("2019年5月3日");
  });
});

describe("入り口: 写真のすぐ下・引用の上に、撮影日、場所の順（両画面で同じ文字列）", () => {
  it.each(["elder", "family"] as const)("%s", (variant) => {
    const html = renderEntrance(photo(), variant, { quote: { narrationId: "n-1", speakerMemberId: "m-mother", text: "架空の思い出", audioUrl: null, durationMs: null } });
    expect(html).toContain('<p class="photo-facts"><span>2019年5月3日</span><span>三重県伊勢市あたり</span></p>');
    // 写真 → 記録 → 引用 の順
    const at = (s: string) => html.indexOf(s);
    expect(at('class="photo-button"')).toBeLessThan(at('class="photo-facts"'));
    expect(at('class="photo-facts"')).toBeLessThan(at('class="told"'));
  });
  it("引用がなくても記録があれば出す。前置き・印は付けない", () => {
    const html = renderEntrance(photo(), "family");
    expect(html).toContain('<figcaption><p class="photo-facts"><span>2019年5月3日</span><span>三重県伊勢市あたり</span></p></figcaption>');
    expect(html).not.toMatch(/撮影日|場所：|場所:/);
  });
  it("片方だけならそれだけ。両方なければ行を出さない（「なし」は出さない）", () => {
    expect(renderEntrance(photo({ place: null }), "family")).toContain('<p class="photo-facts"><span>2019年5月3日</span></p>');
    expect(renderEntrance(photo({ takenAt: null }), "elder")).toContain('<p class="photo-facts"><span>三重県伊勢市あたり</span></p>');
    const none = renderEntrance(photo({ takenAt: null, place: null, hasLocation: false }), "family");
    expect(none).not.toContain("photo-facts");
    expect(none).not.toContain("<figcaption");
    expect(none).not.toContain("なし");
  });
});

describe("アルバムの見出し: 撮影日、場所、何枚目かの順", () => {
  const album = (variant: "elder" | "family", p: Record<string, unknown>) =>
    inScreen(
      variant,
      h(Album, {
        items: [{ photo: p, narrations: [] }],
        nameOf: () => "",
        currentId: null,
        onCurrent: () => {},
        onSent: () => {},
        composing: false,
      }),
    );
  it.each(["elder", "family"] as const)("%s", (variant) => {
    const html = album(variant, photo());
    expect(html).toMatch(
      /<p class="album-head-text"><span>2019年5月3日<\/span><span class="album-place">三重県伊勢市あたり<\/span><span class="album-ordinal" aria-hidden="true">1枚目<\/span><\/p>/,
    );
  });
  it("場所がなければ出さない", () => {
    expect(album("family", photo({ place: null }))).not.toContain("album-place");
  });
  it("欄の幅が 20rem 未満（スマホの文字 130%・150%）では場所を出さない。「n枚目」の 16.5rem はそのまま", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/@container album-text \(width < 20rem\) \{\s*\.album-place \{\s*display: none;\s*\}\s*\}/);
    expect(css).toMatch(/@container album-text \(width < 16\.5rem\) \{\s*\.album-ordinal \{\s*display: none;\s*\}\s*\}/);
  });
});

describe("地名の出典（CC BY 4.0）", () => {
  it("家族のことの画面の一番下にだけ出す（祖父母の画面にはメニューも出典も出さない）", () => {
    expect(words.family.placeSource).toContain("CC BY 4.0");
    expect(words.family.placeSource).toContain("アドレス・ベース・レジストリ");
    expect(read("src/client/screens/FamilySetup.tsx")).toContain("{w.placeSource}");
    for (const f of ["src/client/screens/Home.tsx", "src/client/screens/Elder.tsx"]) expect(read(f)).not.toContain("placeSource");
  });
});
