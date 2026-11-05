// 「この写真に追加する」（0048、数え方と失敗の見せ方は 0049）。DOM なし。
// 送る道（lib/upload.ts）は偽の準備と偽の応答で、部品は react-dom/server で文字列にして確かめる。
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fs, path, repoRoot } from "../node";

const load = (name: string): Promise<any> => import(name);
const { createElement: h } = await load("react");
const { renderToStaticMarkup } = await load("react-dom/server");
const { Album } = await load("../../src/client/parts/Album");
const { AddToPhotoView } = await load("../../src/client/parts/AddToPhoto");
const { AddPhotos } = await load("../../src/client/screens/AddPhotos");
const { ScreenContext } = await load("../../src/client/lib/screen");
const { ApiError } = await load("../../src/client/lib/api");
const { UnreadableImageError } = await load("../../src/client/lib/photos");
const upload = await load("../../src/client/lib/upload");
const { words } = await load("../../src/client/words");
const { MAX_ADD_TO_PHOTO } = await load("../../src/shared/api");

const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8") as string;

const photo = (id: string) => ({ id, ownerMemberId: "m-mother", width: 1600, height: 1200, takenAt: null, hasLocation: false, place: null, imageUrl: `/api/photos/${id}/image` });
const narration = (id: string, photoId: string) => ({
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
  quotedFrom: null,
});
const items = [
  { photo: photo("p-1"), narrations: [narration("n-1", "p-1")], addedPhotos: [photo("z-1"), photo("z-2")] },
  { photo: photo("p-2"), narrations: [narration("n-2", "p-2")], addedPhotos: [] },
];
const nameOf = () => "ばあば";
const renderAlbum = (variant: "elder" | "family") =>
  renderToStaticMarkup(
    h(ScreenContext.Provider, { value: variant }, h(Album, { items, nameOf, currentId: null, onCurrent: () => {}, onSent: () => {}, composing: false })),
  ) as string;
/** 節ごとの HTML */
const sectionsOf = (html: string): string[] => html.split(/<section data-photo=/).slice(1);

describe("アルバムの節の末尾（0048）", () => {
  it("祖父母の画面（variant elder）では、列もボタンも描かない", () => {
    const html = renderAlbum("elder");
    expect(html).not.toContain(words.home.addToPhoto);
    expect(html).not.toContain("add-to-photo");
    expect(html).not.toContain("added-photos");
    expect(html).not.toContain("/api/photos/z-1/image");
  });
  it("家族の画面では、どの節も 見出し → 語り → 追加した写真の列 → 「この写真に追加する」の順で、節の末尾に置く", () => {
    const secs = sectionsOf(renderAlbum("family"));
    expect(secs).toHaveLength(2);
    for (const s of secs) {
      const head = s.indexOf('class="album-head"');
      const told = s.lastIndexOf('class="narration');
      const block = s.indexOf('class="add-to-photo"');
      const button = s.indexOf(words.home.addToPhoto);
      expect(head).toBeGreaterThanOrEqual(0);
      expect(told).toBeGreaterThan(head);
      expect(block).toBeGreaterThan(told);
      expect(button).toBeGreaterThan(block);
      // 見出しの中には入れない（見出しの高さは変えない）
      expect(s.slice(head, s.indexOf("</div>", head))).not.toContain("add-to-photo");
    }
  });
  it("追加した写真の列: 読み上げの名前「追加した写真」、押すと拡大の画面（0040）、文・見出しは出さない。0 枚なら列を出さない", () => {
    const [s1 = "", s2 = ""] = sectionsOf(renderAlbum("family"));
    expect(s1).toContain(`<div class="added-photos" role="group" aria-label="${words.home.addedPhotosLabel}">`);
    expect(s1.match(/class="added-photo"/g)).toHaveLength(2);
    expect(s1).toContain(`aria-label="${words.photoView.open}"`);
    expect(s1).toContain("/api/photos/z-2/image");
    expect(s1).not.toContain(`>${words.home.addedPhotosLabel}<`);
    expect(s2).not.toContain("added-photos");
  });
  it("ボタンは補助のボタン（.aux）で、点線の枠で横いっぱい（0059）。押すとその場で写真を選ぶ（複数）", () => {
    const [s1 = ""] = sectionsOf(renderAlbum("family"));
    expect(s1).toMatch(/<label class="button aux add-pick"><svg[^>]*><path[^>]*><\/path><\/svg>この写真に\u200B追加する<input type="file" accept="image\/\*" multiple="" class="visually-hidden"\/><\/label>/);
  });
});

