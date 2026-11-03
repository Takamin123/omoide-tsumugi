// 初日のバックエンドの、すき間の確かめ（qa-engineer）。架空のデータだけを使う。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMember,
  addPhoto,
  createFamily,
  defaultMember,
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

const textForm = (m: Record<string, unknown>) => {
  const f = new FormData();
  f.append("meta", JSON.stringify({ kind: "text", entranceId: null, replyToId: null, text: "架空の語り", ...m }));
  return f;
};
const voiceForm = (m: Record<string, unknown>) => {
  const f = new FormData();
  f.append("meta", JSON.stringify({ kind: "voice", entranceId: null, replyToId: null, text: null, ...m }));
  f.append("audio", new File([new Uint8Array([1, 2, 3])], "a", { type: "audio/webm" }));
  return f;
};
const count = async (sql: string, ...binds: unknown[]) =>
  (await d1.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

describe("語りの冪等", () => {
  it("requestId がなければ、同じ中身でも二つの語りになる（NULL は一意の制約にかからない）", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    expect((await postForm(t, "/api/narrations", textForm({ photoId: p.id }), m.cookie)).status).toBe(202);
    expect((await postForm(t, "/api/narrations", textForm({ photoId: p.id }), m.cookie)).status).toBe(202);
    expect(await count("SELECT COUNT(*) AS n FROM narrations WHERE family_id = ?", f.familyId)).toBe(2);
  });

  it("同じ requestId でも、ほかの家族の語りは返さない（家族ごとに別）", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    const mb = await addMember(t, b.cookie);
    const pa = await addPhoto(t, ma.cookie, 1);
    const pb = await addPhoto(t, mb.cookie, 1);
    const requestId = crypto.randomUUID();
    const ra = (await (await postForm(t, "/api/narrations", textForm({ photoId: pa.id, requestId }), ma.cookie)).json()) as {
      narration: { id: string };
    };
    const resB = await postForm(t, "/api/narrations", textForm({ photoId: pb.id, requestId, text: "べつの架空の語り" }), mb.cookie);
    expect(resB.status).toBe(202);
    const rb = (await resB.json()) as { narration: { id: string; text: string } };
    expect(rb.narration.id).not.toBe(ra.narration.id);
    expect(rb.narration.text).toBe("べつの架空の語り");
  });

  it("requestId が UUID でなければ 400", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    expect((await postForm(t, "/api/narrations", textForm({ photoId: p.id, requestId: "x" }), m.cookie)).status).toBe(400);
  });

  it("ほかの家族の入り口を指す語りは 404", async () => {
    const a = await createFamily(t);
    const b = await createFamily(t);
    const ma = await addMember(t, a.cookie);
    await addPhoto(t, ma.cookie, 1);
    const e = (await (await t.app.request(`/api/entrances/today`, { headers: { Cookie: ma.cookie } })).json()) as {
      entrance: { id: string };
    };
    const mb = await addMember(t, b.cookie);
    const pb = await addPhoto(t, mb.cookie, 1);
    const res = await postForm(t, "/api/narrations", textForm({ photoId: pb.id, entranceId: e.entrance.id }), mb.cookie);
    expect(res.status).toBe(404);
  });
});

describe("文字起こしの失敗", () => {
  it("文字起こしが例外を投げても、文字は空のまま failed（作り話で埋めない）", async () => {
    const t2 = makeTestApp(d1, {
      transcriber: fakeTranscriber(() => {
        throw new TypeError("boom");
      }),
    });
    const f = await createFamily(t2);
    const m = await addMember(t2, f.cookie);
    const p = await addPhoto(t2, m.cookie, 1);
    const { narration } = (await (await postForm(t2, "/api/narrations", voiceForm({ photoId: p.id }), m.cookie)).json()) as {
      narration: { id: string };
    };
    await t2.flush();
    const row = await d1.prepare("SELECT transcript, transcript_status, cleaned_text FROM narrations WHERE id = ?").bind(narration.id).first();
    expect(row).toEqual({ transcript: null, transcript_status: "failed", cleaned_text: null });
  });

  it("録音が保存先になければ failed。文字起こしは呼ばない", async () => {
    const tr = fakeTranscriber();
    const t2 = makeTestApp(d1, { transcriber: tr });
    const f = await createFamily(t2);
    const m = await addMember(t2, f.cookie);
    const p = await addPhoto(t2, m.cookie, 1);
    const { narration } = (await (await postForm(t2, "/api/narrations", voiceForm({ photoId: p.id }), m.cookie)).json()) as {
      narration: { id: string };
    };
    for (const k of t2.store.keys()) if (k.includes("/audio/")) await t2.store.delete(k);
    await t2.flush();
    expect(tr.calls).toHaveLength(0);
    const row = await d1.prepare("SELECT transcript_status FROM narrations WHERE id = ?").bind(narration.id).first();
    expect(row).toEqual({ transcript_status: "failed" });
  });
});

