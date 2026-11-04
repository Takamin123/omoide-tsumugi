// 写真の拡大の画面（0040）: 計算（lib/zoom.ts）と、部品の描き方・決まりごと。DOM なし。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const zoom = await load("../../src/client/lib/zoom");
const { PhotoViewer } = await load("../../src/client/parts/PhotoViewer");
const { ZoomablePhoto } = await load("../../src/client/parts/ZoomablePhoto");
const { words } = await load("../../src/client/words");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;
const photo = { id: "p-1", ownerMemberId: "m-1", width: 1600, height: 1200, takenAt: null, hasLocation: false, place: null, imageUrl: "/api/photos/p-1/image" };

describe("lib/zoom.ts", () => {
  it("containBox: 縦横比を保って枠に全体を入れ、真ん中に置く", () => {
    expect(zoom.containBox({ width: 1600, height: 1200 }, { left: 0, top: 0, width: 360, height: 500 })).toEqual({ left: 0, top: 115, width: 360, height: 270 });
    // 横にしたスマホ（横長の枠）では高さいっぱい
    expect(zoom.containBox({ width: 1600, height: 1200 }, { left: 0, top: 0, width: 800, height: 300 })).toEqual({ left: 200, top: 0, width: 400, height: 300 });
  });
  it("flipFrom: 大きい姿を押した写真の位置に重ねる（中心をそろえ、倍率は一つで歪めない）", () => {
    const to = { left: 0, top: 100, width: 360, height: 270 };
    const from = { left: 40, top: 300, width: 180, height: 135 };
    expect(zoom.flipFrom(from, to)).toEqual({ scale: 0.5, x: 130 - 180, y: 367.5 - 235 });
  });
  it("clampView: 倍率は 1〜4。広げていなければ真ん中、広げたら写真の端が枠の内側に入らない所まで", () => {
    const img = { width: 360, height: 270 };
    const frame = { width: 360, height: 500 };
    expect(zoom.clampView({ scale: 0.5, x: 30, y: 30 }, img, frame)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoom.clampView({ scale: 9, x: 0, y: 0 }, img, frame).scale).toBe(zoom.MAX_SCALE);
    // 2 倍: 横は (720-360)/2 = 180 まで、縦は (540-500)/2 = 20 まで
    expect(zoom.clampView({ scale: 2, x: 500, y: -500 }, img, frame)).toEqual({ scale: 2, x: 180, y: -20 });
  });
  it("zoomAt: 指の所を動かさずに広げる", () => {
    const v = zoom.zoomAt(zoom.IDENTITY, 2, { x: 50, y: -20 });
    // 写真の点 p=(50,-20) は、広げた後も 2p + t = (50,-20) に見える
    expect(2 * 50 + v.x).toBe(50);
    expect(2 * -20 + v.y).toBe(-20);
  });
  it("doubleTapView: 広げていなければ押した所を中心に広げ、広げていれば元に戻す", () => {
    const big = zoom.doubleTapView(zoom.IDENTITY, { x: 10, y: 10 });
    expect(big.scale).toBe(zoom.DOUBLE_TAP_SCALE);
    expect(zoom.doubleTapView(big, { x: 0, y: 0 })).toEqual(zoom.IDENTITY);
  });
});