const tally = (over: Record<string, number>) => ({ total: 3, done: 3, added: 0, duplicate: 0, unreadable: 0, failed: 0, ...over });
const view = (over: Record<string, unknown>) =>
  renderToStaticMarkup(
    h(AddToPhotoView, { shown: [], fresh: new Set(), progress: null, busy: false, limit: false, error: null, onPick: () => {}, onRemove: () => {}, ...over }),
  ) as string;

describe("AddToPhotoView の各段", () => {
  it("送っている間: 「3枚のうち 1枚」と進み具合の棒。ボタンは押せない。「はずす」は出さない", () => {
    const html = view({ busy: true, progress: { tally: tally({ done: 1, added: 1 }), linked: [{ photo: photo("z-3"), musubiId: "mu-1" }] } });
    expect(html).toContain(`<p class="sub">3枚のうち 1枚</p>`);
    expect(html).toContain(`<progress class="add-progress" max="3" value="1">`);
    expect(html).toContain(`class="button aux add-pick disabled" aria-disabled="true"`);
    expect(html).toContain(`disabled=""`);
    expect(html).not.toContain(words.home.removeAdded);
    expect(html).not.toContain(words.home.addedCount(1));
  });
  it("終わった後: 列に今回の写真（現れる動きの印 fresh）、「追加した写真 2枚」とほかの数、「はずす」、その下に「この写真に追加する」", () => {
    const linked = [
      { photo: photo("z-3"), musubiId: "mu-1" },
      { photo: photo("z-4"), musubiId: "mu-1" },
    ];
    const html = view({
      shown: [photo("z-1"), photo("z-3"), photo("z-4")],
      fresh: new Set(["z-3", "z-4"]),
      progress: { tally: tally({ total: 5, done: 5, added: 2, duplicate: 1, unreadable: 1, failed: 1 }), linked },
    });
    expect(html.match(/class="added-photo fresh"/g)).toHaveLength(2);
    expect(html.match(/class="added-photo"/g)).toHaveLength(1);
    for (const t of ["追加した写真 2枚", "すでにある写真 1枚", "読めなかった写真 1枚", "送れなかった写真 1枚"]) expect(html).toContain(`<p class="sub">${t}</p>`);
    const remove = html.indexOf(`<button type="button" class="aux">はずす</button>`);
    expect(remove).toBeGreaterThan(html.indexOf("追加した写真 2枚"));
    expect(html.indexOf(words.home.addToPhoto)).toBeGreaterThan(remove);
    expect(html).not.toContain("<progress");
  });
  it("今回つないだ写真がなければ、「追加した写真」の数も「はずす」も出さない", () => {
    const html = view({ progress: { tally: tally({ total: 1, done: 1, duplicate: 1 }), linked: [] } });
    expect(html).toContain("すでにある写真 1枚");
    expect(html).not.toContain(words.home.removeAdded);
    expect(html).not.toContain("追加した写真");
  });
  it("10 枚を超えたとき: 一行「一度に追加できるのは 10枚までです」。ボタンは押せる", () => {
    const html = view({ limit: true });
    expect(html).toContain(`<p role="alert" class="add-limit">一度に追加できるのは 10枚までです</p>`);
    expect(html).toContain(`<label class="button aux add-pick">`);
  });
  it("何もしていないとき: ボタンだけ（列も文も出さない）", () => {
    const html = view({});
    expect(html).not.toContain("added-photos");
    expect(html).not.toMatch(/<p[ >]/);
    expect(html).toContain(words.home.addToPhoto);
  });
});