describe("写真", () => {
  it("同じ content_hash でも、持ち主が違えば別の写真（201）", async () => {
    const f = await createFamily(t);
    const a = await addMember(t, f.cookie);
    const b = await addMember(t, a.cookie, { relation: "孫", calledAs: "けん" });
    const meta = { contentHash: hashOf(7), width: 1, height: 1, takenAt: null, latitude: null, longitude: null };
    expect((await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(7)), a.cookie)).status).toBe(201);
    expect((await postForm(t, "/api/photos", photoForm(meta, tinyJpeg(7)), b.cookie)).status).toBe(201);
  });

  it("その人のリンクを作り直したら、古い合言葉では写真も録音も取れない", async () => {
    const f = await createFamily(t);
    const m = await addMember(t, f.cookie);
    const p = await addPhoto(t, m.cookie, 1);
    const { narration } = (await (await postForm(t, "/api/narrations", voiceForm({ photoId: p.id }), m.cookie)).json()) as {
      narration: { audioUrl: string };
    };
    await t.flush();
    expect((await t.app.request(`/api/members/${m.id}/link`, { method: "POST", headers: { Cookie: m.cookie } })).status).toBe(200);
    expect((await t.app.request(`/api/photos/${p.id}/image`, { headers: { Cookie: m.cookie } })).status).toBe(401);
    expect((await t.app.request(narration.audioUrl, { headers: { Cookie: m.cookie } })).status).toBe(401);
  });
});

describe("合言葉の cookie", () => {
  it("無効な合言葉の cookie は消す", async () => {
    const res = await t.app.request("/api/family", { headers: { Cookie: `omoide_invite=${"z".repeat(43)}` } });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(/omoide_invite=;.*Max-Age=0/);
  });

  it("合言葉で入るとき、最初の一人を入れるとき、自分のリンクを作り直すときの cookie も HttpOnly, Secure, SameSite=Lax", async () => {
    const f = await createFamily(t);
    const s = await t.app.request("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: f.token }),
    });
    const first = await t.app.request("/api/members", {
      method: "POST",
      headers: { Cookie: f.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(defaultMember),
    });
    const m = (await first.json()) as { id: string };
    const own = `omoide_invite=${/omoide_invite=([^;]*)/.exec(first.headers.get("set-cookie") ?? "")![1]}`;
    const r = await t.app.request(`/api/members/${m.id}/link`, { method: "POST", headers: { Cookie: own } });
    for (const c of [s.headers.get("set-cookie")!, first.headers.get("set-cookie")!, r.headers.get("set-cookie")!]) {
      expect(c).toMatch(/HttpOnly/);
      expect(c).toMatch(/Secure/);
      expect(c).toMatch(/SameSite=Lax/);
    }
  });
});

describe("デモの時計は、ほかの家族に触れない", () => {
  it("本番でデモの家族の時計を翌朝まで進めても、ほかの家族の時計と入り口は変わらない", async () => {
    const prod = makeTestApp(d1, { appEnv: "production" });
    const real = await createFamily(prod);
    const demo = await createFamily(prod, true);
    const rm = await addMember(prod, real.cookie);
    const dm = await addMember(prod, demo.cookie);
    await addPhoto(prod, rm.cookie, 1);
    await addPhoto(prod, dm.cookie, 1);
    const before = await count("SELECT COUNT(*) AS n FROM entrances WHERE family_id = ?", real.familyId);
    for (let i = 0; i < 3; i++) {
      expect((await prod.app.request("/api/demo/clock/advance", { method: "POST", headers: { Cookie: dm.cookie } })).status).toBe(200);
    }
    expect(await count("SELECT COUNT(*) AS n FROM entrances WHERE family_id = ?", demo.familyId)).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM entrances WHERE family_id = ?", real.familyId)).toBe(before);
    expect(await d1.prepare("SELECT clock_date, clock_slot FROM families WHERE id = ?").bind(real.familyId).first()).toEqual({
      clock_date: null,
      clock_slot: null,
    });
  });
});

describe("エラー", () => {
  it("中で例外が出ても、種類だけを返す（中身を返さない）", async () => {
    const t2 = makeTestApp(d1);
    const f = await createFamily(t2);
    t2.deps.repos.members.list = async () => {
      throw new Error("架空の秘密の中身");
    };
    const res = await t2.app.request("/api/family", { headers: { Cookie: f.cookie } });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe(JSON.stringify({ error: "internal" }));
  });
});
