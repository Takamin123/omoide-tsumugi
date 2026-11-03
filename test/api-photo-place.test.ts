// 写真の場所（0047）: GET /api/photos と GET /api/feed にも地名の文字だけが載り、緯度経度は載らない。
// 地名・緯度経度はログに出ない。座標は架空の写真のためのもの（市役所などの公開の代表点の近く、外国、海の上）。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addMember, addPhoto, createFamily, makeTestApp, postForm, startD1, type TestApp } from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

type PhotoJson = Record<string, unknown> & { id: string; place: string | null };

function textForm(photoId: string): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify({ kind: "text", photoId, entranceId: null, replyToId: null, text: "架空の思い出の文" }));
  return form;
}

describe("写真の場所は一覧と語りの束にも文字だけで載る（0047）", () => {
  it("GET /api/photos・GET /api/feed: 日本の中は地名、位置なし・外国・海の上は null。緯度経度は返さない。ログに出ない", async () => {
    const logs: string[] = [];
    const spies = (["log", "warn", "error", "info"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    );
    try {
      const f = await createFamily(t);
      const m = await addMember(t, f.cookie);
      const ise = await addPhoto(t, m.cookie, 101, { latitude: 34.49, longitude: 136.71 });
      const none = await addPhoto(t, m.cookie, 102);
      const seoul = await addPhoto(t, m.cookie, 103, { latitude: 37.57, longitude: 126.98 });
      const ocean = await addPhoto(t, m.cookie, 104, { latitude: 30.0, longitude: 160.0 });

      const listBody = await (await t.app.request("/api/photos", { headers: { Cookie: m.cookie } })).text();
      const photos = (JSON.parse(listBody) as { photos: PhotoJson[] }).photos;
      const byId = new Map(photos.map((p) => [p.id, p]));
      expect(byId.get(ise.id)!.place).toBe("三重県伊勢市");
      expect(byId.get(none.id)!.place).toBeNull();
      expect(byId.get(seoul.id)!.place).toBeNull();
      expect(byId.get(ocean.id)!.place).toBeNull();
      for (const p of photos) {
        expect(p).not.toHaveProperty("latitude");
        expect(p).not.toHaveProperty("longitude");
      }
      expect(listBody).not.toContain("34.49");
      expect(listBody).not.toContain("136.71");

      for (const p of [ise, none]) expect((await postForm(t, "/api/narrations", textForm(p.id), m.cookie)).status).toBe(202);
      const feedBody = await (await t.app.request("/api/feed", { headers: { Cookie: m.cookie } })).text();
      const items = (JSON.parse(feedBody) as { items: { photo: PhotoJson }[] }).items;
      const feedById = new Map(items.map((i) => [i.photo.id, i.photo]));
      expect(feedById.get(ise.id)!.place).toBe("三重県伊勢市");
      expect(feedById.get(none.id)!.place).toBeNull();
      expect(feedBody).not.toContain("latitude");
      expect(feedBody).not.toContain("136.71");
    } finally {
      for (const s of spies) s.mockRestore();
    }
    const all = logs.join("\n");
    expect(all).not.toContain("伊勢");
    expect(all).not.toContain("34.49");
    expect(all).not.toContain("136.71");
  });
});
