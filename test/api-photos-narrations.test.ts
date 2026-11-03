// 写真と語り: 受け取り、冪等、ほかの家族からは見えないこと、返すときのヘッダ、背景の文字起こし。
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const meta = (extra: Record<string, unknown> = {}) => ({
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
const textMeta = (photoId: string, extra: Record<string, unknown> = {}) => ({
  kind: "text",
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
    const first = await postForm(t, "/api/photos", photoForm(meta()), m.cookie);
    expect(first.status).toBe(201);
    const a = (await first.json()) as { photo: Record<string, unknown>; duplicate: boolean };
    expect(a.duplicate).toBe(false);
    expect(a.photo).toMatchObject({ ownerMemberId: m.id, width: 1200, takenAt: "1985-08-12T10:30:00", hasLocation: true });
    // 場所は文字だけ（架空の座標。鹿児島市の代表点の近く）。緯度経度は返さない（0047）
    expect(a.photo.place).toBe("鹿児島県鹿児島市");
    expect(a.photo).not.toHaveProperty("latitude");
    expect(a.photo).not.toHaveProperty("longitude");
    expect(a.photo.imageUrl).toBe(`/api/photos/${a.photo.id}/image`);

    const again = await postForm(t, "/api/photos", photoForm(meta()), m.cookie);
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
    const res = await postForm(t, "/api/photos", photoForm(meta(extra)), m.cookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("位置のない写真は hasLocation: false。生の緯度経度はデータベースにも入らない", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const res = await postForm(t, "/api/photos", photoForm(meta({ latitude: null, longitude: null, contentHash: hashOf(9) })), m.cookie);
    const { photo } = (await res.json()) as { photo: { hasLocation: boolean; place: string | null } };
    expect(photo.hasLocation).toBe(false);
    expect(photo.place).toBeNull();
  });

  it("JPEG でないものは 400、大きすぎるものは 413、Content-Length がなければ 400", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    expect((await postForm(t, "/api/photos", photoForm(meta(), new Uint8Array([1, 2, 3])), m.cookie)).status).toBe(400);
    expect((await postForm(t, "/api/photos", photoForm(meta(), tinyJpeg(), "image/png"), m.cookie)).status).toBe(400);
    const big = await t.app.request("/api/photos", {
      method: "POST",
      headers: { Cookie: m.cookie, "Content-Type": "multipart/form-data; boundary=x", "Content-Length": String(11 * 1024 * 1024) },
      body: "x",
    });
    expect(big.status).toBe(413);
    const noLen = await t.app.request("/api/photos", { method: "POST", headers: { Cookie: m.cookie }, body: photoForm(meta()) });
    expect(noLen.status).toBe(400);
  });

  it("持ち主は cookie の人。meta に別の人の ID を入れても使わない（0036）", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    const mb = await addMember(t, b.cookie);
    const ma2 = await addMember(t, ma.cookie, { calledAs: "架空のけんちゃん" });
    const res = await postForm(t, "/api/photos", photoForm({ ...meta({ contentHash: hashOf(21) }), ownerMemberId: ma.id }), ma2.cookie);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { photo: { ownerMemberId: string } }).photo.ownerMemberId).toBe(ma2.id);
    // ほかの家族の人の ID を入れても、その家族の写真にはならない
    const other = await postForm(t, "/api/photos", photoForm({ ...meta({ contentHash: hashOf(22) }), ownerMemberId: ma.id }), mb.cookie);
    expect(other.status).toBe(201);
    expect(((await other.json()) as { photo: { ownerMemberId: string } }).photo.ownerMemberId).toBe(mb.id);
  });
});

