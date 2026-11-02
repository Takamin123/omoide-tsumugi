// 写真と語り: 受け取り、冪等、ほかの家族からは見えないこと、返すときのヘッダ、背景の文字起こし。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  addPhoto,
  createFamily,
  fakeTranscriber,
  hashOf,
  makeTestApp,
  photoForm,
  postForm,
  startD1,
  tinyJpeg,
  type TestApp,
} from "./helpers";

let d1: D1Database;
let dispose: () => Promise<void>;
let t: TestApp;
beforeAll(async () => {
  ({ d1, dispose } = await startD1());
  t = makeTestApp(d1);
}, 60_000);
afterAll(() => dispose());

const meta = (ownerMemberId: string, extra: Record<string, unknown> = {}) => ({
  ownerMemberId,
  contentHash: hashOf(1),
  width: 1200,
  height: 900,
  takenAt: "1985-08-12T10:30:00",
  latitude: 31.6,
  longitude: 130.56,
  ...extra,
});

function narrationForm(m: Record<string, unknown>, audio?: { bytes: Uint8Array; type: string }): FormData {
  const form = new FormData();
  form.append("meta", JSON.stringify(m));
  if (audio) form.append("audio", new File([audio.bytes], "a", { type: audio.type }));
  return form;
}
const textMeta = (speakerMemberId: string, photoId: string, extra: Record<string, unknown> = {}) => ({
  kind: "text",
  speakerMemberId,
  photoId,
  entranceId: null,
  replyToId: null,
  text: "架空の思い出の文",
  ...extra,
});
const fakeAudio = { bytes: new Uint8Array([1, 2, 3, 4]), type: "audio/webm;codecs=opus" };

describe("POST /api/photos", () => {
  it("保存して 201。同じ持ち主・同じ content_hash は 200 duplicate で一つにまとめる", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const first = await postForm(t, "/api/photos", photoForm(meta(m.id)), f.cookie);
    expect(first.status).toBe(201);
    const a = (await first.json()) as { photo: Record<string, unknown>; duplicate: boolean };
    expect(a.duplicate).toBe(false);
    expect(a.photo).toMatchObject({ ownerMemberId: m.id, width: 1200, takenAt: "1985-08-12T10:30:00", hasLocation: true });
    expect(a.photo).not.toHaveProperty("latitude");
    expect(a.photo.imageUrl).toBe(`/api/photos/${a.photo.id}/image`);

    const again = await postForm(t, "/api/photos", photoForm(meta(m.id)), f.cookie);
    expect(again.status).toBe(200);
    const b = (await again.json()) as { photo: { id: string }; duplicate: boolean };
    expect(b).toMatchObject({ duplicate: true, photo: { id: a.photo.id } });
    expect(t.store.keys().filter((k) => k.includes(f.familyId))).toEqual([`families/${f.familyId}/photos/${a.photo.id}.jpg`]);
  });

  it.each([
    ["丸めていない緯度", { latitude: 31.5966 }],
    ["丸めていない経度", { longitude: 130.5571 }],
    ["片方だけの位置", { longitude: null }],
    ["content_hash の形が違う", { contentHash: "abc" }],
  ])("%s → 400", async (_n, extra) => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const res = await postForm(t, "/api/photos", photoForm(meta(m.id, extra)), f.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("位置のない写真は hasLocation: false。生の緯度経度はデータベースにも入らない", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const res = await postForm(t, "/api/photos", photoForm(meta(m.id, { latitude: null, longitude: null, contentHash: hashOf(9) })), f.cookie);
    expect(((await res.json()) as { photo: { hasLocation: boolean } }).photo.hasLocation).toBe(false);
  });

  it("JPEG でないものは 400、大きすぎるものは 413、Content-Length がなければ 400", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    expect((await postForm(t, "/api/photos", photoForm(meta(m.id), new Uint8Array([1, 2, 3])), f.cookie)).status).toBe(400);
    expect((await postForm(t, "/api/photos", photoForm(meta(m.id), tinyJpeg(), "image/png"), f.cookie)).status).toBe(400);
    const big = await t.app.request("/api/photos", {
      method: "POST",
      headers: { Cookie: f.cookie, "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(11 * 1024 * 1024) },
      body: "x",
    });
    expect(big.status).toBe(413);
    const noLen = await t.app.request("/api/photos", { method: "POST", headers: { Cookie: f.cookie }, body: photoForm(meta(m.id)) });
    expect(noLen.status).toBe(400);
  });

  it("ほかの家族の人の写真として登録できない（404）", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    expect((await postForm(t, "/api/photos", photoForm(meta(ma.id)), b.cookie)).status).toBe(404);
  });
});