/** 偽の準備と送る。起きた順を events に残す */
function fakeDeps(respond: (i: number) => any) {
  const events: string[] = [];
  const metas: any[] = [];
  let n = 0;
  const deps = {
    prepare: async (file: File) => {
      events.push(`prepare:${file.name}`);
      if (file.name.startsWith("heic")) throw new UnreadableImageError();
      return { blob: new Blob([file.name]), meta: { contentHash: `h-${file.name}`, width: 10, height: 10, takenAt: null, latitude: null, longitude: null } };
    },
    upload: async (_blob: Blob, meta: any) => {
      const i = n++;
      events.push(`upload-start:${i}`);
      metas.push(meta);
      await new Promise((r) => setTimeout(r, 5));
      events.push(`upload-end:${i}`);
      const r = respond(i);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { deps, events, metas };
}
const file = (name: string) => new File([name], name, { type: "image/jpeg" });
const ok = (id: string, linked: boolean, duplicate = false) => ({ photo: photo(id), duplicate, link: { musubiId: "mu-1", linked } });

describe("lib/upload.ts: addToPhoto（0048）", () => {
  it(`${MAX_ADD_TO_PHOTO} 枚を超えたら、一枚も準備せず一枚も送らない`, async () => {
    const { deps, events } = fakeDeps(() => ok("z", true));
    const progress: any[] = [];
    const files = Array.from({ length: MAX_ADD_TO_PHOTO + 1 }, (_, i) => file(`f${i}.jpg`));
    expect(await upload.addToPhoto(files, "p-1", (p: any) => progress.push(p), deps)).toEqual({ kind: "limit" });
    expect(events).toEqual([]);
    expect(progress).toEqual([]);
  });
  it(`${MAX_ADD_TO_PHOTO} 枚ちょうどは送る`, async () => {
    const { deps, metas } = fakeDeps((i) => ok(`z-${i}`, true));
    const files = Array.from({ length: MAX_ADD_TO_PHOTO }, (_, i) => file(`f${i}.jpg`));
    const r = await upload.addToPhoto(files, "p-1", () => {}, deps);
    expect(r.kind).toBe("done");
    expect(metas).toHaveLength(MAX_ADD_TO_PHOTO);
  });
  it("一枚ずつ順に送る（前の一枚の応答が届いてから次を準備する）。どれも meta.withPhotoId にこの写真の ID", async () => {
    const { deps, events, metas } = fakeDeps((i) => ok(`z-${i}`, true));
    await upload.addToPhoto([file("a.jpg"), file("b.jpg"), file("c.jpg")], "p-1", () => {}, deps);
    expect(events).toEqual([
      "prepare:a.jpg", "upload-start:0", "upload-end:0",
      "prepare:b.jpg", "upload-start:1", "upload-end:1",
      "prepare:c.jpg", "upload-start:2", "upload-end:2",
    ]);
    expect(metas.map((m) => m.withPhotoId)).toEqual(["p-1", "p-1", "p-1"]);
    expect(metas[0].contentHash).toBe("h-a.jpg");
  });
  it("数え方（0049）: linked なら追加（棚にあった写真でも）、linked でなければすでにある、link なしは送れなかった。一枚ごとに進み具合", async () => {
    const answers = [ok("z-0", true), ok("z-1", true, true), ok("z-2", false, true), { photo: photo("z-3"), duplicate: false, link: null }, new ApiError("not_found", 404)];
    const { deps } = fakeDeps((i) => answers[i]);
    const seen: any[] = [];
    const r = await upload.addToPhoto(
      [file("a.jpg"), file("b.jpg"), file("c.jpg"), file("d.jpg"), file("e.jpg"), file("heic.heic")],
      "p-1",
      (p: any) => seen.push(p.tally.done),
      deps,
    );
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.progress.tally).toEqual({ total: 6, done: 6, added: 2, duplicate: 1, unreadable: 1, failed: 2 });
    expect(r.progress.linked.map((l: any) => [l.photo.id, l.musubiId])).toEqual([["z-0", "mu-1"], ["z-1", "mu-1"]]);
  });
  it("リンクが切れた（401）ら、残りを送らずに止める", async () => {
    const { deps, metas } = fakeDeps((i) => (i === 0 ? new ApiError("unauthorized", 401) : ok("z", true)));
    await expect(upload.addToPhoto([file("a.jpg"), file("b.jpg")], "p-1", () => {}, deps)).rejects.toMatchObject({ kind: "unauthorized" });
    expect(metas).toHaveLength(1);
  });
  it("写真を家族に共有する画面の数え方は今までどおり（withPhotoId を送らない。duplicate ならすでにある）", async () => {
    const { deps, metas } = fakeDeps(() => ({ photo: photo("z"), duplicate: true, link: null }));
    const r = await upload.uploadOne(file("a.jpg"), undefined, deps);
    expect(upload.shelfOutcome(r)).toBe("duplicate");
    expect("withPhotoId" in metas[0]).toBe(false);
  });
});

describe("lib/upload.ts: removeLinked（はずす。0048、0049）", () => {
  const linked = [
    { photo: photo("z-1"), musubiId: "mu-1" },
    { photo: photo("z-2"), musubiId: "mu-1" },
    { photo: photo("z-3"), musubiId: "mu-1" },
  ];
  it("一枚ずつ外す。もう無い（404）は外れたとみなす。外せなかった分と最初の失敗を返す", async () => {
    const calls: string[] = [];
    const r = await upload.removeLinked(linked, async (m: string, p: string) => {
      calls.push(`${m}/${p}`);
      if (p === "z-2") throw new ApiError("not_found", 404);
      if (p === "z-3") throw new ApiError("internal", 0);
    });
    expect(calls).toEqual(["mu-1/z-1", "mu-1/z-2", "mu-1/z-3"]);
    expect(r.left.map((l: any) => l.photo.id)).toEqual(["z-3"]);
    expect(r.error).toMatchObject({ kind: "internal" });
  });
  it("全部外せたら、残りなし・失敗なし", async () => {
    const r = await upload.removeLinked(linked, async () => {});
    expect(r).toEqual({ left: [], error: null });
  });
});

describe("言葉（人間、2026-11-04）", () => {
  it("アルバムの「この写真に追加する」まわり", () => {
    expect(words.home.addToPhoto).toBe("この写真に\u200B追加する");
    expect(words.home.addedPhotosLabel).toBe("追加した写真");
    expect(words.home.addedCount(2)).toBe("追加した写真 2枚");
    expect(words.home.removeAdded).toBe("はずす");
    expect(words.home.addLimit).toBe("一度に追加できるのは 10枚までです");
  });
  it("上のメニューと写真を共有する画面の見出しは「写真を家族に共有する」。登録できたらその下に届き方の一行", () => {
    expect(words.home.menuPhotos).toBe("写真を家族に共有する");
    expect(words.photos.title).toBe("写真を家族に共有する");
    expect(words.photos.delivery).toBe("毎朝 1枚ずつ、家族の『今日』に届きます");
    expect(renderToStaticMarkup(h(AddPhotos, { me: { id: "m-mother" } }))).toContain("<h1>写真を家族に共有する</h1>");
    // 届き方の一行は、登録した写真が 1 枚以上のときだけ、「登録した写真 n枚」のすぐ下に
    expect(read("src/client/screens/AddPhotos.tsx")).toMatch(
      /\{tally\.added > 0 && \(\s*<>\s*<p className="sub">\{w\.added\(tally\.added\)\}<\/p>\s*<p className="sub">\{w\.delivery\}<\/p>/,
    );
  });
  it("言葉に求める文・「つながりました」・お礼・！を入れない", () => {
    const all = [words.home.addToPhoto, words.home.addedCount(1), words.home.removeAdded, words.home.addLimit, words.photos.delivery].join("\n");
    expect(all).not.toMatch(/[！!]|ありがとう|つなが|むすび|同じ出来事|ください/);
  });
});

describe("見た目の決まり（styles.css）", () => {
  const css = read("src/client/styles.css");
  const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
  it("列は 48px 角、間 8px、入らなければ折り返す（横に動かさない）", () => {
    expect(rule(".added-photos")).toContain("flex-wrap: wrap");
    expect(rule(".added-photos")).toContain("gap: 8px");
    expect(rule(".added-photo .photo-button")).toContain("min-width: 48px");
    expect(rule(".added-photo .photo-button")).toContain("min-height: 48px");
  });
  it("現れる動きは transform と opacity だけで 0.2〜0.3 秒。動きを減らす設定では付けない", () => {
    expect(rule(".added-photo.fresh")).toContain("0.25s");
    const kf = css.slice(css.indexOf("@keyframes added-photo-in"), css.indexOf("}\n}", css.indexOf("@keyframes added-photo-in")));
    expect(kf.match(/^\s+([a-z-]+):/gm)?.map((s) => s.trim().replace(":", "")).sort()).toEqual(["opacity", "opacity", "transform", "transform"]);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.added-photo\.fresh \{\s*animation: none;/);
  });
});

// qa-engineer が足した分（2026-11-04）
const { api } = await load("../../src/client/lib/api");

describe("qa: 送る道と「はずす」の端", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("api.removeFromMusubi は DELETE /api/musubi/:musubiId/photos/:photoId（ID は符号化）。204 は本文を読まない", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    });
    await expect(api.removeFromMusubi("mu/1", "z 1")).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/musubi/mu%2F1/photos/z%201");
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("本物の api で: 404 は外れたとみなし、500 は残す（removeLinked の既定の remove）", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/z-1")
        ? new Response(JSON.stringify({ error: "not_found" }), { status: 404 })
        : new Response(JSON.stringify({ error: "internal" }), { status: 500 }),
    );
    const r = await upload.removeLinked([
      { photo: photo("z-1"), musubiId: "mu-1" },
      { photo: photo("z-2"), musubiId: "mu-1" },
    ]);
    expect(r.left.map((l: any) => l.photo.id)).toEqual(["z-2"]);
    expect(r.error).toMatchObject({ kind: "internal" });
  });

  it("はずす途中でリンクが切れた（401）ものは外れたとみなさない（残して、その失敗を返す）", async () => {
    const r = await upload.removeLinked([{ photo: photo("z-1"), musubiId: "mu-1" }], async () => {
      throw new ApiError("unauthorized", 401);
    });
    expect(r.left.map((l: any) => l.photo.id)).toEqual(["z-1"]);
    expect(r.error).toMatchObject({ kind: "unauthorized" });
  });

  it("準備で読めない以外の失敗は「送れなかった」。送る前なので upload を呼ばない", async () => {
    let uploaded = 0;
    const r = await upload.uploadOne(file("a.jpg"), "p-1", {
      prepare: async () => {
        throw new Error("canvas");
      },
      upload: async () => {
        uploaded++;
        return ok("z", true);
      },
    });
    expect(r).toEqual({ result: null, failure: "failed" });
    expect(upload.linkOutcome(r)).toBe("failed");
    expect(uploaded).toBe(0);
  });

  it("この写真が無い（withPhotoId の 404）ときは「送れなかった」に数えて続ける。つないだ写真には入れない", async () => {
    const { deps, metas } = fakeDeps(() => new ApiError("not_found", 404));
    const r = await upload.addToPhoto([file("a.jpg"), file("b.jpg")], "p-gone", () => {}, deps);
    expect(metas).toHaveLength(2);
    expect(r.progress.tally).toMatchObject({ added: 0, failed: 2, done: 2 });
    expect(r.progress.linked).toEqual([]);
  });

  it("withPhotoId を足しても、準備した meta そのものは書き換えない", async () => {
    const meta = { contentHash: "h", width: 1, height: 1, takenAt: null, latitude: null, longitude: null };
    const sent: any[] = [];
    await upload.uploadOne(file("a.jpg"), "p-1", { prepare: async () => ({ blob: new Blob(["x"]), meta }), upload: async (_b: Blob, m: any) => (sent.push(m), ok("z", true)) });
    expect(sent[0].withPhotoId).toBe("p-1");
    expect("withPhotoId" in meta).toBe(false);
  });

  it("addedPhotos を持たない節（古い応答）でも、列は出さずボタンは出す", () => {
    const html = renderToStaticMarkup(
      h(ScreenContext.Provider, { value: "family" }, h(Album, { items: [{ photo: photo("p-9"), narrations: [narration("n-9", "p-9")] }], nameOf, currentId: null, onCurrent: () => {}, onSent: () => {}, composing: false })),
    ) as string;
    expect(html).not.toContain("added-photos");
    expect(html).toContain(words.home.addToPhoto);
  });

  it("家族の画面（Home）は、送り終えた・外した後に feed を読み直す", () => {
    expect(read("src/client/screens/Home.tsx")).toMatch(/onPhotosChanged=\{\(\) => void loadFeed\(\)\}/);
  });
});