describe("写真を返す", () => {
  it("合言葉を確かめた家族にだけ、Cache-Control: private, no-store で返す。ほかの家族には 404", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const m = await addMember(t, a.cookie);
    const mb = await addMember(t, b.cookie);
    const p = await addPhoto(t, m.cookie, 5);
    const res = await t.app.request(`/api/photos/${p.id}/image`, { headers: { Cookie: m.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(tinyJpeg(5));
    expect((await t.app.request(`/api/photos/${p.id}/image`, { headers: { Cookie: mb.cookie } })).status).toBe(404);
    expect((await t.app.request(`/api/photos/${p.id}/image`)).status).toBe(401);

    const list = (await (await t.app.request(`/api/photos?ownerMemberId=${m.id}`, { headers: { Cookie: m.cookie } })).json()) as { photos: { id: string }[] };
    expect(list.photos.map((x) => x.id)).toEqual([p.id]);
    const other = (await (await t.app.request(`/api/photos`, { headers: { Cookie: mb.cookie } })).json()) as { photos: unknown[] };
    expect(other.photos).toEqual([]);
  });
});

describe("POST /api/narrations", () => {
  it("文字の語りは、そのまま done で 202。ほかの家族の写真には語れない", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const m = await addMember(t, a.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    const res = await postForm(t, "/api/narrations", narrationForm(textMeta(p.id)), m.cookie);
    expect(res.status).toBe(202);
    const { narration } = (await res.json()) as { narration: Record<string, unknown> };
    expect(narration).toMatchObject({ kind: "text", speakerMemberId: m.id, transcriptStatus: "done", text: "架空の思い出の文", audioUrl: null, forDate: "2026-11-02" });
    const mb = await addMember(t, b.cookie);
    expect((await postForm(t, "/api/narrations", narrationForm(textMeta(p.id)), mb.cookie)).status).toBe(404);
  });

  it("声の語りは、202 を返してから背景で文字起こしする。方言の地域を渡す", async () => {
    const tr = fakeTranscriber(() => ({ ok: true, text: "架空の文字起こし" }));
    const t2 = makeTestApp(d1, { transcriber: tr });
    const f = await createFamily(t2);
    const owner = await addMember(t2, f.cookie);
    const g = await addMember(t2, owner.cookie, { role: "elder", relation: "祖母", calledAs: "ばあば", speechStyle: "dialect", dialectRegion: "鹿児島" });
    const p = await addPhoto(t2, g.cookie, 1);
    // 話し手は cookie の人（祖母の端末）
    const res = await postForm(t2, "/api/narrations", narrationForm({ ...textMeta(p.id), kind: "voice", text: null }, fakeAudio), g.cookie);
    expect(res.status).toBe(202);
    const { narration } = (await res.json()) as { narration: { id: string; transcriptStatus: string; audioUrl: string } };
    expect(narration.transcriptStatus).toBe("pending");
    expect(tr.calls).toHaveLength(0); // まだ呼んでいない（返した後に呼ぶ）

    await t2.flush();
    expect(tr.calls).toHaveLength(1);
    expect(tr.calls[0]!.dialectRegion).toBe("鹿児島");
    // 話し手（ばあば）が先。家族の呼ばれ方が続く
    expect(tr.calls[0]!.keywords).toEqual(["ばあば", "おかあさん"]);
    const list = (await (await t2.app.request(`/api/narrations?photoId=${p.id}`, { headers: { Cookie: owner.cookie } })).json()) as {
      narrations: { transcriptStatus: string; text: string }[];
    };
    expect(list.narrations[0]).toMatchObject({ transcriptStatus: "done", text: "架空の文字起こし" });

    const audio = await t2.app.request(narration.audioUrl, { headers: { Cookie: owner.cookie } });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("cache-control")).toBe("private, no-store");
    expect(audio.headers.get("content-type")).toBe("audio/webm;codecs=opus");
  });

  it("keywords はこの家族の呼ばれ方だけ。ほかの家族の呼ばれ方は混ざらず、ログには数だけ出す", async () => {
    const tr = fakeTranscriber(() => ({ ok: true, text: "架空の文字起こし" }));
    const t2 = makeTestApp(d1, { transcriber: tr });
    const other = await createFamily(t2);
    await addMember(t2, other.cookie, { calledAs: "よその架空のおばちゃん" });
    const f = await createFamily(t2);
    const k = await addMember(t2, f.cookie, { calledAs: "架空のけんちゃん" });
    const g = await addMember(t2, k.cookie, { role: "elder", relation: "祖父", calledAs: "架空のじいじ" });
    const p = await addPhoto(t2, g.cookie, 1);
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
    try {
      const res = await postForm(t2, "/api/narrations", narrationForm({ ...textMeta(p.id), kind: "voice", text: null }, fakeAudio), g.cookie);
      expect(res.status).toBe(202);
      await t2.flush();
    } finally {
      spy.mockRestore();
    }
    expect(tr.calls).toHaveLength(1);
    // 話し手（架空のじいじ）が先。上限で切られても話し手の呼ばれ方が残る
    expect(tr.calls[0]!.keywords).toEqual(["架空のじいじ", "架空のけんちゃん"]);
    const done = logs.find((l) => l.includes("transcribe_done"));
    expect(done).toBeDefined();
    expect(JSON.parse(done!)).toMatchObject({ keywordCandidates: 2 });
    for (const l of logs) {
      expect(l).not.toContain("架空のじいじ");
      expect(l).not.toContain("架空のけんちゃん");
      expect(l).not.toContain("よその架空のおばちゃん");
    }
  });

  it("文字起こしが失敗したら（キーがないときを含む）、録音は残し、文字は空のまま failed", async () => {
    const tr = fakeTranscriber(() => ({ ok: false, reason: "not_configured" }));
    const t2 = makeTestApp(d1, { transcriber: tr });
    const f = await createFamily(t2);
    const m = await addMember(t2, f.cookie);
    const p = await addPhoto(t2, m.cookie, 1);
    const res = await postForm(t2, "/api/narrations", narrationForm({ ...textMeta(p.id), kind: "voice", text: null }, fakeAudio), m.cookie);
    const { narration } = (await res.json()) as { narration: { id: string; audioUrl: string } };
    await t2.flush();
    const row = await d1.prepare("SELECT transcript, transcript_status FROM narrations WHERE id = ?").bind(narration.id).first();
    expect(row).toEqual({ transcript: null, transcript_status: "failed" });
    expect((await t2.app.request(narration.audioUrl, { headers: { Cookie: m.cookie } })).status).toBe(200);
  });

  it("同じ requestId の再送は、作ってある語りを返し、二つにしない", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    const requestId = crypto.randomUUID();
    const m1 = { ...textMeta(p.id), kind: "voice", text: null, requestId };
    const r1 = (await (await postForm(t, "/api/narrations", narrationForm(m1, fakeAudio), m.cookie)).json()) as { narration: { id: string } };
    const res2 = await postForm(t, "/api/narrations", narrationForm(m1, fakeAudio), m.cookie);
    expect(res2.status).toBe(202);
    const r2 = (await res2.json()) as { narration: { id: string } };
    expect(r2.narration.id).toBe(r1.narration.id);
    const count = await d1.prepare("SELECT COUNT(*) AS n FROM narrations WHERE family_id = ?").bind(f.familyId).first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect(t.store.keys().filter((k) => k.startsWith(`families/${f.familyId}/audio/`))).toHaveLength(1);
    await t.flush();
  });

  it.each([
    ["声なのに録音がない", (p: string) => narrationForm({ ...textMeta(p), kind: "voice", text: null })],
    ["録音が音声でない", (p: string) => narrationForm({ ...textMeta(p), kind: "voice", text: null }, { bytes: new Uint8Array([1]), type: "text/html" })],
    ["文字なのに録音がある", (p: string) => narrationForm(textMeta(p), fakeAudio)],
    ["文字の語りに文字がない", (p: string) => narrationForm({ ...textMeta(p), text: null })],
  ])("%s → 400", async (_n, make) => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    expect((await postForm(t, "/api/narrations", make(p.id), m.cookie)).status).toBe(400);
  });

  it("声の語りは、クライアントが測った録音の長さを返す。省けば null、文字の語りは null、範囲の外は 400", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    const send = (extra: Record<string, unknown>, audio?: typeof fakeAudio) =>
      postForm(t, "/api/narrations", narrationForm({ ...textMeta(p.id), ...extra }, audio), m.cookie);
    const durationOf = async (res: Response) => ((await res.json()) as { narration: { durationMs: number | null } }).narration.durationMs;

    expect(await durationOf(await send({ kind: "voice", text: null, durationMs: 13_400 }, fakeAudio))).toBe(13_400);
    expect(await durationOf(await send({ kind: "voice", text: null }, fakeAudio))).toBeNull();
    expect(await durationOf(await send({ kind: "voice", text: null, durationMs: null }, fakeAudio))).toBeNull();
    expect(await durationOf(await send({ durationMs: 5_000 }))).toBeNull();
    for (const bad of [-1, 1.5, 60 * 60_000 + 1, "13"]) {
      expect((await send({ kind: "voice", text: null, durationMs: bad }, fakeAudio)).status).toBe(400);
    }
    await t.flush();
    const list = (await (await t.app.request(`/api/narrations?photoId=${p.id}`, { headers: { Cookie: m.cookie } })).json()) as {
      narrations: { durationMs: number | null }[];
    };
    expect(list.narrations.map((n) => n.durationMs).sort()).toEqual([13_400, null, null, null]);
  });

  it("ほかの家族の語りへの返事、ほかの家族の録音は 404", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    const pa = await addPhoto(t, ma.cookie, 1);
    const na = (await (await postForm(t, "/api/narrations", narrationForm({ ...textMeta(pa.id), kind: "voice", text: null }, fakeAudio), ma.cookie)).json()) as {
      narration: { id: string; audioUrl: string };
    };
    await t.flush();
    const mb = await addMember(t, b.cookie);
    const pb = await addPhoto(t, mb.cookie, 1);
    expect((await postForm(t, "/api/narrations", narrationForm(textMeta(pb.id, { replyToId: na.narration.id })), mb.cookie)).status).toBe(404);
    expect((await t.app.request(na.narration.audioUrl, { headers: { Cookie: mb.cookie } })).status).toBe(404);
    expect((await t.app.request(`/api/narrations?photoId=${pa.id}`, { headers: { Cookie: mb.cookie } })).status).toBe(404);
  });
});

