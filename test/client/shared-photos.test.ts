// 自分が共有した写真の数と一覧（写真を家族に共有する画面）、家族のことのカードの数（0053）。DOM なし。
// 部品は react-dom/server で文字列にして確かめ、読み直しの配線はソースの形で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { AddPhotos, SharedPhotos, newestFirst } = await load("../../src/client/screens/AddPhotos");
const { FamilySetup } = await load("../../src/client/screens/FamilySetup");
const { words } = await load("../../src/client/words");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;
const photo = (id: string) => ({ id, ownerMemberId: "m-mother", width: 1600, height: 1200, takenAt: null, hasLocation: false, place: null, imageUrl: `/api/photos/${id}/image` });

describe("言葉", () => {
  it("「共有した写真 n枚」。上のメニューと同じ語で、！なし", () => {
    expect(words.photos.shared(12)).toBe("共有した写真 12枚");
    expect(words.home.menuPhotos).toContain("共有");
    expect(words.photos.shared(1)).not.toMatch(/[！!]/);
  });
});

describe("写真を家族に共有する画面: 共有した写真", () => {
  it("見出しに数を一行、その下に小さい写真を並べる。押すと拡大の画面（0040）、読み込みは lazy", () => {
    const html = renderToStaticMarkup(h(SharedPhotos, { photos: [photo("p-3"), photo("p-2"), photo("p-1")] })) as string;
    expect(html).toContain(`<h2>${words.photos.shared(3)}</h2>`);
    expect(html.match(/class="shared-photo"/g)).toHaveLength(3);
    expect(html.match(new RegExp(`aria-label="${words.photoView.open}"`, "g"))).toHaveLength(3);
    expect(html.match(/<img [^>]*loading="lazy"/g)).toHaveLength(3);
    // 渡した順（新しい順）のまま並べる
    expect([...html.matchAll(/\/api\/photos\/(p-\d)\/image/g)].map((m) => m[1])).toEqual(["p-3", "p-2", "p-1"]);
  });
  it("0 枚なら見出しも一覧も出さない（文を足さない）", () => {
    expect(renderToStaticMarkup(h(SharedPhotos, { photos: [] }))).toBe("");
    // 読み終わるまでの最初の描画（0 枚）でも出さない
    const html = renderToStaticMarkup(h(AddPhotos, { me: { id: "m-mother" } })) as string;
    expect(html).not.toContain("共有した写真");
    expect(html).not.toContain("shared-photos");
  });
  it("一覧はサーバーの古い順を新しい順にする（元の配列は変えない）", () => {
    const list = [photo("p-1"), photo("p-2"), photo("p-3")];
    expect(newestFirst(list).map((p: any) => p.id)).toEqual(["p-3", "p-2", "p-1"]);
    expect(list.map((p) => p.id)).toEqual(["p-1", "p-2", "p-3"]);
  });
  it("自分の写真を読む（GET /api/photos?ownerMemberId=）。選んで送り終えたら（途中で失敗しても）読み直す", () => {
    const src = read("src/client/screens/AddPhotos.tsx");
    expect(src).toMatch(/api\s*\.listPhotos\(memberId\)/);
    expect(src).toMatch(/\} finally \{\s*setBusy\(false\);[\s\S]*?mine\.reload\(\);\s*\}/);
    expect(src).toContain("<SharedPhotos photos={mine.photos} />");
  });
  it("読めなかったら前の一覧のまま（文を出さない）。後から届いた古い読み込みは捨てる（qa）", () => {
    const src = read("src/client/screens/AddPhotos.tsx");
    const hook = src.slice(src.indexOf("function useMyPhotos"), src.indexOf("export const newestFirst"));
    expect(hook).toMatch(/const n = \+\+seq\.current;/);
    expect(hook).toMatch(/if \(n === seq\.current\) setPhotos\(newestFirst\(r\.photos\)\)/);
    expect(hook).toMatch(/\.catch\(\(\) => \{\}\)/);
    expect(hook).not.toMatch(/setError|ErrorLine/);
  });
  it("祖父母の画面には数も一覧も出さない（Elder は photoCount も SharedPhotos も使わない）（qa）", () => {
    for (const f of fs.readdirSync(path.join(repoRoot, "src/client/screens")) as string[]) {
      if (!/^Elder/.test(f)) continue;
      const src = read(`src/client/screens/${f}`);
      expect(src).not.toMatch(/photoCount|SharedPhotos|words\.photos\.shared/);
    }
  });
  it("小さい写真はアルバムの小さい写真と同じ 48px 角で、折り返す（幅 360px で横にはみ出さない）", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\n\.shared-photos \{[^}]*flex-wrap: wrap;/);
    expect(css).toMatch(/\n\.shared-photo \{[^}]*width: 48px;[^}]*height: 48px;/);
    expect(css).toMatch(/\n\.shared-photo \.photo-button \{[^}]*min-width: 48px;[^}]*min-height: 48px;/);
  });
});

describe("家族のこと: 一人ずつ共有した写真の数", () => {
  const base = { speechStyle: "standard", dialectRegion: null, setUpByMemberId: null, hasLink: true };
  const mother = { ...base, id: "m-mother", role: "family", relation: "母", calledAs: "おかあさん", photoCount: 12 };
  const son = { ...base, id: "m-son", role: "family", relation: "息子", calledAs: "けん", photoCount: 1 };
  const grandma = { ...base, id: "m-grandma", role: "elder", relation: "祖母", calledAs: "ばあば", photoCount: 0 };
  const view = { family: { id: "f", isDemo: true, clock: { date: "2026-11-04", slot: "morning" }, canAdvanceClock: true }, members: [grandma, mother, son], me: mother };
  const html = renderToStaticMarkup(h(FamilySetup, { view, me: mother, reload: async () => {}, refresh: async () => {} })) as string;
  const cardOf = (name: string) => html.match(new RegExp(`<li class="card"><div>${name}（[^<]*</div>[\\s\\S]*?</li>`))?.[0] ?? "";

  it("各人のカードに「共有した写真 n枚」を補助の文字で一行", () => {
    expect(cardOf("おかあさん")).toContain(`<div class="sub">${words.photos.shared(12)}</div>`);
    expect(cardOf("けん")).toContain(`<div class="sub">${words.photos.shared(1)}</div>`);
  });
  it("0 枚の人には出さない（催促に見せない）", () => {
    expect(cardOf("ばあば")).not.toBe("");
    expect(cardOf("ばあば")).not.toContain("共有した写真");
    expect(html.match(/共有した写真/g)).toHaveLength(2);
  });
  it("開いたときに家族の様子を静かに読み直す（写真を共有した後に来ても数が古くならない）", () => {
    expect(read("src/client/screens/FamilySetup.tsx")).toMatch(/useEffect\(\(\) => \{\s*void refresh\(\);\s*\}, \[refresh\]\);/);
    const app = read("src/client/App.tsx");
    expect(app).toContain("refresh={refresh}");
    // 失敗しても今の画面のまま（エラーの画面にしない）
    expect(app).toMatch(/const refresh = useCallback\(async \(\) => \{\s*try \{\s*const view = await api\.getFamily\(\);\s*setLoad\(\{ state: "ready", view \}\);\s*\} catch \{/);
  });
});