describe("拡大の画面の描き方", () => {
  const render = (closeLabel: string, p: Record<string, unknown> = photo) =>
    renderToStaticMarkup(
      h(PhotoViewer, { photo: p, origin: () => null, closing: false, onRequestClose: () => {}, onClosed: () => {}, closeLabel, label: words.photoView.label }),
    ) as string;
  it("写真だけの画面。ボタンは「とじる」（祖父母）／「閉じる」（家族）の一つだけ", () => {
    expect(words.elder.close).toBe("とじる");
    expect(words.home.close).toBe("閉じる");
    const html = render(words.elder.close);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`aria-label="${words.photoView.label}"`);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*class="primary viewer-close"[^>]*>とじる<\/button>/);
  });
  it("写真の記録（撮影日、場所）を、入り口と同じ形で閉じるボタンの上に出す。写真の枠には重ねない（両画面。0040 の追記、0047）", () => {
    // デモの家族の山形の写真と同じ地名（架空の公開の代表点。0038）
    const withFacts = { ...photo, takenAt: "2026-06-25T11:30:00", hasLocation: true, place: "山形県大石田町" };
    for (const label of [words.elder.close, words.home.close]) {
      const html = render(label, withFacts);
      expect(html).toContain('<p class="photo-facts viewer-facts"><span>2026年6月25日</span><span>山形県大石田町あたり</span></p>');
      const at = (s: string) => html.indexOf(s);
      expect(at('class="viewer-stage"')).toBeLessThan(at('class="viewer-foot"'));
      expect(at('class="viewer-foot"')).toBeLessThan(at("photo-facts"));
      expect(at("photo-facts")).toBeLessThan(at("viewer-close"));
      // 押せるのは閉じるボタンだけのまま。前置き・印は付けない
      expect(html.match(/<button/g)).toHaveLength(1);
      expect(html).not.toMatch(/撮影日|場所：|場所:/);
    }
    expect(render(words.home.close, { ...photo, hasLocation: true, place: "三重県伊勢市" })).toContain(
      '<p class="photo-facts viewer-facts"><span>三重県伊勢市あたり</span></p>',
    );
  });
  it("記録がなければ行を出さない（「なし」は出さない）", () => {
    const html = render(words.home.close);
    expect(html).not.toContain("photo-facts");
    expect(html).not.toContain("なし");
  });
  it("同じ画像の URL を使い、寄せ（object-position）を付けずに全体を出す", () => {
    const html = render(words.home.close);
    expect(html).toContain(`src="${photo.imageUrl}"`);
    expect(html).not.toContain("object-position");
    expect(html).toContain('alt=""');
  });
  it("押せる写真は button で、読み上げの名前は「写真を大きく見る」。寄せは小さい写真にだけ付ける", () => {
    const html = renderToStaticMarkup(h(ZoomablePhoto, { photo, focus: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, variant: "elder" })) as string;
    expect(words.photoView.open).toBe("写真を大きく見る");
    expect(html).toContain(`<button type="button" class="photo-button" aria-label="${words.photoView.open}">`);
    expect(html).toContain("object-position");
    expect(html).not.toContain("viewer");
  });
});

describe("決まりごと（ソース）", () => {
  it("戻る操作でも閉じる: 開くときに履歴を一つ積み、popstate で閉じる。閉じるボタンは履歴を戻す", () => {
    const src = read("src/client/parts/ZoomablePhoto.tsx");
    expect(src).toContain("history.pushState");
    expect(src).toContain('addEventListener("popstate"');
    expect(src).toContain("history.back()");
  });
  it("動きは transform と opacity だけ。動きを減らす設定では動かさない", () => {
    const src = read("src/client/parts/PhotoViewer.tsx");
    expect(src).toContain("prefers-reduced-motion: reduce");
    const transitions = [...src.matchAll(/`(\w+) \$\{VIEWER_MOTION_MS\}ms/g)].map((m) => m[1]);
    expect(new Set(transitions)).toEqual(new Set(["transform", "opacity"]));
  });
  it("指の操作は写真の枠だけで受け、画面全体（ボタンや文字）は広げない", () => {
    expect(read("src/client/styles.css")).toMatch(/\.viewer-stage \{[^}]*touch-action: none;/);
  });
  it("祖父母の画面（入り口）でも、家族の画面（入り口、アルバムの帯）でも開く。帯は止まっているときだけ開く", () => {
    expect(read("src/client/parts/EntranceView.tsx")).toContain("<ZoomablePhoto photo={entrance.photo} focus={entrance.focus} variant={variant} />");
    const album = read("src/client/parts/Album.tsx");
    // 閉じるボタンの言葉は画面ごと（祖父母の画面は「とじる」。0043）
    expect(album).toMatch(/<ZoomablePhoto photo=\{it\.photo\} variant=\{variant\} canOpen=\{bandSettled\}/);
    expect(album).toContain("bandMovedAt.current = performance.now();");
  });
});