describe("GET /api/feed", () => {
  it("語りのある写真を、新しい語りのある写真から順に返す", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p1 = await addPhoto(t, m.cookie, 1);
    const p2 = await addPhoto(t, m.cookie, 2);
    await addPhoto(t, m.cookie, 3); // 語りのない写真は出ない
    t.setNow(new Date("2026-11-02T01:00:00Z"));
    await postForm(t, "/api/narrations", narrationForm(textMeta(p1.id)), m.cookie);
    t.setNow(new Date("2026-11-02T02:00:00Z"));
    await postForm(t, "/api/narrations", narrationForm(textMeta(p2.id)), m.cookie);
    t.setNow(new Date("2026-11-02T00:00:00Z"));
    const feed = (await (await t.app.request("/api/feed", { headers: { Cookie: m.cookie } })).json()) as {
      items: { photo: { id: string }; narrations: unknown[] }[];
    };
    expect(feed.items.map((i) => i.photo.id)).toEqual([p2.id, p1.id]);
    expect(feed.items[0]!.narrations).toHaveLength(1);
  });
});

describe("GET /api/feed の言葉の糸（入り口への答えの「元の言葉」。0035）", () => {
  type FeedJson = { items: { photo: { id: string }; narrations: { id: string; quotedFrom: unknown }[] }[] };
  const feedOf = async (cookie: string) => (await (await t.app.request("/api/feed", { headers: { Cookie: cookie } })).json()) as FeedJson;
  const quotedOf = (feed: FeedJson, narrationId: string) =>
    feed.items.flatMap((i) => i.narrations).find((n) => n.id === narrationId)?.quotedFrom;

  /** 家族、写真、元の語り（文字）を作る */
  async function setup(originalText = "架空の浜の思い出。浮き輪を膨らましてもろうた") {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    const orig = (await (await postForm(t, "/api/narrations", narrationForm(textMeta(p.id, { text: originalText })), m.cookie)).json()) as {
      narration: { id: string };
    };
    return { f, m, p, orig: orig.narration.id };
  }
  let day = 0;
  const nextDate = () => `2027-01-${String(++day).padStart(2, "0")}`;
  async function claudeEntrance(s: { f: { familyId: string }; m: { id: string } }, photoId: string, quote: { id: string | null; start: number | null; end: number | null }) {
    const id = crypto.randomUUID();
    await t.deps.repos.entrances.insertClaudeIfAbsent({
      id,
      familyId: s.f.familyId,
      memberId: s.m.id,
      forDate: nextDate(),
      photoId,
      focus: null,
      quoteNarrationId: quote.id,
      quoteStart: quote.start,
      quoteEnd: quote.end,
      reason: "架空の理由の文",
      createdAt: 1,
      question: "架空の問いかけ",
      model: "claude-sonnet-5-5",
      promptVersion: "entrance/v2",
      inputNarrationIds: ["n-secret-input"],
      inputTokens: 1,
      outputTokens: 1,
    });
    return id;
  }
  async function answer(s: { m: { cookie: string } }, photoId: string, entranceId: string | null) {
    const r = (await (await postForm(t, "/api/narrations", narrationForm(textMeta(photoId, { entranceId, text: "架空の答え" })), s.m.cookie)).json()) as {
      narration: { id: string };
    };
    return r.narration.id;
  }

  it("入り口に添えた言葉が引ければ、元の語りの ID・語り手・引用そのものを付ける。入り口の種類や記録は載せない", async () => {
    const s = await setup();
    const e = await claudeEntrance(s, s.p.id, { id: s.orig, start: 0, end: 9 });
    const a = await answer(s, s.p.id, e);
    const res = await t.app.request("/api/feed", { headers: { Cookie: s.m.cookie } });
    const raw = await res.text();
    const feed = JSON.parse(raw) as FeedJson;
    expect(quotedOf(feed, a)).toEqual({ narrationId: s.orig, speakerMemberId: s.m.id, text: "架空の浜の思い出。" });
    // 答えでない語りには付けない
    expect(quotedOf(feed, s.orig)).toBeNull();
    for (const leak of ["架空の理由の文", "claude-sonnet", "entrance/v2", "n-secret-input", '"kind":"claude"', '"reason"', '"model"', "inputNarrationIds", "promptVersion", "架空の問いかけ"]) {
      expect(raw).not.toContain(leak);
    }
  });

  it("固定の入り口でも、添えた言葉（全文）が引ければ同じ形で付ける", async () => {
    const s = await setup("短い架空の語り");
    const id = crypto.randomUUID();
    await t.deps.repos.entrances.insertFixedIfAbsent({ id, familyId: s.f.familyId, memberId: s.m.id, forDate: nextDate(), photoId: s.p.id, quoteNarrationId: s.orig, createdAt: 1 });
    const a = await answer(s, s.p.id, id);
    expect(quotedOf(await feedOf(s.m.cookie), a)).toEqual({ narrationId: s.orig, speakerMemberId: s.m.id, text: "短い架空の語り" });
  });

  it("引用が 80 字を超えるときは text を null（画面は呼ばれ方だけ）", async () => {
    const long = "あ".repeat(81);
    const s = await setup(long);
    const e = await claudeEntrance(s, s.p.id, { id: s.orig, start: null, end: null });
    const a = await answer(s, s.p.id, e);
    expect(quotedOf(await feedOf(s.m.cookie), a)).toEqual({ narrationId: s.orig, speakerMemberId: s.m.id, text: null });
    // ちょうど 80 字は出す
    const s2 = await setup("い".repeat(80));
    const e2 = await claudeEntrance(s2, s2.p.id, { id: s2.orig, start: null, end: null });
    const a2 = await answer(s2, s2.p.id, e2);
    expect(quotedOf(await feedOf(s2.m.cookie), a2)).toMatchObject({ text: "い".repeat(80) });
  });

  it("添えた言葉がない・範囲が外れている・入り口の写真と語りの写真が違うときは、糸を付けない", async () => {
    const s = await setup();
    const none = await answer(s, s.p.id, await claudeEntrance(s, s.p.id, { id: null, start: null, end: null }));
    const outOfRange = await answer(s, s.p.id, await claudeEntrance(s, s.p.id, { id: s.orig, start: 5, end: 999 }));
    const other = await addPhoto(t, s.m.cookie, 2);
    // 入り口は写真 p、答えは別の写真（POST は組を確かめていない）
    const mismatch = await answer(s, other.id, await claudeEntrance(s, s.p.id, { id: s.orig, start: 0, end: 4 }));
    const feed = await feedOf(s.m.cookie);
    expect(quotedOf(feed, none)).toBeNull();
    expect(quotedOf(feed, outOfRange)).toBeNull();
    expect(quotedOf(feed, mismatch)).toBeNull();
  });
});
