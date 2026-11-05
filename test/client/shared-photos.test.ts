// 自分が共有した写真の数と一覧（写真を家族に共有する画面）、家族のことのカードの数（0053）。
// 一覧から選んだ写真に、入れた本人が前もって言葉を添える（0054）。DOM なし。
// 部品は react-dom/server で文字列にして確かめ、読み直しの配線はソースの形で確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { AddPhotos, AddWords, SharedPhotos, newestFirst, toldByPhoto } = await load("../../src/client/screens/AddPhotos");
const { FamilySetup } = await load("../../src/client/screens/FamilySetup");
const { words } = await load("../../src/client/words");
const { Narrations } = await load("../../src/client/parts/Narrations");
const { RetakeContext } = await load("../../src/client/lib/retake");

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
  it("見出しに数を一行、その下に小さい写真を並べる。押すと選ぶ（拡大は選んだ大きめの写真から。0054）、読み込みは lazy", () => {
    const html = renderToStaticMarkup(h(SharedPhotos, { photos: [photo("p-3"), photo("p-2"), photo("p-1")] })) as string;
    expect(html).toContain(`<h2>${words.photos.shared(3)}</h2>`);
    expect(html.match(/class="shared-photo"/g)).toHaveLength(3);
    expect(html.match(/<button type="button" class="shared-pick"/g)).toHaveLength(3);
    expect(html).not.toContain(words.photoView.open);
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
    expect(src).toContain("<SharedPhotos photos={mine.photos} told={told.byPhoto}");
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
    expect(css).toMatch(/\n\.shared-pick \{[^}]*min-width: 48px;[^}]*min-height: 48px;/);
  });
});