describe("写真を返す", () => {
  it("合言葉を確かめた家族にだけ、Cache-Control: private, no-store で返す。ほかの家族には 404", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const m = await addMember(t, a.cookie);
    const p = await addPhoto(t, a.cookie, m.id, 5);
    const res = await t.app.request(`/api/photos/${p.id}/image`, { headers: { Cookie: a.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tinyJpeg(5));
    expect((await t.app.request(`/api/photos/${p.id}/image`, { headers: { Cookie: b.cookie } })).status).toBe(404);
    expect((await t.app.request(`/api/photos/${p.id}/image`)).status).toBe(401);

    const list = (await (await t.app.request(`/api/photos?ownerMemberId=${m.id}`, { headers: { Cookie: a.cookie } })).json()) as { photos: { id: string }[] };
    expect(list.photos.map((x) => x.id)).toEqual([p.id]);
    const other = (await (await t.app.request(`/api/photos`, { headers: { Cookie: b.cookie } })).json()) as { photos: unknown[] };
    expect(other.photos).toEqual([]);
  });
});

describe("POST /api/narrations", () => {
  it("文字の語りは、そのまま done で 202。ほかの家族の写真には語れない", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const m = await addMember(t, a.cookie);
    const p = await addPhoto(t, a.cookie, m.id, 1);
    const res = await postForm(t, "/api/narrations", narrationForm(textMeta(m.id, p.id)), a.cookie);
    expect(res.status).toBe(202);
    const { narration } = (await res.json()) as { narration: Record<string, unknown> };
    expect(narration).toMatchObject({ kind: "text", transcriptStatus: "done", text: "架空の思い出の文", audioUrl: null, forDate: "2026-11-02" });
    const mb = await addMember(t, b.cookie);
    expect((await postForm(t, "/api/narrations", narrationForm(textMeta(mb.id, p.id)), b.cookie)).status).toBe(404);
  });

  it("声の語りは、202 を返してから背景で文字起こしする。方言の地域を渡す", async () => {
    const tr = fakeTranscriber(() => ({ ok: true, text: "架空の文字起こし" }));
    const t2 = makeTestApp(d1, { transcriber: tr });
    const f = await createFamily(t2);
    const g = await addMember(t2, f.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島" });
    const p = await addPhoto(t2, f.cookie, g.id, 1);
    const res = await postForm(t2, "/api/narrations", narrationForm({ ...textMeta(g.id, p.id), kind: "voice", text: null }, fakeAudio), f.cookie);
    expect(res.status).toBe(202);
    const { narration } = (await res.json()) as { narration: { id: string; transcriptStatus: string; audioUrl: string } };
    expect(narration.transcriptStatus).toBe("pending");
    expect(tr.calls).toHaveLength(0); // まだ呼んでいない（返した後に呼ぶ）

    await t2.flush();
    expect(tr.calls).toHaveLength(1);
    expect(tr.calls[0]!.dialectRegion).toBe("鹿児島");
    const list = (await (await t2.app.request(`/api/narrations?photoId=${p.id}`, { headers: { Cookie: f.cookie } })).json()) as {
      narrations: { transcriptStatus: string; text: string }[];
    };
    expect(list.narrations[0]).toMatchObject({ transcriptStatus: "done", text: "架空の文字起こし" });

    const audio = await t2.app.request(narration.audioUrl, { headers: { Cookie: f.cookie } });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("cache-control")).toBe("private, no-store");
    expect(audio.headers.get("content-type")).toBe("audio/webm;codecs=opus");
  });

  it("文字起こしが失敗したら（キーがないときを含む）、録音は残し、文字は空のまま failed", async () => {
    const tr = fakeTranscriber(() => ({ ok: false, reason: "not_configured" }));
    const t2 = makeTestApp(d1, { transcriber: tr });
    const f = await createFamily(t2);
    const m = await addMember(t2, f.cookie);
    const p = await addPhoto(t2, f.cookie, m.id, 1);
    const res = await postForm(t2, "/api/narrations", narrationForm({ ...textMeta(m.id, p.id), kind: "voice", text: null }, fakeAudio), f.cookie);
    const { narration } = (await res.json()) as { narration: { id: string; audioUrl: string } };
    await t2.flush();
    const row = await d1.prepare("SELECT transcript, transcript_status FROM narrations WHERE id = ?").bind(narration.id).first();
    expect(row).toEqual({ transcript: null, transcript_status: "failed" });
    expect((await t2.app.request(narration.audioUrl, { headers: { Cookie: f.cookie } })).status).toBe(200);
  });

  it("同じ requestId の再送は、作ってある語りを返し、二つにしない", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, f.cookie, m.id, 1);
    const requestId = crypto.randomUUID();
    const m1 = { ...textMeta(m.id, p.id), kind: "voice", text: null, requestId };
    const r1 = (await (await postForm(t, "/api/narrations", narrationForm(m1, fakeAudio), f.cookie)).json()) as { narration: { id: string } };
    const res2 = await postForm(t, "/api/narrations", narrationForm(m1, fakeAudio), f.cookie);
    expect(res2.status).toBe(202);
    const r2 = (await res2.json()) as { narration: { id: string } };
    expect(r2.narration.id).toBe(r1.narration.id);
    const count = await d1.prepare("SELECT COUNT(*) AS n FROM narrations WHERE family_id = ?").bind(f.familyId).first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect(t.store.keys().filter((k) => k.startsWith(`families/${f.familyId}/audio/`))).toHaveLength(1);
    await t.flush();
  });

  it.each([
    ["声なのに録音がない", (s: string, p: string) => narrationForm({ ...textMeta(s, p), kind: "voice", text: null })],
    ["録音が音声でない", (s: string, p: string) => narrationForm({ ...textMeta(s, p), kind: "voice", text: null }, { bytes: new Uint8Array([1]), type: "text/html" })],
    ["文字なのに録音がある", (s: string, p: string) => narrationForm(textMeta(s, p), fakeAudio)],
    ["文字の語りに文字がない", (s: string, p: string) => narrationForm({ ...textMeta(s, p), text: null })],
  ])("%s → 400", async (_n, make) => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, f.cookie, m.id, 1);
    expect((await postForm(t, "/api/narrations", make(m.id, p.id), f.cookie)).status).toBe(400);
  });

  it("ほかの家族の語りへの返事、ほかの家族の録音は 404", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    const pa = await addPhoto(t, a.cookie, ma.id, 1);
    const na = (await (await postForm(t, "/api/narrations", narrationForm({ ...textMeta(ma.id, pa.id), kind: "voice", text: null }, fakeAudio), a.cookie)).json()) as {
      narration: { id: string; audioUrl: string };
    };
    await t.flush();
    const mb = await addMember(t, b.cookie);
    const pb = await addPhoto(t, b.cookie, mb.id, 1);
    expect((await postForm(t, "/api/narrations", narrationForm(textMeta(mb.id, pb.id, { replyToId: na.narration.id })), b.cookie)).status).toBe(404);
    expect((await t.app.request(na.narration.audioUrl, { headers: { Cookie: b.cookie } })).status).toBe(404);
    expect((await t.app.request(`/api/narrations?photoId=${pa.id}`, { headers: { Cookie: b.cookie } })).status).toBe(404);
  });
});

describe("GET /api/feed", () => {
  it("語りのある写真を、新しい語りのある写真から順に返す", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p1 = await addPhoto(t, f.cookie, m.id, 1);
    const p2 = await addPhoto(t, f.cookie, m.id, 2);
    await addPhoto(t, f.cookie, m.id, 3); // 語りのない写真は出ない
    t.setNow(new Date("2026-11-02T01:00:00Z"));
    await postForm(t, "/api/narrations", narrationForm(textMeta(m.id, p1.id)), f.cookie);
    t.setNow(new Date("2026-11-02T02:00:00Z"));
    await postForm(t, "/api/narrations", narrationForm(textMeta(m.id, p2.id)), f.cookie);
    t.setNow(new Date("2026-11-02T00:00:00Z"));
    const feed = (await (await t.app.request("/api/feed", { headers: { Cookie: f.cookie } })).json()) as {
      items: { photo: { id: string }; narrations: unknown[] }[];
    };
    expect(feed.items.map((i) => i.photo.id)).toEqual([p2.id, p1.id]);
    expect(feed.items[0]!.narrations).toHaveLength(1);
  });
});