describe("自分の写真に言葉を添える（0054）", () => {
  const told = (narrations: Record<string, unknown>[] = [{}]) => narrations;
  const narration = (id: string, photoId: string, speakerMemberId: string, text: string) => ({
    id, photoId, speakerMemberId, kind: "text", text, audioUrl: null, durationMs: null, entranceId: null, replyToId: null, createdAt: "2026-11-04T00:00:00Z", transcriptStatus: "done", quotedFrom: null,
  });

  it("言葉: 見出し「言葉を添える」、読み上げの名前「n枚目」「n枚目（言葉あり）」。！・催促なし", () => {
    expect(words.photos.addWords).toBe("言葉を添える");
    expect(words.photos.sharedOne(1, false)).toBe("1枚目");
    expect(words.photos.sharedOne(3, true)).toBe("3枚目（言葉あり）");
    const all = [words.photos.addWords, words.photos.sharedOne(2, true), words.photos.sharedOne(2, false)].join("\n");
    expect(all).not.toMatch(/[！!]|まだ|ください|添えていない/);
  });

  it("印は言葉の有無で替わる: 語りのある写真だけに吹き出しの印と「（言葉あり）」。選んだ写真は aria-current", () => {
    const photos = [photo("p-3"), photo("p-2"), photo("p-1")];
    const html = renderToStaticMarkup(h(SharedPhotos, { photos, told: new Map([["p-2", told()]]), selectedId: "p-1" })) as string;
    const button = (id: string) => html.match(new RegExp(`<button [^>]*>(?:(?!</button>).)*?/api/photos/${id}/image(?:(?!</button>).)*?</button>`))?.[0] ?? "";
    expect(button("p-2")).toContain(`aria-label="${words.photos.sharedOne(2, true)}"`);
    expect(button("p-2")).toContain('class="words-mark" aria-hidden="true"');
    expect(button("p-3")).toContain(`aria-label="${words.photos.sharedOne(1, false)}"`);
    expect(button("p-3")).not.toContain("words-mark");
    expect(button("p-1")).not.toContain("words-mark");
    expect(button("p-1")).toContain('aria-current="true"');
    expect(html.match(/aria-current/g)).toHaveLength(1);
    // 同じ一覧でも、語りが付けば印が替わる
    const after = renderToStaticMarkup(h(SharedPhotos, { photos, told: new Map([["p-2", told()], ["p-3", told()]]) })) as string;
    expect(after.match(/class="words-mark"/g)).toHaveLength(2);
    expect(after).toContain(`aria-label="${words.photos.sharedOne(1, true)}"`);
  });

  it("印の元: feed の並びから写真の ID → 語り（語りが空の写真は入れない）", () => {
    const m = toldByPhoto([
      { photo: photo("p-1"), narrations: [narration("n-1", "p-1", "m-mother", "架空の言葉")] },
      { photo: photo("p-2"), narrations: [] },
    ]);
    expect([...m.keys()]).toEqual(["p-1"]);
  });

  it("選ぶと一覧の下に欄を出す: 大きめの写真（押すと拡大）→ 語り（聞くだけ。返事は出さない）→ 見出し → 声で話す・文字で書く", () => {
    const html = renderToStaticMarkup(
      h(AddWords, {
        photo: photo("p-1"),
        narrations: [narration("n-1", "p-1", "m-son", "架空の弟の言葉")],
        nameOf: (id: string) => (id === "m-son" ? "けん" : ""),
        onSent: () => {},
      }),
    ) as string;
    const order = [words.photoView.open, "けん", "架空の弟の言葉", `<h3>${words.photos.addWords}</h3>`, words.home.byVoice, words.home.byText].map((t) => html.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).not.toContain(`>${words.home.reply}<`);
    // 語りがなければ語りの欄はなく、見出しと答えの欄だけ
    const empty = renderToStaticMarkup(h(AddWords, { photo: photo("p-1"), narrations: [], nameOf: () => "", onSent: () => {} })) as string;
    expect(empty).not.toContain('class="narration');
    expect(empty).toContain(`<h3>${words.photos.addWords}</h3>`);
  });

  it("選んでいない（最初の描画）ときは欄を出さない", () => {
    const html = renderToStaticMarkup(h(AddPhotos, { me: { id: "m-mother" }, members: [] })) as string;
    expect(html).not.toContain(words.photos.addWords);
  });

  it("送る先はこの写真だけ（entranceId・replyToId とも null）。録り直すの場所は写真の ID", () => {
    const src = read("src/client/screens/AddPhotos.tsx");
    expect(src).toMatch(/\{ photoId: photo\.id, entranceId: null, replyToId: null \}/);
    expect(src).toMatch(/<ReplyBox\s+target=\{target\}\s+onSent=\{onAdded\}[\s\S]*?retakeAt=\{photo\.id\}/);
    expect(src).toMatch(/<RetakeContext\.Provider value=\{retake\}>/);
  });

  it("送れたら（録り直しなら前の語りを消し終えてから）語りを読み直す。印と語りはその読み直しで替わる", () => {
    const src = read("src/client/screens/AddPhotos.tsx");
    expect(src).toMatch(/const replaced = offer\(photo\.id, sent\);[\s\S]*?void replaced\.then\(onSent\);/);
    expect(src).toMatch(/onSent=\{told\.reload\}/);
    expect(src).toMatch(/narrations=\{told\.byPhoto\.get\(selected\.id\) \?\? \[\]\}/);
    const hook = src.slice(src.indexOf("function useToldPhotos"), src.indexOf("export const toldByPhoto"));
    expect(hook).toMatch(/\.getFeed\(\)/);
    expect(hook).toMatch(/if \(n === seq\.current\) setByPhoto\(toldByPhoto\(r\.items\)\)/);
    expect(hook).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it("祖父母の画面には出さない（Elder は AddWords も言葉を添える欄も使わない）", () => {
    for (const f of fs.readdirSync(path.join(repoRoot, "src/client/screens")) as string[]) {
      if (!/^Elder/.test(f)) continue;
      expect(read(`src/client/screens/${f}`)).not.toMatch(/AddWords|words\.photos\.addWords/);
    }
  });
});

describe("語りの canReply（0054。qa）", () => {
  const noop = () => {};
  const slot = { at: "n-1", id: "n-1", sentAt: Date.now(), failed: false, retaking: false, replacing: false };
  const withSlot = (el: any) =>
    renderToStaticMarkup(h(RetakeContext.Provider, { value: { slot, offer: async () => {}, start: noop, end: noop, clear: noop } }, el)) as string;
  const voice = { id: "n-1", speakerMemberId: "m-grandma", photoId: "p-1", entranceId: null, replyToId: null, kind: "voice", text: "架空の声の文", transcriptStatus: "done", audioUrl: "/api/narrations/n-1/audio", durationMs: 3000, createdAt: 1, quotedFrom: null };
  const text = { ...voice, id: "n-2", kind: "text", text: "架空の文字の文", audioUrl: null, durationMs: null };
  const props = { narrations: [voice, text], nameOf: () => "ばあば", openReplyId: null, onOpenReply: noop, onSent: noop };

  it("既定（渡さない）は今のまま: 「返事」と返事の「録り直す」が出て、開いた返事の欄も出る", () => {
    const html = withSlot(h(Narrations, props));
    expect(html.match(new RegExp(`>${words.home.reply}<`, "g"))).toHaveLength(2);
    expect(html).toContain('class="retake"');
    expect(withSlot(h(Narrations, { ...props, openReplyId: "n-1" }))).toContain(words.home.byVoice);
  });
  it("偽: 「返事」「録り直す」、開いた返事の欄を出さない。声は聞ける。文字だけの語りは空の行を描かない", () => {
    const html = withSlot(h(Narrations, { ...props, openReplyId: "n-1", canReply: false }));
    expect(html).not.toContain(`>${words.home.reply}<`);
    expect(html).not.toContain('class="retake"');
    expect(html).not.toContain(words.home.byVoice);
    expect(html).not.toContain("<textarea");
    expect(html).toContain(`>${words.home.listen}</button>`);
    expect(html.match(/<div class="row">/g)).toHaveLength(1);
    expect(html).toContain("架空の文字の文");
  });
});

describe("配線と動き（0054。qa）", () => {
  it("App から家族の一覧を渡す（語りの話し手の呼ばれ方）", () => {
    expect(read("src/client/App.tsx")).toContain("<AddPhotos me={meMember} members={view.members} />");
  });
  it("欄の現れ方は動きを減らす設定で止める", () => {
    const css = read("src/client/styles.css");
    expect(css).toMatch(/\.add-words \{[^}]*animation: add-words-in/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.add-words \{\s*animation: none;/);
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
